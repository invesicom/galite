/* ===================================================================
 * 单实例项目访问闸门
 *
 * 开源版没有套餐或用户层级；所有 owner 项目都可见，所有功能均开启。
 * =================================================================== */

import { and, eq } from 'drizzle-orm'
import { project_list } from '../database/schema'
import { RecordStatus } from './constants'

export async function loadOwnedProject(event, db, projectKey) {
  const user = requireAuth(event)
  const key = String(projectKey || '').trim()
  if (!key) throw createError({ statusCode: 404, statusMessage: 'Not Found' })

  const row = await getFirst(
    db.select().from(project_list)
      .where(and(
        eq(project_list.project_id, user.project_id),
        eq(project_list.union_id, user.union_id),
        eq(project_list.project_key, key),
        eq(project_list.status, RecordStatus.ACTIVE),
      ))
      .limit(1),
  )
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  return { user, project: row }
}
