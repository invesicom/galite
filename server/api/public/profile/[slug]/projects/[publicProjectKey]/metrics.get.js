/* ===================================================================
 * GET /api/public/profile/{slug}/projects/{publicProjectKey}/metrics
 * =================================================================== */

import {
  PublicProjectMode,
  loadPublicProjectByRoute,
  resolvePublicMode,
} from '../../../../../../utils/public/public-access'
import { shapePublicProjectIdentity, shapePublicMetricsDto } from '../../../../../../utils/public/public-dto'
import { loadPublicProjectMetrics } from '../../../../../../utils/public/public-metrics'
import { hasPublicPasswordAccess } from '../../../../../../utils/public/public-password'
import { parseFiltersFromQuery } from '../../../../../../utils/filters'
import { enforceBucketRateLimit } from '../../../../../../utils/rate-limit'
import { realtimeErrorPayload } from '../../../../../../utils/realtime-metrics'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  const publicProjectKey = getRouterParam(event, 'publicProjectKey')
  const query = getQuery(event)
  const db = await useDb(event)
  const siteId = event.context.siteId || ''
  const ctx = await loadPublicProjectByRoute(db, siteId, slug, publicProjectKey, { includeRows: false })
  const hasAccess = await hasPublicPasswordAccess(event, ctx.profile, ctx.setting)
  const mode = resolvePublicMode(ctx.profile.visibility_mode, ctx.setting.visibility_mode, hasAccess)

  if (mode === PublicProjectMode.HIDDEN) {
    throw createError({ statusCode: 403, statusMessage: 'hidden_project' })
  }
  if (mode === PublicProjectMode.PASSWORD) {
    throw createError({ statusCode: 403, statusMessage: 'password_required' })
  }

  await enforceBucketRateLimit(event, {
    scope: 'public_project_metrics',
    subject: `${slug}:${publicProjectKey}`,
    limit: 30,
  })

  const scope = String(query.scope || '')
  const section = String(query.section || '')
  const kind = scope === 'card'
    ? 'card'
    : (['core', 'dims', 'realtime', 'funnels'].includes(section) ? section : 'full')
  const metricsOptions = {
    project: ctx.project,
    setting: ctx.setting,
    ownerUser: ctx.user,
    mode,
    period: query.period,
    kind,
    filters: mode === PublicProjectMode.PUBLIC ? parseFiltersFromQuery(query) : [],
    includeDimensions: mode === PublicProjectMode.PUBLIC && ['full', 'dims'].includes(kind),
    includeTrafficMetricSeries: ['full', 'core'].includes(kind),
    includeRealtime: mode === PublicProjectMode.PUBLIC && ['full', 'realtime'].includes(kind),
    includeFunnels: mode === PublicProjectMode.PUBLIC && ['full', 'funnels'].includes(kind),
  }
  const metrics = await loadPublicProjectMetrics(event, db, metricsOptions).catch((err) => {
    if (kind !== 'realtime') throw err
    console.error('[public-project-metrics] realtime degraded:', err?.message || err)
    return {
      mode,
      period: metricsOptions.period || '28days',
      realtime: realtimeErrorPayload('handler_error'),
      cache_state: 'error-empty',
    }
  })
  setHeader(event, 'Server-Timing', `cache;desc=${metrics.cache_state || (metrics.from_cache ? 'hit' : 'miss')}`)

  return reqSuccess(shapePublicMetricsDto({
    mode,
    project: shapePublicProjectIdentity({ project: ctx.project, setting: ctx.setting, mode, index: ctx.index }),
    traffic: metrics.traffic,
    search: metrics.search,
    realtime: metrics.realtime,
    funnels: metrics.funnels,
  }))
})
