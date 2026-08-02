/* ===================================================================
 * 列出当前用户的 API keys
 *
 * GET /api/user/api-keys/list
 *
 * 响应字段:
 *   id / key_name / api_key (完整密钥, 用户可随时复制查看) /
 *   last_used_at / created_at
 *
 * 设计说明:
 *   完整 key 仅返回给账号本人 (requireAuth 已校验), 与 GitHub/Stripe 等
 *   "创建后不可再读" 模式不同 — 这是为了让用户在 SDK/Skill 集成时
 *   可以直接在 Account 页面复制粘贴, 实用 > 仪式感.
 * =================================================================== */

import { and, asc, eq } from 'drizzle-orm'
import { user_api_key } from '../../../database/schema'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const db = await useDb(event)

  const rows = await db.select({
    id: user_api_key.id,
    key_name: user_api_key.key_name,
    api_key: user_api_key.api_key,
    last_used_at: user_api_key.last_used_at,
    created_at: user_api_key.created_at,
  })
    .from(user_api_key)
    .where(and(
      eq(user_api_key.union_id, user.union_id),
      eq(user_api_key.project_id, user.project_id),
      eq(user_api_key.status, 1),
    ))
    .orderBy(asc(user_api_key.id))

  return reqSuccess(rows)
})
