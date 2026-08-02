/* ===================================================================
 * MCP OAuth · POST /api/mcp/oauth/register  (RFC 7591 DCR)
 *
 * Dynamic Client Registration: MCP client 第一次连接时自动调用,
 * 我们颁一个 client_id 给它, 后续 authorize / token 都带这个 id.
 *
 * 设计:
 *   - Client Registration 无状态: 不入库, client_id 是 'mcp_' + 24 位 base62 随机串.
 *     authorize 阶段不验 client_id 是否注册过 (反正 PKCE + redirect_uri
 *     才是真实安全边界); 这样横向扩缩容 / 多 region 部署时无状态同步成本.
 *   - 公开客户端 only: token_endpoint_auth_method 强制 'none', 不签发 secret.
 *
 * 入参 (RFC 7591 §2):
 *   client_name, redirect_uris[], grant_types?, response_types?,
 *   token_endpoint_auth_method?, scope?
 *
 * 出参 (RFC 7591 §3.2.1):
 *   client_id, client_id_issued_at, redirect_uris, ...
 * =================================================================== */

import { isAllowedRedirectUri } from '../../../utils/mcp-oauth'

/* ---- 24 位 base62 client_id 后缀 ---- */
function genClientId() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += chars[bytes[i] % chars.length]
  return `mcp_${s}`
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')

  const body = await readBody(event)
  const f = body || {}

  /* ---- redirect_uris 必填 + 协议白名单 ---- */
  const redirectUris = Array.isArray(f.redirect_uris) ? f.redirect_uris.map(String) : []
  if (redirectUris.length === 0) {
    setResponseStatus(event, 400)
    return { error: 'invalid_redirect_uri', error_description: 'redirect_uris required' }
  }
  for (const uri of redirectUris) {
    if (!isAllowedRedirectUri(uri)) {
      setResponseStatus(event, 400)
      return { error: 'invalid_redirect_uri', error_description: `not allowed: ${uri}` }
    }
  }

  const clientName = String(f.client_name || 'mcp-client').slice(0, 80)
  const grantTypes = Array.isArray(f.grant_types) && f.grant_types.length
    ? f.grant_types.map(String)
    : ['authorization_code', 'refresh_token']
  const responseTypes = Array.isArray(f.response_types) && f.response_types.length
    ? f.response_types.map(String)
    : ['code']

  setResponseStatus(event, 201)
  return {
    client_id: genClientId(),
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: clientName,
    redirect_uris: redirectUris,
    grant_types: grantTypes,
    response_types: responseTypes,
    token_endpoint_auth_method: 'none',
    scope: 'mcp',
  }
})
