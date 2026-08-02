/* ===================================================================
 *  POST /api/projects/create-with-ga4
 *
 *  "新建网站"流程: 不再让用户在已有 GA4 property 里选, 而是直接在
 *  用户授权的 GA admin account 下创建一个新的 property + web stream,
 *  再写入本系统的 project + project_data_source.
 *
 *  Body:
 *    auth_id        必传, data_source_auth.id (provider=ga4 + status=1)
 *    name           必传, 1~100 字, 同时作为 GA4 property 的 displayName
 *    site_url       必传, 含 protocol, 用作 webStreamData.defaultUri
 *    account_name   可选, 'accounts/12345' 多 admin 账号场景下指定 parent;
 *                   不传则按 listAdminAccounts 顺序逐个尝试, 跳过不可写账号
 *
 *  返回:
 *    { project_key, property_id, measurement_id }
 *
 *  容错策略 (与 ga-lite 风格对齐):
 *    - createProperty 失败  -> 502, 整体失败, 不留垃圾数据
 *    - createWebDataStream 失败 -> log warn + 继续, property 已存在
 *    - 已建的 GA4 property 不主动回滚 (Google Admin API 当前不支持轻易
 *      删除新 property, 强行 archive 又改变语义), 故 dataStream 失败时
 *      property 留作"孤儿", 让用户后续手动加 stream
 * =================================================================== */

import { and, eq } from 'drizzle-orm'
import { data_source_auth } from '../../database/schema'
import { getFirst } from '../../utils/db'
import { providerOf } from '../../utils/providers'
import { getAccessToken } from '../../utils/data-source-token'
import { getJwtSecret, getSiteConfig } from '../../utils/metrics-helpers'
import {
  pickProjectKey,
  insertProject,
  insertMount,
} from '../../utils/auto-sync-projects'
import { invalidateUserCache } from '../../utils/metrics-cache'
import { DataSourceProvider, RecordStatus } from '../../utils/constants'

/* ----------------------------------------------------------------
 *  入参校验 + 归一化
 * ---------------------------------------------------------------- */
function normalizeInput(body) {
  const auth_id = Number(body?.auth_id || 0)
  const name = String(body?.name || '').trim().slice(0, 100)
  const site_url = String(body?.site_url || '').trim().slice(0, 500)
  const account_name = String(body?.account_name || '').trim()
  if (!auth_id) return { error: 'auth_id required' }
  if (!name) return { error: 'name required' }
  if (!site_url) return { error: 'site_url required' }
  return { auth_id, name, site_url, account_name }
}

/* ----------------------------------------------------------------
 *  载入 + 归属校验 ga4 auth (status=1 才允许)
 * ---------------------------------------------------------------- */
async function loadGa4Auth(db, user, authId) {
  return getFirst(
    db.select().from(data_source_auth)
      .where(and(
        eq(data_source_auth.id,         authId),
        eq(data_source_auth.project_id, user.project_id),
        eq(data_source_auth.union_id,   user.union_id),
        eq(data_source_auth.provider,   DataSourceProvider.GA4),
        eq(data_source_auth.status,     RecordStatus.ACTIVE),
      ))
      .limit(1),
  )
}

/* ----------------------------------------------------------------
 *  把 GA4 returned property + stream 拼成内部 property 形态,
 *  让 insertProject / insertMount 直接复用.
 * ---------------------------------------------------------------- */
function toInternalProperty({ name, siteUrl, ga4Property, ga4Stream, accountName }) {
  return {
    id: ga4Property.name,
    label: name,
    meta: {
      account_id:    accountName,
      account_name:  '',
      property_id:   ga4Property.name,
      create_time:   ga4Property.createTime || '',
      timezone:      ga4Property.timeZone || '',
      currency:      ga4Property.currencyCode || '',
      website_uri:   ga4Stream?.webStreamData?.defaultUri || siteUrl,
      measurement_id: ga4Stream?.webStreamData?.measurementId || '',
    },
  }
}

function accountKey(account) {
  return String(account?.name || account || '').trim()
}

export default defineEventHandler(async (event) => {
  /* ============ 1. 鉴权 + 入参 ============ */
  const user = requireAuth(event)
  const input = normalizeInput(await readBody(event))
  if (input.error) return reqFail(input.error)

  const db = await useDb(event)

  /* ============ 2. 取 ga4 auth + access_token ============ */
  const authRow = await loadGa4Auth(db, user, input.auth_id)
  if (!authRow) return reqFail('auth_not_found')

  const provider = providerOf(authRow.provider)
  let accessToken
  try {
    accessToken = await getAccessToken(db, authRow, getJwtSecret(event), getSiteConfig(event))
  } catch (e) {
    console.error('[create-with-ga4] getAccessToken failed:', {
      auth_id: authRow.id, status: e?.statusCode, msg: e?.message,
    })
    return reqFail('token_invalid')
  }

  /* ============ 3. 选 parent account
     --
     Google 授权账号下可能有多个 Analytics account. /accounts 只表示
     "可见", 不表示都能 create property. 旧逻辑取第一个, 一旦第一个
     只有读权限就把 403 误报成 token_invalid. 这里改成:
       - 前端显式传 account_name: 只试这个
       - 未传: 按可见账号逐个试, 403 跳过, 直到成功或耗尽
     ============================================================ */
  let accounts
  try {
    accounts = input.account_name
      ? [{ name: input.account_name }]
      : await provider.listAdminAccounts({ accessToken })
  } catch (e) {
    console.error('[create-with-ga4] listAdminAccounts failed:', {
      auth_id: authRow.id, status: e?.statusCode, msg: e?.message, data: e?.data,
    })
    if (e?.message === 'token_invalid') return reqFail('token_invalid')
    if (e?.message === 'ga4_permission_denied') return reqFail('ga4_create_permission_denied')
    return reqFail('no_ga_admin_account')
  }
  if (!accounts.length) return reqFail('no_ga_admin_account')

  /* ============ 4. 创建 GA4 property ============ */
  let ga4Property
  let accountName = ''
  let deniedCount = 0
  for (const account of accounts) {
    const candidate = accountKey(account)
    if (!candidate) continue
    try {
      ga4Property = await provider.createProperty({
        accessToken,
        accountName: candidate,
        displayName: input.name,
        timeZone: 'UTC',
        currencyCode: 'USD',
      })
      accountName = candidate
      break
    } catch (e) {
      console.error('[create-with-ga4] createProperty failed:', {
        auth_id: authRow.id, account: candidate, status: e?.statusCode, msg: e?.message, data: e?.data,
      })
      if (e?.message === 'token_invalid') return reqFail('token_invalid')
      if (e?.message === 'ga4_permission_denied') {
        deniedCount++
        continue
      }
      return reqFail('create_property_failed')
    }
  }
  if (!ga4Property || !accountName) {
    return deniedCount > 0
      ? reqFail('ga4_create_permission_denied')
      : reqFail('create_property_failed')
  }

  /* ============ 5. 创建 web data stream (失败 log + 继续) ============ */
  let ga4Stream = null
  try {
    ga4Stream = await provider.createWebDataStream({
      accessToken,
      propertyName: ga4Property.name,
      displayName: input.name,
      defaultUri: input.site_url,
    })
  } catch (e) {
    console.warn('[create-with-ga4] createWebDataStream failed (continue):', {
      property: ga4Property.name, status: e?.statusCode, msg: e?.message,
    })
  }

  /* ============ 6. 写库: project + 挂载 ============ */
  const projectKey = await pickProjectKey(db, user.project_id)
  if (!projectKey) return reqFail('project_key generation collision')

  const property = toInternalProperty({
    name: input.name,
    siteUrl: input.site_url,
    ga4Property,
    ga4Stream,
    accountName,
  })
  const now = Math.floor(Date.now() / 1000)
  await insertProject(db, user, projectKey, property, now)
  await insertMount(db, user, projectKey, authRow, property, now)

  /* ============ 7. 清缓存 + 返回 ============ */
  await invalidateUserCache(db, user.project_id, user.union_id)

  return reqSuccess({
    project_key:    projectKey,
    property_id:    ga4Property.name,
    measurement_id: ga4Stream?.webStreamData?.measurementId || '',
  })
})
