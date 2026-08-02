/* ===================================================================
 * 漏斗所有权校验 - 跨用户隔离闸门
 *
 * 任何 [funnelKey] 下的 handler 第一步:
 *   const { user, project, funnel } = await loadOwnedFunnel(event, db, funnelKey)
 *
 * 校验链:
 *   1) requireAuth (注入 user.project_id + union_id)
 *   2) project_funnel 行存在 且 project_id+union_id+status=1 命中
 *   3) project_funnel.project_key 对应 project_list 行也存在且 status=1
 *      (项目软删但 funnel 还在的孤儿情形被这一步拦截)
 *
 * 任何环节失败 -> 404, 不暴露存在性.
 * =================================================================== */

import { and, eq } from 'drizzle-orm'
import { project_funnel, project_list } from '../database/schema'
import { RecordStatus } from './constants'

export async function loadOwnedFunnel(event, db, funnelKey) {
  const user = requireAuth(event)
  const key  = String(funnelKey || '').trim()
  if (!key) throw createError({ statusCode: 404, statusMessage: 'Not Found' })

  /* ---- 漏斗本体 ---- */
  const funnel = await getFirst(
    db.select().from(project_funnel)
      .where(and(
        eq(project_funnel.project_id, user.project_id),
        eq(project_funnel.union_id,   user.union_id),
        eq(project_funnel.funnel_key, key),
        eq(project_funnel.status,     RecordStatus.ACTIVE),
      ))
      .limit(1),
  )
  if (!funnel) throw createError({ statusCode: 404, statusMessage: 'Not Found' })

  /* ---- 关联项目 (软删的项目下 funnel 不再可见) ---- */
  const project = await getFirst(
    db.select().from(project_list)
      .where(and(
        eq(project_list.project_id,  user.project_id),
        eq(project_list.union_id,    user.union_id),
        eq(project_list.project_key, funnel.project_key),
        eq(project_list.status,      RecordStatus.ACTIVE),
      ))
      .limit(1),
  )
  if (!project) throw createError({ statusCode: 404, statusMessage: 'Not Found' })

  return { user, project, funnel }
}
