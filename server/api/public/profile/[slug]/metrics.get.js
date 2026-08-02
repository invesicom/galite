/* ===================================================================
 * GET /api/public/profile/{slug}/metrics?period=28days
 * =================================================================== */

import {
  loadEnabledPublicProfileBySlug,
  listProfilePublicProjects,
  resolvePublicMode,
} from '../../../../utils/public/public-access'
import { loadPublicProfileMetrics } from '../../../../utils/public/public-metrics'
import { enforceBucketRateLimit } from '../../../../utils/rate-limit'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  const query = getQuery(event)
  const db = await useDb(event)
  const siteId = event.context.siteId || ''
  const { profile } = await loadEnabledPublicProfileBySlug(db, siteId, slug)
  await enforceBucketRateLimit(event, {
    scope: 'public_profile_metrics',
    subject: slug,
    limit: 30,
  })
  const rows = await listProfilePublicProjects(db, profile)

  const visible = rows
    .filter((row) => row.setting?.public_project_key)
    .map((row) => ({
      ...row,
      mode: resolvePublicMode(profile.visibility_mode, row.setting.visibility_mode, false),
    }))

  const payload = await loadPublicProfileMetrics(event, db, profile, visible, query.period)
  return reqSuccess(payload)
})
