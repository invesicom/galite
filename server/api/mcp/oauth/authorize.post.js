/* ===================================================================
 * MCP OAuth · POST /api/mcp/oauth/authorize
 *
 * 同意页 form 回提:
 *   - action=approve → 颁发 authorization code (AES-GCM 5min) → 302
 *   - action=deny    → 302 回 redirect_uri 带 error=access_denied
 *
 * 流程严守 OAuth 2.1: 不在响应体里返回 code, 严格走 query string + 302,
 * 让 MCP client 在自己控制的 redirect_uri 上接收 code.
 * =================================================================== */

import {
  isAllowedRedirectUri,
  issueAuthCode,
  MCP_SCOPE,
} from '../../../utils/mcp-oauth'
import { verifyJwt, decodeJwt } from '../../../utils/jwt'
import { getAppSecret } from '../../../utils/self-hosted'

/* ---- 拼回跳 URL: 已带 ? 的合并到 &, 否则加 ? ---- */
function appendQuery(uri, params) {
  const sep = uri.includes('?') ? '&' : '?'
  const tail = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  return `${uri}${sep}${tail}`
}

export default defineEventHandler(async (event) => {
  /* ---- 双格式兼容: form-urlencoded (浏览器 form 默认) + JSON ---- */
  const body = await readBody(event)
  const f = body || {}
  const action = String(f.action || '')
  const client_id = String(f.client_id || '')
  const redirect_uri = String(f.redirect_uri || '')
  const code_challenge = String(f.code_challenge || '')
  const state = String(f.state || '')
  const scope = String(f.scope || MCP_SCOPE)

  if (!isAllowedRedirectUri(redirect_uri)) {
    throw createError({ statusCode: 400, message: 'invalid_request: bad redirect_uri' })
  }
  if (scope !== MCP_SCOPE) {
    throw createError({ statusCode: 400, message: 'invalid_scope' })
  }

  /* ---- Deny 路径: 不需要登录态, 直接送 error 回去 ---- */
  if (action === 'deny') {
    return sendRedirect(event, appendQuery(redirect_uri, { error: 'access_denied', state }), 302)
  }

  /* ---- Approve 路径: 必须有合法 ct_token (防 CSRF + 防 deny→approve 重放) ---- */
  const ctToken = getCookie(event, 'ct_token') || ''
  const appSecret = getAppSecret(event)
  if (!ctToken || !appSecret) {
    throw createError({ statusCode: 401, message: 'login_required' })
  }
  const ok = await verifyJwt(ctToken, appSecret)
  if (!ok) throw createError({ statusCode: 401, message: 'invalid_session' })
  const payload = decodeJwt(ctToken)?.payload
  if (!payload?.union_id || !payload?.project_id) {
    throw createError({ statusCode: 401, message: 'invalid_session' })
  }

  if (!code_challenge) {
    throw createError({ statusCode: 400, message: 'invalid_request: code_challenge missing' })
  }

  /* ---- 颁码: AES-GCM(JSON) → base64 → URL-safe ---- */
  const code = await issueAuthCode({
    union_id: payload.union_id,
    project_id: payload.project_id,
    client_id,
    redirect_uri,
    code_challenge,
    scope,
  }, appSecret)

  return sendRedirect(event, appendQuery(redirect_uri, { code, state }), 302)
})
