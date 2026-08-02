/* ===================================================================
 * 数据源 Token 管家
 *
 *  职责: 给 provider 调用方提供"明文 access_token", 自动:
 *    1. 解密入库的 access_token_enc
 *    2. 接近过期 (< 30s) 时用 refresh_token 换新, 写回加密结果
 *    3. refresh 明确返回 invalid_grant -> 标记 status=99, 抛 401 走 re-consent
 *       临时限流 / 上游故障直接透传，不污染授权状态
 *
 *  消除特殊情况: status !== 1 一律抛 reauth_required, 让 caller 不用判断
 * =================================================================== */

import { eq } from 'drizzle-orm'
import { encrypt, decrypt } from './crypto'
import { data_source_auth } from '../database/schema'
import { providerOf } from './providers'

/* ---- token 临期阈值 (秒). 提前 30s 触发 refresh, 防止打到 401 ---- */
const TOKEN_REFRESH_GUARD_SEC = 30

/* Token 刷新从仅服务端可见的 siteConfig 读取 Worker Google 凭证。 */
export function readGoogleOauthConfig(siteConfig) {
  const unchanged = siteConfig?.unchanged || {}
  const client_id = unchanged.google_client_id || ''
  const client_secret = unchanged.google_client_secret || ''
  if (!client_id || !client_secret) {
    throw createError({ statusCode: 500, message: 'google_oauth_config_missing' })
  }
  return { client_id, client_secret }
}

/* ---- 把 status 置 99 + 落库, 抛 reauth_required ---- */
async function markReauth(db, authId) {
  const now = Math.floor(Date.now() / 1000)
  await db.update(data_source_auth)
    .set({ status: 99, updated_at: now })
    .where(eq(data_source_auth.id, authId))
  throw createError({ statusCode: 401, message: 'reauth_required' })
}

/**
 * 取明文 access_token, 必要时自动 refresh
 * @param {*} db        Drizzle 实例
 * @param {*} authRow   data_source_auth 行
 * @param {*} jwtSecret APP_SECRET
 * @param {*} siteConfig 用于读 unchanged.google_client_id / google_client_secret
 * @returns {Promise<string>} 明文 access_token
 */
export async function getAccessToken(db, authRow, jwtSecret, siteConfig) {
  if (!authRow || authRow.status !== 1) {
    throw createError({ statusCode: 401, message: 'reauth_required' })
  }
  const now = Math.floor(Date.now() / 1000)

  /* ---- 未临期: 直接解密返回 ---- */
  if ((authRow.token_expires_at || 0) > now + TOKEN_REFRESH_GUARD_SEC) {
    const access = await decrypt(authRow.access_token_enc, jwtSecret)
    if (access) return access
    /* 解密失败 = 加密 key 已轮换或库被改坏, 走 re-consent */
    return markReauth(db, authRow.id)
  }

  /* ---- 临期 / 过期: 用 refresh_token 换新 ---- */
  const refreshToken = await decrypt(authRow.refresh_token_enc, jwtSecret)
  if (!refreshToken) return markReauth(db, authRow.id)

  const provider = providerOf(authRow.provider)
  const { client_id, client_secret } = readGoogleOauthConfig(siteConfig)
  const next = await provider.refreshAccessToken({
    refreshToken,
    clientId: client_id,
    clientSecret: client_secret,
  })

  if (!next?.access_token) return markReauth(db, authRow.id)

  const tokenExpiresAt = now + (Number(next.expires_in) || 3600) - 60
  const patch = {
    access_token_enc: await encrypt(next.access_token, jwtSecret),
    token_expires_at: tokenExpiresAt,
    last_refreshed_at: now,
    updated_at: now,
  }
  /* Google 通常只返回新 access token；若未来发生 refresh token 轮换，
     同一条更新顺手接住，避免仍持有已经失效的旧 token。 */
  if (next.refresh_token) patch.refresh_token_enc = await encrypt(next.refresh_token, jwtSecret)
  if (next.scope) patch.scope = next.scope
  await db.update(data_source_auth)
    .set(patch)
    .where(eq(data_source_auth.id, authRow.id))

  return next.access_token
}

/**
 * 取 provider 明文凭证.
 *
 * OAuth provider 返回 access_token；API Key provider 返回解密后的 access_token_enc。
 * 让调用方只关心"拿到 provider credential"，不在业务层散落 Bing 特判。
 */
export async function getProviderCredential(db, authRow, jwtSecret, siteConfig) {
  if (!authRow || authRow.status !== 1) {
    throw createError({ statusCode: 401, message: 'reauth_required' })
  }
  if (String(authRow.scope || '') === 'api_key') {
    const token = await decrypt(authRow.access_token_enc || '', jwtSecret)
    if (token) return token
    return markReauth(db, authRow.id)
  }
  return getAccessToken(db, authRow, jwtSecret, siteConfig)
}
