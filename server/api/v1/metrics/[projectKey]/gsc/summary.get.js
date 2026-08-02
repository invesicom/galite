/* ===================================================================
 * v1 · GET /api/v1/metrics/{projectKey}/gsc/summary?period=7days
 *
 * 与内部 /api/metrics/{projectKey}/gsc/summary 字段一字不差
 * 唯一差异: sk- 鉴权 + 60req/min 限流
 *
 * GSC 4 个核心指标: impressions / clicks / ctr / position
 * 含 previous_metrics (上一周期, 用于算 delta).
 *
 * 筛选: ?f=dim:match:value 系列, 跟 GA4 同 URL 协议;
 *       searchQuery / pagePath / country / deviceCategory 维度会被 GSC 消费,
 *       其他 (sessionSource / browser ...) 自动 skip (GSC 无对应概念).
 * =================================================================== */

import { DataSourceProvider, MetricsPeriod, METRICS_CACHE_TTL_MS } from '../../../../../utils/constants'
import { isValidPeriod, shiftPreviousAbsolute } from '../../../../../utils/period'
import { useDb } from '../../../../../utils/db'
import { getAccessToken } from '../../../../../utils/data-source-token'
import { runReport, periodToRange, extractTotals, aggregateMetrics } from '../../../../../utils/providers/gsc'
import { readCache, staleCacheOptions, writeCache, buildCacheKey } from '../../../../../utils/metrics-cache'
import { loadProjectAndSources, markAuthInvalid, dataSourceSummary } from '../../../../../utils/metrics-helpers'
import { parseFiltersFromQuery, mapGa4FiltersToGsc, filterCacheKey } from '../../../../../utils/filters'

const GSC_METRICS = ['impressions', 'clicks', 'ctr', 'position']

export default defineEventHandler(async (event) => {
  /* ---- sk- 鉴权 + 限流 ---- */
  await guardV1(event)

  const projectKey = getRouterParam(event, 'projectKey')
  const query = getQuery(event)
  const period = String(query.period || MetricsPeriod.LAST_7_DAYS)
  if (!isValidPeriod(period)) {
    return reqFail('invalid_period')
  }

  const db = await useDb(event)
  const { project, sources, jwtSecret, siteConfig } = await loadProjectAndSources(
    event, db, projectKey, { provider: DataSourceProvider.GSC },
  )

  const allFilters = parseFiltersFromQuery(query)
  const gscFilters = mapGa4FiltersToGsc(allFilters, project)

  const cacheKey = buildCacheKey(['gsc', 'project', projectKey, period, 'summary' + filterCacheKey(gscFilters)])
  const ttlSec = Math.floor(METRICS_CACHE_TTL_MS / 1000)

  const cached = await readCache(db, project.project_id, cacheKey, staleCacheOptions(event))
  if (cached) return reqSuccess(cached)

  if (!sources.length) {
    const empty = buildEmpty(project, period)
    await writeCache(db, project.project_id, cacheKey, empty, ttlSec)
    return reqSuccess(empty)
  }

  const range = periodToRange(period)
  const prevRange = shiftPreviousAbsolute(range)   /* 等长上一周期, custom 与固定周期通用 */

  const tasks = sources.map(async ({ ds, auth }) => {
    if (auth.status !== 1) return { ds, auth, skip: true }

    let accessToken
    try {
      accessToken = await getAccessToken(db, auth, jwtSecret, siteConfig)
    } catch {
      return { ds, auth: { ...auth, status: 99 }, skip: true }
    }

    try {
      const [report, prevReport] = await Promise.all([
        runReport({
          accessToken,
          siteUrl: ds.resource_id,
          startDate: range.startDate,
          endDate: range.endDate,
          dimensions: [],
          rowLimit: 1,
          filters: gscFilters,
        }),
        runReport({
          accessToken,
          siteUrl: ds.resource_id,
          startDate: prevRange.startDate,
          endDate: prevRange.endDate,
          dimensions: [],
          rowLimit: 1,
          filters: gscFilters,
        }),
      ])
      return {
        ds, auth, skip: false,
        totals:     extractTotals(report),
        prevTotals: extractTotals(prevReport),
      }
    } catch (err) {
      if (err?.statusCode === 401) {
        await markAuthInvalid(db, auth.id)
        return { ds, auth: { ...auth, status: 99 }, skip: true }
      }
      if (err?.statusCode === 503) throw err
      console.error('[v1/metrics/gsc/summary] runReport error:', err?.message || err)
      return { ds, auth, skip: true }
    }
  })

  let results
  try {
    results = await Promise.all(tasks)
  } catch (err) {
    if (err?.statusCode === 503) return reqFail('rate_limited, retry later')
    throw err
  }

  const usable = results.filter((r) => !r.skip)
  const metrics = aggregateMetrics(usable.map((r) => r.totals))
  const previousMetrics = aggregateMetrics(usable.map((r) => r.prevTotals))

  const payload = {
    project_key: project.project_key,
    period,
    data_sources: results.map((r) => dataSourceSummary({ ds: r.ds, auth: r.auth })),
    metrics,
    previous_metrics: previousMetrics,
    fetched_at: Math.floor(Date.now() / 1000),
  }

  await writeCache(db, project.project_id, cacheKey, payload, ttlSec)
  return reqSuccess(payload)
})

function buildEmpty(project, period) {
  const zeros = {}
  for (const m of GSC_METRICS) zeros[m] = 0
  return {
    project_key: project.project_key,
    period,
    data_sources: [],
    metrics: zeros,
    previous_metrics: { ...zeros },
    fetched_at: Math.floor(Date.now() / 1000),
  }
}
