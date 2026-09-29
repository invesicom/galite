/* ===================================================================
 * POST /api/data-sources/bing/api-key
 *
 *  Bing Webmaster 第一版采用 API Key:
 *    1. 校验登录
 *    2. 用 GetUserSites 验证 Key 可用
 *    3. 加密保存到 data_source_auth.access_token_enc
 *    4. 自动同步站点到 project_data_source
 *
 *  编辑已有配置时可传 auth_id:
 *    - api_key 留空: 仅更新账号标签
 *    - api_key 非空: 验证新 Key 后替换当前集成配置并重新同步
 * =================================================================== */

import { and, eq, sql } from 'drizzle-orm'
import { data_source_auth } from '../../../database/schema'
import { DataSourceProvider } from '../../../utils/constants'
import { encrypt } from '../../../utils/crypto'
import { providerOf } from '../../../utils/providers'
import { syncResourcesFromAuth } from '../../../utils/auto-sync-projects'
import { invalidateProjectCache, invalidateUserCache } from '../../../utils/metrics-cache'

async function hashPrefix(value) {
  const bytes = new TextEncoder().encode(String(value || ''))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16)
}

function bingValidationDiagnostic(err, apiKey) {
  let upstream = String(err?.data || '')
    .replace(/apikey=([^&\s"']+)/gi, 'apikey=[redacted]')
  if (apiKey) upstream = upstream.replaceAll(apiKey, '[redacted]')

  return {
    statusCode: Number(err?.statusCode) || 0,
    code: String(err?.message || 'unknown').slice(0, 100),
    upstream: upstream.slice(0, 200),
  }
}

function publicAuth(row) {
  return {
    id: row.id,
    provider: row.provider,
    account_email: row.account_email || '',
    account_name: row.account_name || '',
    account_avatar: row.account_avatar || '',
    scope: row.scope || '',
    status: row.status,
    token_expires_at: row.token_expires_at || 0,
    created_at: row.created_at || 0,
  }
}

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const body = await readBody(event).catch(() => ({}))
  const authId = Number(body?.auth_id || 0)
  const apiKey = String(body?.api_key || '').trim()
  const accountNameInput = String(body?.account_name || '').trim().slice(0, 100)
  if (!apiKey && !authId) return reqFail('api_key_required')

  const db = await useDb(event)
  const now = Math.floor(Date.now() / 1000)

  const targetAuth = authId
    ? await getFirst(
      db.select().from(data_source_auth).where(and(
        eq(data_source_auth.id, authId),
        eq(data_source_auth.project_id, user.project_id),
        eq(data_source_auth.union_id, user.union_id),
        eq(data_source_auth.provider, DataSourceProvider.BING),
        sql`${data_source_auth.status} <> 97`,
      )).limit(1),
    )
    : null
  if (authId && !targetAuth) return reqFail('data_source_not_found')

  const accountName = accountNameInput || targetAuth?.account_name || 'Bing Webmaster'
  const provider = providerOf(DataSourceProvider.BING)
  let properties = []
  let externalId = ''
  let accessEnc = ''

  if (apiKey) {
    try {
      properties = await provider.listProperties({ apiKey })
    } catch (err) {
      if (err?.statusCode === 401) return reqFail('invalid_api_key')
      console.error('[bing-api-key] validate failed:', bingValidationDiagnostic(err, apiKey))
      if (err?.statusCode === 503) return reqFail('bing_rate_limited')
      return reqFail('bing_api_error')
    }

    const jwtSecret = getAppSecret(event)
    if (!jwtSecret) return reqFail('app_secret_missing')

    externalId = await hashPrefix(apiKey)
    accessEnc = await encrypt(apiKey, jwtSecret)

    if (targetAuth) {
      const duplicate = await getFirst(
        db.select().from(data_source_auth).where(and(
          eq(data_source_auth.project_id, user.project_id),
          eq(data_source_auth.union_id, user.union_id),
          eq(data_source_auth.provider, DataSourceProvider.BING),
          eq(data_source_auth.external_id, externalId),
          sql`${data_source_auth.status} <> 97`,
        )).limit(1),
      )
      if (duplicate && Number(duplicate.id) !== Number(targetAuth.id)) {
        return reqFail('api_key_already_connected')
      }
    }
  }

  const fields = {
    account_name: accountName,
    updated_at: now,
  }

  if (apiKey) {
    Object.assign(fields, {
      account_email: '',
      account_avatar: '',
      external_id: externalId,
      access_token_enc: accessEnc,
      refresh_token_enc: '',
      token_expires_at: 0,
      scope: 'api_key',
      last_refreshed_at: now,
      status: 1,
    })
  }

  let authRow = null

  if (targetAuth) {
    await db.update(data_source_auth)
      .set(fields)
      .where(eq(data_source_auth.id, targetAuth.id))

    authRow = await getFirst(
      db.select().from(data_source_auth).where(eq(data_source_auth.id, targetAuth.id)).limit(1),
    )
  } else {
    const existing = await getFirst(
      db.select().from(data_source_auth).where(and(
        eq(data_source_auth.project_id, user.project_id),
        eq(data_source_auth.union_id, user.union_id),
        eq(data_source_auth.provider, DataSourceProvider.BING),
        eq(data_source_auth.external_id, externalId),
      )).limit(1),
    )

    if (existing) {
      await db.update(data_source_auth)
        .set(fields)
        .where(eq(data_source_auth.id, existing.id))
    } else {
      await db.insert(data_source_auth).values({
        project_id: user.project_id,
        union_id: user.union_id,
        provider: DataSourceProvider.BING,
        external_id: externalId,
        created_at: now,
        ...fields,
      })
    }

    authRow = await getFirst(
      db.select().from(data_source_auth).where(and(
        eq(data_source_auth.project_id, user.project_id),
        eq(data_source_auth.union_id, user.union_id),
        eq(data_source_auth.provider, DataSourceProvider.BING),
        eq(data_source_auth.external_id, externalId),
      )).limit(1),
    )
  }

  let synced = {
    complete: true,
    created: 0,
    updated: 0,
    removed: 0,
    skipped: 0,
    properties,
    affected_project_keys: [],
  }
  if (apiKey && authRow) {
    synced = await syncResourcesFromAuth({ db, event, authRow, user })
      .catch((err) => {
        console.error('[bing-api-key] auto-sync failed:', err?.message || err)
        return {
          complete: false,
          created: 0,
          updated: 0,
          removed: 0,
          skipped: 0,
          properties,
          affected_project_keys: [],
        }
      })
  }

  await invalidateUserCache(db, user.project_id, user.union_id)
  for (const projectKey of synced?.affected_project_keys || []) {
    await invalidateProjectCache(db, user.project_id, projectKey)
  }

  return reqSuccess({
    auth: authRow ? publicAuth(authRow) : null,
    synced: synced?.created || 0,
    removed: synced?.removed || 0,
    total: (synced?.properties || properties || []).length,
  })
})
