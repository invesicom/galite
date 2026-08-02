/* ===================================================================
 * MCP OAuth · GET /api/mcp/oauth/authorize
 *
 * 协议: OAuth 2.1 + PKCE (RFC 7636) + MCP Authorization spec
 *
 * 流程:
 *   1. 校验入参 (response_type / code_challenge / redirect_uri)
 *   2. 检查 ct_token cookie:
 *        - 未登录 → 302 到本实例密码登录弹窗, 完成后回到同 URL
 *   3. 已登录 → 渲染极简 Consent 页 (form POST 回同 endpoint)
 *
 * 注:
 *   - 密码登录弹窗通过 return_to 回到当前完整 URL，保留 client 的
 *     state / PKCE / query string。
 *   - 同意页用纯 server-rendered HTML, 不复用 Vue layout — 让 client
 *     看到的是稳定的轻量 HTML, 不受站点 SSR 失败影响.
 * =================================================================== */

import { isAllowedRedirectUri } from '../../../utils/mcp-oauth'
import { verifyJwt, decodeJwt } from '../../../utils/jwt'
import { getAppSecret } from '../../../utils/self-hosted'

/* ---- HTML 转义: 防止 client_id / redirect_uri 注入到页面 ---- */
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const client_id = String(q.client_id || '')
  const redirect_uri = String(q.redirect_uri || '')
  const code_challenge = String(q.code_challenge || '')
  const code_challenge_method = String(q.code_challenge_method || '')
  const state = String(q.state || '')
  const scope = String(q.scope || 'mcp')
  const response_type = String(q.response_type || 'code')

  /* ---- 入参严校验 (PKCE 强制 S256, 拒一切非 code 流) ---- */
  if (response_type !== 'code') {
    throw createError({ statusCode: 400, message: 'unsupported_response_type' })
  }
  if (!client_id) {
    throw createError({ statusCode: 400, message: 'invalid_request: client_id required' })
  }
  if (!isAllowedRedirectUri(redirect_uri)) {
    throw createError({ statusCode: 400, message: 'invalid_request: bad redirect_uri' })
  }
  if (!code_challenge || code_challenge_method !== 'S256') {
    throw createError({ statusCode: 400, message: 'invalid_request: PKCE S256 required' })
  }
  if (scope !== 'mcp') {
    throw createError({ statusCode: 400, message: 'invalid_scope' })
  }

  /* ---- 登录态判定: ct_token cookie + JWT 验签 (站点身份) ---- */
  const ctToken = getCookie(event, 'ct_token') || ''
  const appSecret = getAppSecret(event)
  let userPayload = null
  if (ctToken && appSecret) {
    const ok = await verifyJwt(ctToken, appSecret)
    if (ok) userPayload = decodeJwt(ctToken)?.payload || null
  }

  /* ---- 未登录: 302 到本实例密码登录弹窗，成功后回到这里 ---- */
  if (!userPayload?.union_id) {
    return redirectToLogin(event)
  }

  /* ---- 已登录: 渲染同意页 ---- */
  setHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'X-Frame-Options', 'DENY')

  return renderConsent({
    client_id, redirect_uri, code_challenge, state, scope,
    email: userPayload.email || '',
  })
})

/* ===================================================================
 * 302 到本实例密码登录弹窗。
 * 登录成功后 LoginModal 校验同源 return_to，再回到完整授权 URL。
 * =================================================================== */
function redirectToLogin(event) {
  const currentUrl = getRequestURL(event).toString()
  const loginUrl = `/?login=1&return_to=${encodeURIComponent(currentUrl)}`
  return sendRedirect(event, loginUrl, 302)
}

/* ===================================================================
 *  Consent 页 — 极简 HTML, 不依赖 Vue / Tailwind
 *
 *  设计:
 *   - 单个 form POST 回同一路径 (.../authorize), action="" 让浏览器自然
 *     带上当前完整 URL 的 path, 不丢 query.
 *   - approve / deny 用同一 form 的两个 button name=action, 简化路由.
 *   - 文案直接英文 (MCP client 都是开发者面向); i18n 可后续按需补.
 * =================================================================== */
function renderConsent({ client_id, redirect_uri, code_challenge, state, scope, email }) {
  const c = escapeHtml(client_id)
  const r = escapeHtml(redirect_uri)
  const cc = escapeHtml(code_challenge)
  const s = escapeHtml(state)
  const sc = escapeHtml(scope)
  const e = escapeHtml(email)

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Authorize MCP Access</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         margin: 0; padding: 0; background: #f8fafc; color: #0f172a; }
  .wrap { max-width: 480px; margin: 64px auto; padding: 32px;
          background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
  h1 { font-size: 18px; margin: 0 0 8px; font-weight: 600; }
  p  { font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 16px; }
  .meta { background: #f1f5f9; border-radius: 8px; padding: 12px 16px; font-size: 13px;
          color: #334155; margin: 16px 0; word-break: break-all; }
  .meta b { color: #0f172a; }
  ul { padding-left: 20px; margin: 8px 0 16px; }
  li { font-size: 14px; line-height: 1.7; color: #475569; }
  .actions { display: flex; gap: 12px; margin-top: 24px; }
  button { flex: 1; padding: 10px 16px; border-radius: 8px; border: 0; font-size: 14px;
           font-weight: 600; cursor: pointer; }
  .approve { background: #2563eb; color: #fff; }
  .approve:hover { background: #1d4ed8; }
  .deny { background: #f1f5f9; color: #334155; }
  .deny:hover { background: #e2e8f0; }
  .who { font-size: 12px; color: #94a3b8; margin-top: 16px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Authorize MCP Access</h1>
  <p>An MCP client wants to read your site analytics through this account.</p>

  <div class="meta">
    <div><b>Client</b>: ${c}</div>
    <div><b>Redirect</b>: ${r}</div>
    <div><b>Scope</b>: ${sc}</div>
  </div>

  <p>If you approve, the client (e.g. Claude, Cursor, Cline) will be able to:</p>
  <ul>
    <li>List your projects (sites)</li>
    <li>Read aggregated GA4 metrics for those projects</li>
    <li>Query realtime active users / dimensions / time-series</li>
  </ul>

  <form method="post" action="">
    <input type="hidden" name="client_id" value="${c}" />
    <input type="hidden" name="redirect_uri" value="${r}" />
    <input type="hidden" name="code_challenge" value="${cc}" />
    <input type="hidden" name="state" value="${s}" />
    <input type="hidden" name="scope" value="${sc}" />
    <div class="actions">
      <button type="submit" name="action" value="deny" class="deny">Deny</button>
      <button type="submit" name="action" value="approve" class="approve">Approve</button>
    </div>
  </form>

  <div class="who">Signed in as ${e || '(unknown)'} </div>
</div>
</body>
</html>`
}
