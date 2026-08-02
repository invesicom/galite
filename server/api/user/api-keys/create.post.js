/* ===================================================================
 * 创建一个新的 API key
 *
 * POST /api/user/api-keys/create
 * Body: { key_name: string }
 *
 * 规则:
 *   - 单用户最多 10 个 key (status=1), 超出拒绝
 *   - key_name 1~50 字符, 去首尾空白
 *   - api_key 由 generateApiKey() 生成, sk- + 32 位 base62, 全表唯一
 * =================================================================== */

import { and, eq } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { user_api_key } from '../../../database/schema'

const MAX_KEYS_PER_USER = 10

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const body = await readBody(event)

  const keyName = String(body?.key_name || '').trim().slice(0, 50)
  if (!keyName) return reqFail('key_name required')

  const db = await useDb(event)

  /* ---- 单用户上限校验 ---- */
  const countRow = await getFirst(
    db.select({ c: sql`count(*)`.as('c') })
      .from(user_api_key)
      .where(and(
        eq(user_api_key.union_id, user.union_id),
        eq(user_api_key.project_id, user.project_id),
        eq(user_api_key.status, 1),
      )),
  )
  const count = Number(countRow?.c || 0)
  if (count >= MAX_KEYS_PER_USER) {
    return reqFail(`max ${MAX_KEYS_PER_USER} api keys per user`)
  }

  /* ---- 生成唯一 key (碰撞概率近 0, 兜底重试一次) ---- */
  let apiKey = generateApiKey()
  const exists = await getFirst(
    db.select({ id: user_api_key.id })
      .from(user_api_key)
      .where(eq(user_api_key.api_key, apiKey))
      .limit(1),
  )
  if (exists) apiKey = generateApiKey()

  const now = Math.floor(Date.now() / 1000)
  await db.insert(user_api_key).values({
    project_id: user.project_id,
    union_id: user.union_id,
    key_name: keyName,
    api_key: apiKey,
    status: 1,
    created_at: now,
    updated_at: now,
  })

  const row = await getFirst(
    db.select({
      id: user_api_key.id,
      key_name: user_api_key.key_name,
      api_key: user_api_key.api_key,
      last_used_at: user_api_key.last_used_at,
      created_at: user_api_key.created_at,
    })
      .from(user_api_key)
      .where(eq(user_api_key.api_key, apiKey))
      .limit(1),
  )

  return reqSuccess(row)
})
