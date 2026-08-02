/* ===================================================================
 * GET /api/metrics/overview/search?period=7days
 * =================================================================== */

import { MetricsPeriod } from '../../../utils/constants'
import { buildSearchOverview } from '../../../utils/search-overview'
import { SEARCH_PROVIDERS } from '../../../utils/search-metrics'

export default defineEventHandler(async (event) => {
  const period = String(getQuery(event).period || MetricsPeriod.LAST_7_DAYS)
  const { error, payload } = await buildSearchOverview(event, {
    providers: SEARCH_PROVIDERS,
    cachePrefix: 'search',
    period,
  })
  if (error) return reqFail(error)
  return reqSuccess(payload)
})
