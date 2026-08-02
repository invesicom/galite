/* ===================================================================
 * 创建漏斗
 *
 * POST /api/projects/{projectKey}/funnels
 * Body: { name?, steps: [{ name?, kind, match?, value }, ...] }
 *
 * 校验:
 *   - name 0-80 字 (可空, 列表显示用 "Untitled funnel" 兜底)
 *   - steps 2-5 步 (FUNNEL_MIN_STEPS / MAX_STEPS)
 *   - 单项目 ≤ 20 漏斗 (FUNNELS_PER_PROJECT_MAX)
 *   - funnel_key 用 generateUnionId(), 同 project_id 唯一约束兜底重试 1 次
 * =================================================================== */

import { and, eq, sql } from 'drizzle-orm'
import { project_funnel } from '../../../database/schema'
import { loadOwnedProject } from '../../../utils/project-access'
import {
  normalizeSteps,
  parseSteps,
  shapeStep,
  FUNNEL_NAME_MAX,
  FUNNELS_PER_PROJECT_MAX,
} from '../../../utils/funnel-steps'
import { RecordStatus } from '../../../utils/constants'

/* ---- 上限校验 ---- */
async function assertUnderQuota(db, user, projectKey) {
  const row = await getFirst(
    db.select({ c: sql`count(*)`.as('c') }).from(project_funnel)
      .where(and(
        eq(project_funnel.project_id,  user.project_id),
        eq(project_funnel.union_id,    user.union_id),
        eq(project_funnel.project_key, projectKey),
        eq(project_funnel.status,      RecordStatus.ACTIVE),
      )),
  )
  if (Number(row?.c || 0) >= FUNNELS_PER_PROJECT_MAX) {
    return `max_${FUNNELS_PER_PROJECT_MAX}_funnels_per_project`
  }
  return null
}

/* ---- 站点内唯一 funnel_key (碰撞兜底重试 1 次) ---- */
async function pickFunnelKey(db, projectId) {
  for (let i = 0; i < 2; i++) {
    const candidate = generateUnionId()
    const exists = await getFirst(
      db.select({ id: project_funnel.id }).from(project_funnel)
        .where(and(
          eq(project_funnel.project_id, projectId),
          eq(project_funnel.funnel_key, candidate),
        ))
        .limit(1),
    )
    if (!exists) return candidate
  }
  return null
}

export default defineEventHandler(async (event) => {
  const projectKey = getRouterParam(event, 'projectKey')
  const body = await readBody(event)
  const db = await useDb(event)
  const { user, project } = await loadOwnedProject(event, db, projectKey)

  /* ---- 名字归一 (允许空) ---- */
  const name = String(body?.name || '').trim().slice(0, FUNNEL_NAME_MAX)

  /* ---- 步骤校验 ---- */
  const result = normalizeSteps(body?.steps)
  if (result.error) return reqFail(result.error)

  /* ---- 配额 ---- */
  const overflow = await assertUnderQuota(db, user, project.project_key)
  if (overflow) return reqFail(overflow)

  /* ---- funnel_key ---- */
  const funnelKey = await pickFunnelKey(db, user.project_id)
  if (!funnelKey) return reqFail('funnel_key_collision')

  const now = Math.floor(Date.now() / 1000)
  await db.insert(project_funnel).values({
    project_id:  user.project_id,
    union_id:    user.union_id,
    project_key: project.project_key,
    funnel_key:  funnelKey,
    name,
    steps_config: JSON.stringify(result.steps),
    status: RecordStatus.ACTIVE,
    created_at: now,
    updated_at: now,
  })

  const row = await getFirst(
    db.select().from(project_funnel)
      .where(and(
        eq(project_funnel.project_id, user.project_id),
        eq(project_funnel.funnel_key, funnelKey),
      ))
      .limit(1),
  )

  return reqSuccess({
    funnel_key:  row.funnel_key,
    project_key: row.project_key,
    name:        row.name || '',
    step_count:  result.steps.length,
    steps:       parseSteps(row.steps_config).map(shapeStep),
    created_at:  row.created_at,
    updated_at:  row.updated_at,
  })
})
