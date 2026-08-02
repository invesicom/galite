/* ===================================================================
 * POST /api/widgets/{widgetKey}/update
 * =================================================================== */

import { and, eq } from 'drizzle-orm'
import { public_widget } from '../../../database/schema'
import { MetricsPeriod } from '../../../utils/constants'
import { getFirst } from '../../../utils/db'
import { loadOwnedProject } from '../../../utils/project-access'

const SCOPES = new Set(['profile', 'project'])
const TYPES = new Set(['metric_card', 'timeseries', 'profile_summary', 'search_card'])
const VISIBILITY = new Set(['public', 'semi_public'])
const PERIODS = new Set([MetricsPeriod.LAST_7_DAYS, MetricsPeriod.LAST_28_DAYS, MetricsPeriod.LAST_90_DAYS])

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const widgetKey = getRouterParam(event, 'widgetKey')
  const body = await readBody(event)
  const db = await useDb(event)

  const row = await getFirst(
    db.select().from(public_widget)
      .where(and(
        eq(public_widget.project_id, user.project_id),
        eq(public_widget.union_id, user.union_id),
        eq(public_widget.widget_key, widgetKey),
      ))
      .limit(1),
  )
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Not Found' })

  const scope = SCOPES.has(body?.scope) ? body.scope : row.scope
  const projectKey = scope === 'project'
    ? String(body?.project_key ?? row.project_key ?? '').trim()
    : ''
  if (scope === 'project') {
    if (!projectKey) return reqFail('project_required')
    await loadOwnedProject(event, db, projectKey)
  }

  const patch = {
    scope,
    project_key: projectKey,
    widget_type: TYPES.has(body?.widget_type) ? body.widget_type : row.widget_type,
    visibility_mode: VISIBILITY.has(body?.visibility_mode) ? body.visibility_mode : row.visibility_mode,
    metric: String(body?.metric ?? row.metric ?? 'totalUsers').trim().slice(0, 64),
    period: PERIODS.has(body?.period) ? body.period : row.period,
    title: String(body?.title ?? row.title ?? '').trim().slice(0, 255),
    theme: String(body?.theme ?? row.theme ?? 'light').trim().slice(0, 50),
    accent_color: String(body?.accent_color ?? row.accent_color ?? '').trim().slice(0, 20),
    config_json: JSON.stringify(body?.config && typeof body.config === 'object' ? body.config : {}),
    updated_at: Math.floor(Date.now() / 1000),
  }

  await db.update(public_widget).set(patch)
    .where(and(
      eq(public_widget.project_id, user.project_id),
      eq(public_widget.union_id, user.union_id),
      eq(public_widget.widget_key, widgetKey),
    ))

  return reqSuccess({ widget_key: widgetKey }, 'saved')
})
