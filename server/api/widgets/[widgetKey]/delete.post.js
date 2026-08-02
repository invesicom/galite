/* ===================================================================
 * POST /api/widgets/{widgetKey}/delete
 * =================================================================== */

import { and, eq } from 'drizzle-orm'
import { public_widget } from '../../../database/schema'
import { RecordStatus } from '../../../utils/constants'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const widgetKey = getRouterParam(event, 'widgetKey')
  const db = await useDb(event)

  await db.update(public_widget)
    .set({ status: RecordStatus.DELETED, updated_at: Math.floor(Date.now() / 1000) })
    .where(and(
      eq(public_widget.project_id, user.project_id),
      eq(public_widget.union_id, user.union_id),
      eq(public_widget.widget_key, widgetKey),
    ))

  return reqSuccess(null, 'deleted')
})
