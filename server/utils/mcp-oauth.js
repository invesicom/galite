/* ===================================================================
 * MCP OAuth 2.1 + PKCE 工具集 - 协议层薄壳
 *
 * 设计原则:
 *   - authorization code 是 AES-GCM 加密的 self-contained payload，5 分钟
 *     过期；兑换时只把 code 的 SHA-256 指纹写入 D1，保证只能使用一次。
 *   - access/refresh token 是带 scope='mcp' 的 JWT, 与站点登录态 ct_token
 *     共享 secret 但 token_type 严格区分, 互不混用.
 *   - PKCE S256: Web Crypto subtle.digest('SHA-256') → base64url, 完全
 *     符合 RFC 7636 §4.2, 0 依赖 0 三方库.
 *   - issuer / endpoints 优先使用 D1 中的可选自定义 Origin；未配置时
 *     直接使用当前请求 Origin，让 workers.dev 地址无需额外配置即可工作。
 * =================================================================== */

import { encrypt, decrypt } from './crypto'
import { signJwt, verifyJwt, decodeJwt } from './jwt'
import { getPublicSiteOrigin } from './self-hosted'

/* ===================================================================
 *  常量 — token 生命周期 / scope / token_type
 * =================================================================== */
export const MCP_SCOPE = 'mcp'
export const MCP_AUTH_CODE_TTL_SEC = 300                       // 5 分钟
export const MCP_ACCESS_TOKEN_TTL_SEC = 3600                   // 1 小时
export const MCP_REFRESH_TOKEN_TTL_SEC = 30 * 24 * 3600        // 30 天
export const MCP_TOKEN_TYPE_ACCESS = 'mcp_access'
export const MCP_TOKEN_TYPE_REFRESH = 'mcp_refresh'

/* ===================================================================
 *  base64url helpers — 与 jwt.js 内部一致, 但这里是 ArrayBuffer 入口
 * =================================================================== */
function bufToB64Url(buf) {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

/* ===================================================================
 *  pkceVerify — RFC 7636 §4.6 校验 S256
 *
 *   challenge ?= base64url( SHA-256(verifier) )
 *
 *  返回 boolean. 任何异常 (verifier 为空 / 编码失败) 都视为不通过.
 * =================================================================== */
export async function pkceVerify(verifier, challenge) {
  if (!verifier || !challenge) return false
  try {
    const data = new TextEncoder().encode(verifier)
    const digest = await crypto.subtle.digest('SHA-256', data)
    return bufToB64Url(digest) === challenge
  } catch {
    return false
  }
}

/* ===================================================================
 *  Authorization Code — AES-GCM self-contained
 *
 *  payload 结构 (5min 后过期):
 *    {
 *      v: 1,                                  // 版本位, 未来字段演化兜底
 *      union_id, project_id,                  // 颁发时已登录用户身份
 *      client_id, redirect_uri,               // 客户端身份, 兑换时一致校验
 *      code_challenge,                        // PKCE 校验依据
 *      scope,                                 // 默认 'mcp'
 *      iat, exp                               // 颁发 / 过期 UTC 秒
 *    }
 *
 *  返回值: AES-GCM(JSON) → base64url, 直接拼到 redirect_uri?code=
 * =================================================================== */
export async function issueAuthCode(payload, secret) {
  const now = Math.floor(Date.now() / 1000)
  const data = {
    v: 1,
    union_id: payload.union_id,
    project_id: payload.project_id,
    client_id: payload.client_id,
    redirect_uri: payload.redirect_uri,
    code_challenge: payload.code_challenge,
    scope: payload.scope || MCP_SCOPE,
    iat: now,
    exp: now + MCP_AUTH_CODE_TTL_SEC,
  }
  /* ---- AES-GCM 已含 IV+TAG, 直接当 code 投递 ---- */
  return encrypt(JSON.stringify(data), secret, 'mcp-authorization-code')
}

export async function consumeAuthCode(code, secret) {
  if (!code) return null
  const plain = await decrypt(code, secret, 'mcp-authorization-code')
  if (!plain) return null
  try {
    const data = JSON.parse(plain)
    const now = Math.floor(Date.now() / 1000)
    if (!data?.exp || data.exp <= now) return null
    if (!data?.union_id || !data?.project_id) return null
    return data
  } catch {
    return null
  }
}

/* ===================================================================
 *  Access / Refresh Token — JWT 带 scope + token_type
 *
 *  与站点 ct_token (无 scope) 严格分离:
 *    - mcp_access  : { union_id, project_id, scope:'mcp', token_type:'mcp_access',  client_id, exp:1h }
 *    - mcp_refresh : { union_id, project_id, scope:'mcp', token_type:'mcp_refresh', client_id, exp:30d }
 *
 *  下游守卫只接受 token_type='mcp_access', refresh 端点只接受 'mcp_refresh',
 *  即便有人把 ct_token 当 Bearer 投进 MCP, 也会被 token_type 检查剔出.
 * =================================================================== */
export async function issueAccessToken({ union_id, project_id, client_id, scope }, secret) {
  return signJwt(
    {
      union_id, project_id,
      client_id: client_id || '',
      scope: scope || MCP_SCOPE,
      token_type: MCP_TOKEN_TYPE_ACCESS,
    },
    secret,
    MCP_ACCESS_TOKEN_TTL_SEC,
    'mcp-token',
  )
}

export async function issueRefreshToken({ union_id, project_id, client_id, scope }, secret) {
  return signJwt(
    {
      union_id, project_id,
      client_id: client_id || '',
      scope: scope || MCP_SCOPE,
      token_type: MCP_TOKEN_TYPE_REFRESH,
    },
    secret,
    MCP_REFRESH_TOKEN_TTL_SEC,
    'mcp-token',
  )
}

/* ---- 同形校验: 验签 + 解 payload + 校 token_type ---- */
async function verifyTypedJwt(token, secret, expectedType) {
  if (!token) return null
  const ok = await verifyJwt(token, secret, 0, 'mcp-token')
  if (!ok) return null
  const decoded = decodeJwt(token)
  const p = decoded?.payload
  if (!p || p.token_type !== expectedType) return null
  if (p.scope !== MCP_SCOPE) return null
  if (!p.union_id || !p.project_id) return null
  return p
}

export function verifyMcpAccessToken(token, secret) {
  return verifyTypedJwt(token, secret, MCP_TOKEN_TYPE_ACCESS)
}

export function verifyMcpRefreshToken(token, secret) {
  return verifyTypedJwt(token, secret, MCP_TOKEN_TYPE_REFRESH)
}

/* ===================================================================
 *  固定部署 origin — 拼绝对 metadata / endpoint URL
 * =================================================================== */
export function resolveOrigin(event) {
  return getPublicSiteOrigin(event)
}

/* ===================================================================
 *  redirect_uri 校验 — 协议白名单, 不做完整 URL 解析以最小化攻击面
 *
 *  允许:
 *    - https://*  (任何 https 主机, MCP 客户端通常托管 callback)
 *    - http://localhost  / http://127.0.0.1  (本地开发)
 *    - claude://...  / cursor://...  (桌面客户端 custom scheme)
 *
 *  拒绝:
 *    - 空串 / 非字符串
 *    - http://非 localhost  (防止明文回跳到任意主机)
 * =================================================================== */
export function isAllowedRedirectUri(uri) {
  if (typeof uri !== 'string' || !uri || uri.length > 2048) return false
  try {
    const url = new URL(uri)
    if (url.hash || url.username || url.password) return false
    if (url.protocol === 'https:') return true
    if (url.protocol === 'http:') {
      return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    }

    /* 桌面客户端可用自定义协议，但显式拒绝会执行、读文件或继承来源的协议。 */
    const unsafe = new Set(['javascript:', 'data:', 'file:', 'vbscript:', 'blob:'])
    return !unsafe.has(url.protocol) && /^[a-z][a-z0-9+\-.]*:\/\//i.test(uri)
  } catch {
    return false
  }
}
