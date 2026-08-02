/* ===================================================================
 * 数据源 OAuth 回调 - code → token → upsert data_source_auth → 302 回业务
 *
 *  GET /api/data-sources/callback/{provider}?code=&state=
 *
 *  设计:
 *    1. 解 state (AES-GCM, parseEncryptedState 内置过期校验, 默认 10min)
 *    2. 校验 state.union_id 与当前 session 一致 (防跨用户授权劫持)
 *    3. 用 code 换 token
 *    4. 用 access_token 拉 userinfo (sub 作 external_id, 同账号去重)
 *    5. encrypt(access_token) + encrypt(refresh_token) upsert data_source_auth
 *    6. 302 回 return_to?connected={provider}
 *
 *  错误统统 302 回 return_to?error=oauth_failed&reason=xxx, 让前端展示
 * =================================================================== */

import { and, eq } from 'drizzle-orm'
import { data_source_auth } from '../../../database/schema'
import { providerOf } from '../../../utils/providers'
import { getPublicSiteOrigin, googleOauthConfig } from '../../../utils/self-hosted'
import { syncResourcesFromAuth } from '../../../utils/auto-sync-projects'
import { invalidateProjectCaches, invalidateUserCache } from '../../../utils/metrics-cache'

/* ---- 兜底回跳页固定为集成页，避免旧链接跳到不存在的 /data-sources ---- */
const FALLBACK_RETURN = '/integrations'

function safeReturnPath(value) {
  const path = String(value || '').trim().slice(0, 500)
  return path.startsWith('/') && !path.startsWith('//') ? path : FALLBACK_RETURN
}

/* ---- 错误降级: 不暴露 token / 错误堆栈到前端
        kind='error' (默认) → 业务异常, 前端弹红色 error toast
        kind='cancelled'    → 用户主动取消, 前端弹中性 info toast (体感不刺眼) ---- */
function fail(event, returnTo, reason, kind = 'error') {
  const flag = kind === 'cancelled' ? 'oauth_cancelled' : 'oauth_failed'
  const base = returnTo || FALLBACK_RETURN
  const target = `${base}${base.includes('?') ? '&' : '?'}${flag}=1&reason=${encodeURIComponent(reason)}`
  return sendRedirect(event, target, 302)
}

/* ---- 尝试解 state 拿真实 return_to, 失败返 FALLBACK_RETURN
        让"前置异常" (state 还没校验前的 fail) 也能跳回用户原页面 ---- */
async function resolveReturnTo(stateStr, jwtSecret) {
  if (!stateStr || !jwtSecret) return FALLBACK_RETURN
  try {
    const s = await parseEncryptedState(stateStr, jwtSecret)
    return safeReturnPath(s?.return_to)
  } catch {
    return FALLBACK_RETURN
  }
}

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const provider = providerOf(event.context.params?.provider)

  /* ---- 提前读 jwtSecret, 让前置 fail 也能 best-effort 解 state 拿 return_to ---- */
  const jwtSecret = getAppSecret(event)
  const query = getQuery(event)
  const stateStr = String(query?.state || '').trim()
  const earlyReturnTo = await resolveReturnTo(stateStr, jwtSecret)

  let cfg
  try {
    cfg = googleOauthConfig(event)
  } catch {
    return fail(event, earlyReturnTo, 'config_missing')
  }

  if (!jwtSecret) return fail(event, earlyReturnTo, 'app_secret_missing')

  /* ===========================================================
     用户取消授权 (Google 同意页点取消):
       Google 返回 ?error=access_denied&state=...&error_subtype=cancel
       没 code, 但 state 是合法的 — 借此跳回原页并标 'cancelled' kind,
       前端展示中性 info toast 而非 error.
     =========================================================== */
  const oauthErr = String(query?.error || '').trim()
  if (oauthErr) {
    const reason = oauthErr === 'access_denied' ? 'user_cancelled' : oauthErr
    return fail(event, earlyReturnTo, reason, 'cancelled')
  }

  /* ---- 解 query ---- */
  const code = String(query?.code || '').trim()
  if (!code || !stateStr) return fail(event, earlyReturnTo, 'missing_code_or_state')

  /* ---- 解 state + 一致性校验 ---- */
  let state
  try {
    state = await parseEncryptedState(stateStr, jwtSecret)
  } catch {
    return fail(event, earlyReturnTo, 'state_invalid_or_expired')
  }
  if (!state) return fail(event, earlyReturnTo, 'state_invalid_or_expired')
  if (state.union_id !== user.union_id || state.project_id !== user.project_id) {
    return fail(event, earlyReturnTo, 'state_mismatch')
  }
  const returnTo = safeReturnPath(state.return_to)

  /* ---- 拼回调 URI, 必须与 oauth.get.js 完全一致 ---- */
  const redirectUri = `${getPublicSiteOrigin(event)}/api/data-sources/callback/${provider.name}`

  /* ---- code → token ---- */
  let tokenResp
  try {
    tokenResp = await provider.exchangeCode({
      code,
      clientId: cfg.client_id,
      clientSecret: cfg.client_secret,
      redirectUri,
    })
  } catch (e) {
    console.error('[oauth-callback] exchange failed:', e?.message)
    return fail(event, returnTo, 'exchange_failed')
  }
  if (!tokenResp?.access_token) return fail(event, returnTo, 'no_access_token')
  const mode = state.mode === 'extended' ? 'extended' : 'basic'
  /* OAuth 2.0 允许实际授权与请求一致时省略 scope；只有响应明确给出 scope
     时才以响应为准，缺省则回落到 provider 的固定白名单。 */
  const grantedScope = String(tokenResp.scope || provider.scopeForMode?.(mode) || '').trim()
  if (typeof provider.hasRequiredScopes === 'function'
    && !provider.hasRequiredScopes(grantedScope, mode)) {
    return fail(event, returnTo, 'required_scope_missing')
  }

  /* ---- userinfo (sub 作 external_id) ---- */
  let userInfo
  try {
    userInfo = await provider.fetchUserInfo({ accessToken: tokenResp.access_token })
  } catch (e) {
    console.error('[oauth-callback] userinfo failed:', e?.message)
    return fail(event, returnTo, 'userinfo_failed')
  }
  if (!userInfo?.sub) return fail(event, returnTo, 'no_sub')

  /* ---- token 加密 + 入库 ---- */
  const db = await useDb(event)
  const now = Math.floor(Date.now() / 1000)
  const tokenExpiresAt = now + (Number(tokenResp.expires_in) || 3600) - 60
  const accessEnc = await encrypt(tokenResp.access_token, jwtSecret)
  /* 同账号再次授权: Google 可能不返回 refresh_token, 只在首次/prompt=consent 给一次.
     若没拿到, 保持库里旧的 refresh_token, 不要覆盖成空 */
  const refreshEnc = tokenResp.refresh_token
    ? await encrypt(tokenResp.refresh_token, jwtSecret)
    : null

  /* ---- upsert by (project_id, union_id, provider, external_id) ---- */
  const existing = await getFirst(
    db.select().from(data_source_auth).where(and(
      eq(data_source_auth.project_id, user.project_id),
      eq(data_source_auth.union_id, user.union_id),
      eq(data_source_auth.provider, provider.name),
      eq(data_source_auth.external_id, String(userInfo.sub)),
    )).limit(1),
  )

  if (!refreshEnc && !existing?.refresh_token_enc) {
    return fail(event, returnTo, 'no_refresh_token')
  }

  const baseFields = {
    account_email: userInfo.email || '',
    account_name: userInfo.name || '',
    account_avatar: userInfo.picture || '',
    access_token_enc: accessEnc,
    token_expires_at: tokenExpiresAt,
    scope: grantedScope || existing?.scope || '',
    last_refreshed_at: now,
    status: 1,
    updated_at: now,
  }
  if (refreshEnc) baseFields.refresh_token_enc = refreshEnc

  if (existing) {
    await db.update(data_source_auth)
      .set(baseFields)
      .where(eq(data_source_auth.id, existing.id))
  } else {
    await db.insert(data_source_auth).values({
      project_id: user.project_id,
      union_id: user.union_id,
      provider: provider.name,
      external_id: String(userInfo.sub),
      refresh_token_enc: refreshEnc,
      created_at: now,
      ...baseFields,
    })
  }

  /* ---- 取回最新 authRow 给 auto-sync 用 (含正确的 id / 加密 token) ---- */
  const authRow = await getFirst(
    db.select().from(data_source_auth).where(and(
      eq(data_source_auth.project_id, user.project_id),
      eq(data_source_auth.union_id, user.union_id),
      eq(data_source_auth.provider, provider.name),
      eq(data_source_auth.external_id, String(userInfo.sub)),
    )).limit(1),
  )

  /* ---- 自动同步 (provider 分发): 失败/无结果不阻塞 302
          ga4 → 创建项目 + 挂载
          gsc / bing → 按 domain 关联或创建项目
          完整快照成功后才清理远端已消失的挂载 ---- */
  let synced = 0
  if (authRow) {
    try {
      const r = await syncResourcesFromAuth({ db, event, authRow, user })
      if (r?.complete) {
        synced = r.created || 0
        await invalidateProjectCaches(db, user.project_id, r.affected_project_keys || [])
        console.log('[oauth-callback] auto-sync done:', {
          provider: authRow.provider,
          created:  r.created || 0,
          removed:  r.removed || 0,
          skipped:  r.skipped || 0,
          total:    (r.properties || []).length,
        })
      } else {
        console.warn('[oauth-callback] auto-sync incomplete, local resources preserved:', {
          provider: authRow.provider,
          auth_id: authRow.id,
        })
      }
    } catch (e) {
      console.error('[oauth-callback] auto-sync failed:', e?.message)
    }
  }

  /* ---- 清用户级 metrics 缓存: 旧 0 值在 60s TTL 内不能继续干扰新授权后的查询 ---- */
  await invalidateUserCache(db, user.project_id, user.union_id)

  /* ---- 跳回业务页, 带 connected + synced 数量 ---- */
  const params = new URLSearchParams({ connected: provider.name })
  if (synced > 0) params.set('synced', String(synced))
  const target = `${returnTo}${returnTo.includes('?') ? '&' : '?'}${params.toString()}`
  return sendRedirect(event, target, 302)
})
