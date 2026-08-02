/* ===================================================================
 * 数据源 OAuth 入口 - 拼授权 URL 并 302 跳走
 *
 *  GET /api/data-sources/oauth/{provider}?return_to=...
 *
 *  state 内容 (AES-GCM, 用 APP_SECRET 加密, createEncryptedState 自带 ts+nonce):
 *    { union_id, project_id, return_to }
 *
 *  注意: 必须用户已登录 (requireAuth), 否则回调时拿不到 union_id
 *        无法验证 state 与 session 一致性.
 * =================================================================== */

import { providerOf } from '../../../utils/providers'
import { getPublicSiteOrigin, googleOauthConfig } from '../../../utils/self-hosted'

function safeReturnPath(value) {
  const path = String(value || '').trim().slice(0, 500)
  return path.startsWith('/') && !path.startsWith('//') ? path : '/integrations'
}

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const provider = providerOf(event.context.params?.provider)

  const cfg = googleOauthConfig(event)

  const jwtSecret = getAppSecret(event)
  if (!jwtSecret) throw createError({ statusCode: 500, message: 'app_secret_missing' })

  /* ---- 拼回调 URI (与 callback handler 必须严格一致) ---- */
  const redirectUri = `${getPublicSiteOrigin(event)}/api/data-sources/callback/${provider.name}`

  /* ---- state 加密: 含 union_id + project_id + return_to ---- */
  const query = getQuery(event)
  const returnTo = safeReturnPath(query?.return_to)
  /* mode=extended 升级 scope (含 analytics.edit), 默认 basic 只读 */
  const mode = query?.mode === 'extended' ? 'extended' : 'basic'
  const state = await createEncryptedState({
    union_id: user.union_id,
    project_id: user.project_id,
    return_to: returnTo,
    mode,
  }, jwtSecret)

  /* scope 由 provider 模块内置, mode 决定 basic / extended */
  const authUrl = provider.buildAuthUrl({
    clientId: cfg.client_id,
    state,
    redirectUri,
    mode,
  })

  return sendRedirect(event, authUrl, 302)
})
