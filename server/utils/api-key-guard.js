/* ===================================================================
 * 统一鉴权守卫 — 开放 API + MCP 共用单一真相源
 *
 * 协议 (三选一, 优先级从上到下):
 *   0. ALS 内部身份 (MCP→v1 转发):  父 event 已在"完整 context"里解析过身份,
 *      经 runWithAmbientUser 推入 ALS, 子请求直取, 不再重验 (见 utils/db.js).
 *   1. Authorization: Bearer <mcp_access JWT, scope=mcp>   (MCP OAuth 主路径)
 *   2. Authorization: Bearer sk-xxxxxxxxxxxx               (脚本/CLI 兜底)
 *
 * 设计 (philosophy_good_taste — 让"什么叫已鉴权"只定义一次):
 *   - resolveUserFromToken(): token → 身份, sk-/oauth 两分支, 共用 loadActiveUser 尾段.
 *   - requireApiKey() / MCP preflight 都调它, 杜绝"一处验签、另一处再验一遍且口径不一"的旧病.
 *   - 注入 event.context.user 形状统一, 下游 (含 metrics 的 requireAuth) 零差别透明复用.
 *   - 单实例边界: 两类凭证都必须归属固定 owner/site 常量，JWT 统一由
 *     本部署的 APP_SECRET 签名。
 * =================================================================== */

import { and, eq } from 'drizzle-orm'
import { user_api_key } from '../database/schema'
import { verifyMcpAccessToken } from './mcp-oauth'
import { getAmbientUser } from './db'
import { getAppSecret, SELF_HOSTED_OWNER_ID, SELF_HOSTED_SITE_ID } from './self-hosted'

const API_KEY_PREFIX = 'sk-'

/* ---- Authorization: Bearer xxx → xxx (供本模块 + MCP 入口共用) ---- */
export function extractBearer(event) {
  const auth = String(getHeader(event, 'authorization') || '')
  if (!auth) return ''
  const m = auth.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : ''
}

/* ===================================================================
 *  共用尾段: 所有凭证最终归一成固定 owner 身份。
 *  sk- 与 oauth 两路在拿到 (union_id, project_id) 后都汇流到这里.
 * =================================================================== */
async function loadActiveUser(_event, union_id, project_id) {
  if (union_id !== SELF_HOSTED_OWNER_ID || project_id !== SELF_HOSTED_SITE_ID) return null
  return { union_id, project_id }
}

/* ===================================================================
 *  MCP OAuth 路径: mcp_access JWT → 身份
 *
 *  token.project_id 即权威站点归属 (签名由本实例 APP_SECRET 保证不可伪造),
 *  token 的 project_id / union_id 必须等于单实例常量。
 * =================================================================== */
async function resolveOAuthUser(event, token) {
  const appSecret = getAppSecret(event)
  if (!appSecret) return null

  const claims = await verifyMcpAccessToken(token, appSecret)
  if (!claims) return null

  const row = await loadActiveUser(event, claims.union_id, claims.project_id)
  if (!row) return null

  return {
    union_id: row.union_id,
    project_id: row.project_id,
    auth_source: 'mcp_oauth',
    /* ---- 限流桶按 client 隔离, 与 sk- 的 id 桶不冲突 ---- */
    api_key_id: `mcp:${claims.client_id || 'anon'}`,
  }
}

/* ===================================================================
 *  sk- 路径: user_api_key 查表 + 站点边界 + last_used 异步刷新
 *
 *  sk- key 必须落在固定 owner/site 边界内。
 * =================================================================== */
async function resolveSkUser(event, token) {
  const db = await useDb(event)

  const keyRow = await getFirst(
    db.select({
      id: user_api_key.id,
      project_id: user_api_key.project_id,
      union_id: user_api_key.union_id,
    })
      .from(user_api_key)
      .where(and(eq(user_api_key.api_key, token), eq(user_api_key.status, 1)))
      .limit(1),
  )
  if (!keyRow) return null

  /* ---- 站点边界: key 只能用在自己归属的站点 ---- */
  if (keyRow.project_id !== SELF_HOSTED_SITE_ID || keyRow.union_id !== SELF_HOSTED_OWNER_ID) return null

  const row = await loadActiveUser(event, keyRow.union_id, keyRow.project_id)
  if (!row) return null

  /* ---- 异步刷新 last_used_at, 不阻塞 ---- */
  const now = Math.floor(Date.now() / 1000)
  const update = db.update(user_api_key)
    .set({ last_used_at: now, updated_at: now })
    .where(eq(user_api_key.id, keyRow.id))
    .catch(() => {})
  if (event.context?.cloudflare?.context) {
    event.context.cloudflare.context.waitUntil(update)
  } else {
    await update
  }

  return {
    union_id: row.union_id,
    project_id: row.project_id,
    auth_source: 'api_key',
    api_key_id: keyRow.id,
  }
}

/* ===================================================================
 *  resolveUserFromToken — 唯一入口: token → 统一 user 身份 (失败返 null)
 *
 *  MCP 入口 (preflight) 与 v1 守卫 (requireApiKey) 都走它, 口径永远一致.
 * =================================================================== */
export async function resolveUserFromToken(event, token) {
  if (!token) return null
  return token.startsWith(API_KEY_PREFIX)
    ? resolveSkUser(event, token)
    : resolveOAuthUser(event, token)
}

/* ===================================================================
 *  requireApiKey — v1 endpoint 鉴权闸门
 *
 *  优先级:
 *    1. ALS 内部身份 (MCP 转发, 已在完整 context 验过) → 直接采信, 零重验.
 *    2. 外部直连: Bearer token → resolveUserFromToken.
 *
 *  ALS 不可被外部 HTTP 注入 (进程内 async chain 私有), 故 #1 不构成伪造面.
 * =================================================================== */
export async function requireApiKey(event) {
  /* ---- 内部转发: 父 event 已解析的身份, 直取不重验 ---- */
  const passed = getAmbientUser()
  if (passed) {
    event.context.user = passed
    return passed
  }

  const token = extractBearer(event)
  if (!token) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      message: 'API key or MCP OAuth bearer required',
    })
  }

  const user = await resolveUserFromToken(event, token)
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized', message: 'Invalid bearer token' })
  }
  event.context.user = user
  return user
}

/* ---- 生成新 API key: sk- + 32 位 base62 ---- */
export function generateApiKey() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let body = ''
  for (let i = 0; i < bytes.length; i++) {
    body += chars[bytes[i] % chars.length]
  }
  return API_KEY_PREFIX + body
}
