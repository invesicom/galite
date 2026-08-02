/* ===================================================================
 * 开放 API 速率限制 — 单 sk- key 60 req/min
 *
 * 设计:
 *   - usage_records 已有 (key_name, date) UNIQUE, 复用为分钟桶计数器
 *   - bucket key  : ratelimit_{api_key_id}_{YYYYMMDDHHMM}    (UTC 分钟)
 *   - bucket date : YYYY-MM-DD                                (UTC 日)
 *   - 命中 +1; 超限抛 429 + Retry-After: 60
 *
 * 哲学:
 *   - D1 的 INSERT ... ON CONFLICT DO UPDATE 原子 +1，让并发竞争自然消失。
 *   - 同一张 usage_records 表同时承载管理员登录、公开解锁、API 与 MCP 分桶。
 *
 * 依赖:
 *   - utils/db.js     useDb(event)
 *   - utils/api-key-guard.js  注入 event.context.user.api_key_id
 * =================================================================== */

import { and, eq, lte, sql } from 'drizzle-orm'
import { usage_records } from '../database/schema'
import { getAmbientUser } from './db'

/* ---- 默认配额: 单 key 每分钟 60 次 ---- */
export const RATE_LIMIT_PER_MINUTE = 60
export const MCP_RATE_LIMIT_PER_MINUTE = 120

/* ---- UTC 分钟 / 日期键格式化 ---- */
function pad2(n) { return String(n).padStart(2, '0') }
function utcMinuteKey(d = new Date()) {
  return [
    d.getUTCFullYear(),
    pad2(d.getUTCMonth() + 1),
    pad2(d.getUTCDate()),
    pad2(d.getUTCHours()),
    pad2(d.getUTCMinutes()),
  ].join('')
}
function utcDateStr(d = new Date()) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

function clientIp(event) {
  return String(
    getRequestHeader(event, 'cf-connecting-ip')
    || getRequestHeader(event, 'x-real-ip')
    || String(getRequestHeader(event, 'x-forwarded-for') || '').split(',')[0]
    || getRequestIP(event, { xForwardedFor: true })
    || 'unknown',
  ).trim() || 'unknown'
}

function safeBucketPart(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9:_-]/g, '_')
    .slice(0, 160)
}

async function hitRateLimitBucket(event, { bucket, limit }) {
  const safeLimit = Number(limit) || RATE_LIMIT_PER_MINUTE
  const key = safeBucketPart(bucket)
  const date = utcDateStr()
  const now = Math.floor(Date.now() / 1000)
  const db = await useDb(event)

  await db.insert(usage_records).values({
    project_id: event.context.siteId || 'self-hosted',
    key_name: key,
    date,
    count: 1,
    created_at: now,
    updated_at: now,
  }).onConflictDoUpdate({
    target: [usage_records.key_name, usage_records.date],
    set: {
      count: sql`${usage_records.count} + 1`,
      updated_at: now,
    },
  })

  const row = await getFirst(
    db.select({ count: usage_records.count })
      .from(usage_records)
      .where(and(eq(usage_records.key_name, key), eq(usage_records.date, date)))
      .limit(1),
  )
  const current = Number(row?.count || 0)

  setHeader(event, 'X-RateLimit-Limit', String(safeLimit))
  setHeader(event, 'X-RateLimit-Remaining', String(Math.max(0, safeLimit - current)))

  if (current > safeLimit) {
    setHeader(event, 'Retry-After', '60')
    setHeader(event, 'X-RateLimit-Remaining', '0')
    throw createError({
      statusCode: 429,
      statusMessage: 'Too Many Requests',
      message: `rate limit exceeded: ${safeLimit} req/min`,
    })
  }
}

export async function enforceBucketRateLimit(event, opts = {}) {
  const scope = safeBucketPart(opts.scope || 'public')
  const subject = safeBucketPart(opts.subject || 'global')
  const ip = safeBucketPart(opts.ip || clientIp(event))
  const bucket = `ratelimit:${scope}:${subject}:${ip}:${utcMinuteKey()}`
  await hitRateLimitBucket(event, { bucket, limit: opts.limit })
}

/* ===================================================================
 *  enforceRateLimit(event, opts?)
 *
 *  必须在 requireApiKey(event) 之后调用 — 依赖 api_key_id
 *  超限时直接 throw createError(429), 调用方无需处理
 *
 *  opts.limit  — 覆盖默认 60
 *  opts.bucket — 覆盖 bucket key (留给未来按 endpoint 限流的扩展)
 * =================================================================== */
export async function enforceRateLimit(event, opts = {}) {
  const apiKeyId = event.context.user?.api_key_id
  if (!apiKeyId) return                              /* 非 API key 入口直接放行 */

  const fallbackLimit = event.context.user?.auth_source === 'mcp_oauth'
    ? MCP_RATE_LIMIT_PER_MINUTE
    : RATE_LIMIT_PER_MINUTE
  const limit = Number(opts.limit) || fallbackLimit
  const bucket = opts.bucket || `ratelimit_${apiKeyId}_${utcMinuteKey()}`
  await hitRateLimitBucket(event, { bucket, limit })
}

/* ===================================================================
 *  guardV1(event)  — v1 endpoint 标准入口
 *
 *  把 "鉴权 + 限流" 合并成一行, 调用方写起来更清爽:
 *    const user = await guardV1(event)
 *
 *  返回 user (与 requireApiKey 一致), 失败已抛 401 / 429
 * =================================================================== */
export async function guardV1(event) {
  const user = await requireApiKey(event)
  const internalComposite = Boolean(getAmbientUser())
    && getRequestHeader(event, 'x-mcp-internal-composite') === '1'
  if (internalComposite) return user
  await enforceRateLimit(event)
  return user
}

/* 分钟桶只服务短期限流，保留两天足以覆盖时钟偏差与排障。 */
export async function purgeExpiredRateLimitBuckets(db, now = Math.floor(Date.now() / 1000)) {
  if (!db) return 0
  const result = await db.delete(usage_records)
    .where(lte(usage_records.updated_at, Number(now) - 2 * 24 * 60 * 60))
  const head = Array.isArray(result) ? result[0] : result
  return Number(head?.meta?.changes ?? head?.changes ?? head?.rowsAffected ?? 0)
}
