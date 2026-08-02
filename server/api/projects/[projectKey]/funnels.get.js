/* ===================================================================
 * 漏斗列表 - 项目下的全部 status=1 漏斗
 *
 * GET /api/projects/{projectKey}/funnels
 *
 * 排序: id DESC (新建优先)
 * 不调 GA4: 列表只暴露配置, 单卡的"最终转化率"由前端进入详情时另算.
 *           保持列表 endpoint 轻量, 100 ms 内返回.
 * =================================================================== */

import { and, desc, eq } from 'drizzle-orm'
import { project_funnel } from '../../../database/schema'
import { loadOwnedProject } from '../../../utils/project-access'
import { parseSteps } from '../../../utils/funnel-steps'
import { RecordStatus } from '../../../utils/constants'

/* ---- 出参形态: 不暴露 project_id / union_id (内部字段) ---- */
function shapeFunnel(row) {
  const steps = parseSteps(row.steps_config)
  return {
    funnel_key: row.funnel_key,
    project_key: row.project_key,
    name: row.name || '',
    step_count: steps.length,
    steps,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export default defineEventHandler(async (event) => {
  const projectKey = getRouterParam(event, 'projectKey')
  const db = await useDb(event)
  const { user, project } = await loadOwnedProject(event, db, projectKey)

  const rows = await db.select().from(project_funnel)
    .where(and(
      eq(project_funnel.project_id,  user.project_id),
      eq(project_funnel.union_id,    user.union_id),
      eq(project_funnel.project_key, project.project_key),
      eq(project_funnel.status,      RecordStatus.ACTIVE),
    ))
    .orderBy(desc(project_funnel.id))

  return reqSuccess({
    project_key: project.project_key,
    list: rows.map(shapeFunnel),
  })
})
