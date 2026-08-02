/* ===================================================================
 * 登录态 cookie (ct_token) 统一下发 — 单点定义
 *
 * 密码登录与 MCP 同意页都在同一实例内，浏览器按同源请求自动携带 cookie。
 * 前端不读取 token，因此固定 HttpOnly + SameSite=Lax；线上再附加 Secure。
 * =================================================================== */

const CT_TOKEN_MAX_AGE = 20 * 24 * 60 * 60

/* ---- 判定当前请求是否 https (决定能否下发 Secure / SameSite=None) ---- */
function isHttpsRequest(event) {
  const xf = String(getHeader(event, 'x-forwarded-proto') || '').toLowerCase()
  if (xf) return xf === 'https'
  const host = String(getHeader(event, 'host') || '')
  return !host.startsWith('localhost') && !host.startsWith('127.0.0.1')
}

export function setLoginCookie(event, token) {
  const secure = isHttpsRequest(event)
  setCookie(event, 'ct_token', token, {
    path: '/',
    maxAge: CT_TOKEN_MAX_AGE,
    sameSite: 'lax',
    secure,
    httpOnly: true,
  })
}
