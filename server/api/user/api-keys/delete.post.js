/* ===================================================================
 * 删除一个 API key (软删, status=97)
 *
 * POST /api/user/api-keys/delete
 * Body: { id: number }
 * =================================================================== */

import { and, eq } from 'drizzle-orm'
import { user_api_key } from '../../../database/schema'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const body = await readBody(event)

  const id = Number(body?.id)
  if (!Number.isInteger(id) || id <= 0) return reqFail('id required')

  const db = await useDb(event)
  const now = Math.floor(Date.now() / 1000)

  await db.update(user_api_key)
    .set({ status: 97, updated_at: now })
    .where(and(
      eq(user_api_key.id, id),
      eq(user_api_key.union_id, user.union_id),
      eq(user_api_key.project_id, user.project_id),
    ))

  return reqSuccess(null)
})
