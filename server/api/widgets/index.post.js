/* ===================================================================
 * POST /api/widgets
 *
 * 创建公开 iframe widget. widget 不支持 password 模式.
 * =================================================================== */

import { and, eq } from 'drizzle-orm'
import { public_widget } from '../../database/schema'
import { MetricsPeriod, RecordStatus } from '../../utils/constants'
import { generateUnionCode } from '../../utils/ids'
import { loadOwnedProject } from '../../utils/project-access'
import { getFirst } from '../../utils/db'

const SCOPES = new Set(['profile', 'project'])
const TYPES = new Set(['metric_card', 'timeseries', 'profile_summary', 'search_card'])
const VISIBILITY = new Set(['public', 'semi_public'])
const PERIODS = new Set([MetricsPeriod.LAST_7_DAYS, MetricsPeriod.LAST_28_DAYS, MetricsPeriod.LAST_90_DAYS])

async function generateWidgetKey(db, projectId) {
  for (let i = 0; i < 20; i++) {
    const key = `wdg_${generateUnionCode(10)}`
    const exists = await getFirst(
      db.select({ id: public_widget.id })
        .from(public_widget)
        .where(and(eq(public_widget.project_id, projectId), eq(public_widget.widget_key, key)))
        .limit(1),
    )
    if (!exists) return key
  }
  return `wdg_${generateUnionCode(14)}`
}

function clean(body) {
  const scope = SCOPES.has(body?.scope) ? body.scope : 'profile'
  const widgetType = TYPES.has(body?.widget_type) ? body.widget_type : (scope === 'profile' ? 'profile_summary' : 'metric_card')
  const visibilityMode = VISIBILITY.has(body?.visibility_mode) ? body.visibility_mode : 'semi_public'
  const period = PERIODS.has(body?.period) ? body.period : MetricsPeriod.LAST_28_DAYS
  return {
    scope,
    project_key: scope === 'project' ? String(body?.project_key || '').trim() : '',
    widget_type: widgetType,
    visibility_mode: visibilityMode,
    metric: String(body?.metric || 'totalUsers').trim().slice(0, 64),
    period,
    title: String(body?.title || '').trim().slice(0, 255),
    theme: String(body?.theme || 'light').trim().slice(0, 50),
    accent_color: String(body?.accent_color || '').trim().slice(0, 20),
    config_json: JSON.stringify(body?.config && typeof body.config === 'object' ? body.config : {}),
  }
}

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const body = await readBody(event)
  const db = await useDb(event)

  const patch = clean(body)
  if (patch.scope === 'project') {
    if (!patch.project_key) return reqFail('project_required')
    await loadOwnedProject(event, db, patch.project_key)
  }

  const now = Math.floor(Date.now() / 1000)
  const widgetKey = await generateWidgetKey(db, user.project_id)
  await db.insert(public_widget).values({
    project_id: user.project_id,
    union_id: user.union_id,
    widget_key: widgetKey,
    status: RecordStatus.ACTIVE,
    created_at: now,
    updated_at: now,
    ...patch,
  })

  return reqSuccess({ widget_key: widgetKey }, 'created')
})
