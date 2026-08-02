/* ===================================================================
 * GET /api/widgets
 *
 * 登录用户的 widget 列表.
 * =================================================================== */

import { and, desc, eq } from 'drizzle-orm'
import { public_widget } from '../../database/schema'
import { RecordStatus } from '../../utils/constants'

function parseConfig(raw) {
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

function shape(row) {
  return {
    widget_key: row.widget_key,
    scope: row.scope,
    project_key: row.project_key || '',
    widget_type: row.widget_type,
    visibility_mode: row.visibility_mode,
    metric: row.metric,
    period: row.period,
    title: row.title || '',
    theme: row.theme || 'light',
    accent_color: row.accent_color || '',
    config: parseConfig(row.config_json),
    status: row.status,
    iframe_code: `<iframe src="/widgets/${row.widget_key}" width="360" height="180" loading="lazy" style="border:0;border-radius:12px;overflow:hidden"></iframe>`,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const db = await useDb(event)
  const rows = await db.select().from(public_widget)
    .where(and(
      eq(public_widget.project_id, user.project_id),
      eq(public_widget.union_id, user.union_id),
      eq(public_widget.status, RecordStatus.ACTIVE),
    ))
    .orderBy(desc(public_widget.id))

  return reqSuccess({ list: rows.map(shape) })
})
