/* ===================================================================
 * MCP OAuth · POST /api/mcp/oauth/token  (RFC 6749 §3.2)
 *
 * 支持两种 grant_type:
 *   - authorization_code : 用 code + code_verifier 换 access_token+refresh_token
 *   - refresh_token      : 用 refresh_token 换新的 access_token
 *
 * 公开客户端 (PKCE) 流程, 不验 client_secret. client_id 仅做信息记录,
 * 校验关键全在: PKCE + redirect_uri + code 自身的过期/解密.
 *
 * 响应严格按 OAuth 2.0 §5.1:
 *   { access_token, token_type:'Bearer', expires_in, refresh_token, scope }
 *
 * 错误响应按 §5.2:
 *   400 + { error, error_description? }
 * =================================================================== */

import {
  consumeAuthCode,
  pkceVerify,
  issueAccessToken,
  issueRefreshToken,
  verifyMcpRefreshToken,
  MCP_ACCESS_TOKEN_TTL_SEC,
  MCP_SCOPE,
} from '../../../utils/mcp-oauth'
import { usage_records } from '../../../database/schema'
import { useDb } from '../../../utils/db'
import { getAppSecret } from '../../../utils/self-hosted'

/* ---- 标准错误响应: 状态码 + JSON body, 便于 client 解析 ---- */
function rejectOAuthError(event, error, description) {
  setResponseStatus(event, 400)
  setHeader(event, 'Content-Type', 'application/json')
  setHeader(event, 'Cache-Control', 'no-store')
  return { error, error_description: description || '' }
}

export default defineEventHandler(async (event) => {
  /* ---- token endpoint 必须 no-store, 严防 token 进缓存 ---- */
  setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'Pragma', 'no-cache')

  const appSecret = getAppSecret(event)
  if (!appSecret) {
    setResponseStatus(event, 500)
    return { error: 'server_error', error_description: 'missing_secret' }
  }

  /* ---- 双格式: 标准 form-urlencoded + JSON 兜底 ---- */
  const body = await readBody(event)
  const f = body || {}
  const grantType = String(f.grant_type || '')

  if (grantType === 'authorization_code') {
    return handleAuthCodeGrant(event, f, appSecret)
  }
  if (grantType === 'refresh_token') {
    return handleRefreshGrant(event, f, appSecret)
  }
  return rejectOAuthError(event, 'unsupported_grant_type', `grant_type=${grantType}`)
})

/* ===================================================================
 *  authorization_code → access + refresh
 * =================================================================== */
async function handleAuthCodeGrant(event, f, appSecret) {
  const code = String(f.code || '')
  const codeVerifier = String(f.code_verifier || '')
  const redirectUri = String(f.redirect_uri || '')
  const clientId = String(f.client_id || '')

  if (!code || !codeVerifier || !redirectUri) {
    return rejectOAuthError(event, 'invalid_request', 'code/code_verifier/redirect_uri required')
  }

  const codeData = await consumeAuthCode(code, appSecret)
  if (!codeData) return rejectOAuthError(event, 'invalid_grant', 'code expired or invalid')

  /* ---- redirect_uri 一致性 (防止 client 混淆攻击) ---- */
  if (codeData.redirect_uri !== redirectUri) {
    return rejectOAuthError(event, 'invalid_grant', 'redirect_uri mismatch')
  }
  /* ---- client_id 一致性 (颁码时记录的 client) ---- */
  if (clientId && codeData.client_id && codeData.client_id !== clientId) {
    return rejectOAuthError(event, 'invalid_grant', 'client_id mismatch')
  }

  /* ---- PKCE 校验 ---- */
  const pkceOk = await pkceVerify(codeVerifier, codeData.code_challenge)
  if (!pkceOk) return rejectOAuthError(event, 'invalid_grant', 'pkce verify failed')

  if (!(await markAuthorizationCodeUsed(event, code, codeData))) {
    return rejectOAuthError(event, 'invalid_grant', 'authorization code already used')
  }

  return issueTokenPair(codeData, appSecret)
}

async function markAuthorizationCodeUsed(event, code, codeData) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code)))
  const keyName = `mcp-code:${[...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
  const now = Math.floor(Date.now() / 1000)
  const db = useDb(event)
  const result = await db.insert(usage_records).values({
    project_id: codeData.project_id,
    key_name: keyName,
    date: 'one-time',
    count: 1,
    created_at: now,
    updated_at: now,
  }).onConflictDoNothing({
    target: [usage_records.key_name, usage_records.date],
  })
  return Number(result?.meta?.changes ?? result?.changes ?? result?.rowsAffected ?? 0) === 1
}

/* ===================================================================
 *  refresh_token → 新 access_token (refresh 一并续期)
 * =================================================================== */
async function handleRefreshGrant(event, f, appSecret) {
  const refreshToken = String(f.refresh_token || '')
  if (!refreshToken) return rejectOAuthError(event, 'invalid_request', 'refresh_token required')

  const payload = await verifyMcpRefreshToken(refreshToken, appSecret)
  if (!payload) return rejectOAuthError(event, 'invalid_grant', 'refresh_token expired or invalid')

  return issueTokenPair(payload, appSecret)
}

/* ===================================================================
 *  统一颁发 — 同一身份签 access + refresh, 让两端 ttl 由工具默认决定
 * =================================================================== */
async function issueTokenPair(claims, appSecret) {
  const subject = {
    union_id: claims.union_id,
    project_id: claims.project_id,
    client_id: claims.client_id || '',
    scope: claims.scope || MCP_SCOPE,
  }
  const [access_token, refresh_token] = await Promise.all([
    issueAccessToken(subject, appSecret),
    issueRefreshToken(subject, appSecret),
  ])
  return {
    access_token,
    token_type: 'Bearer',
    expires_in: MCP_ACCESS_TOKEN_TTL_SEC,
    refresh_token,
    scope: subject.scope,
  }
}
