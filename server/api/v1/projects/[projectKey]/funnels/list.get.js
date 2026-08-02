/* ===================================================================
 * v1 · 漏斗列表 (开放 API)
 *
 * GET /api/v1/projects/{projectKey}/funnels/list
 *   Authorization: Bearer sk-xxxxxxxxxxxx
 *
 * 与内部 /api/projects/{projectKey}/funnels 字段一字不差
 * 复用闸门: guardV1 (sk- / mcp_access) 已注入 event.context.user,
 *           loadOwnedProject 形态同 JWT 路径
 * =================================================================== */

import { and, desc, eq } from 'drizzle-orm'
import { project_funnel } from '../../../../../database/schema'
import { loadOwnedProject } from '../../../../../utils/project-access'
import { parseSteps } from '../../../../../utils/funnel-steps'
import { RecordStatus } from '../../../../../utils/constants'

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
  await guardV1(event)

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
