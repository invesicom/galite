/* ===================================================================
 * GET /api/metrics/overview/bing?period=7days
 * =================================================================== */

import { DataSourceProvider, MetricsPeriod } from '../../../utils/constants'
import { buildSearchOverview } from '../../../utils/search-overview'

export default defineEventHandler(async (event) => {
  const period = String(getQuery(event).period || MetricsPeriod.LAST_7_DAYS)
  const { error, payload } = await buildSearchOverview(event, {
    providers: [DataSourceProvider.BING],
    cachePrefix: DataSourceProvider.BING,
    period,
  })
  if (error) return reqFail(error)
  return reqSuccess(payload)
})
