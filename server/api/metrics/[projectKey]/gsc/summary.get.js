/* ===================================================================
 * GET /api/metrics/{projectKey}/gsc/summary?period=7days
 *
 * GSC 4 个核心指标: impressions / clicks / ctr / position
 * 含 previous_metrics (上一周期, 用于算 delta).
 *
 * 多 site 聚合规则 = aggregateMetrics (位置加权按 impressions):
 *   impressions / clicks 求和
 *   ctr      = clicks / impressions
 *   position = Σ(position * impressions) / Σ(impressions)
 *
 * 缓存:
 *   key = gsc:project:{projectKey}:{period}:summary[:f:...]
 *   TTL = 60s (与 GA4 同口径; GSC 数据 2-3 天延迟, 短 TTL 无害)
 *
 * 错误降级:
 *   - 项目无 GSC 数据源    -> 200, data_sources=[], metrics 全 0
 *   - token 401            -> 该 site 跳过 + status=99, 其他继续
 *   - site 403             -> 仅跳过该 site，不污染账号授权
 *   - GSC quota 429 -> 503 -> reqFail('rate_limited, retry later')
 *
 * 筛选: searchQuery 维度筛选会传给 GSC dimensionFilterGroups (其他维度忽略)
 * =================================================================== */

import { DataSourceProvider, MetricsPeriod, METRICS_CACHE_TTL_MS } from '../../../../utils/constants'
import { isValidPeriod, shiftPreviousAbsolute } from '../../../../utils/period'
import { useDb } from '../../../../utils/db'
import { getAccessToken } from '../../../../utils/data-source-token'
import { runReport, periodToRange, extractTotals, aggregateMetrics } from '../../../../utils/providers/gsc'
import { readCache, writeCache, buildCacheKey } from '../../../../utils/metrics-cache'
import { loadProjectAndSources, markAuthInvalid, dataSourceSummary } from '../../../../utils/metrics-helpers'
import { parseFiltersFromQuery, mapGa4FiltersToGsc, filterCacheKey } from '../../../../utils/filters'

const GSC_METRICS = ['impressions', 'clicks', 'ctr', 'position']

export default defineEventHandler(async (event) => {
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

  /* 把全部 GA4 维度筛选转 GSC 形态 (country/page/device/query 都消费) */
  const allFilters = parseFiltersFromQuery(query)
  const gscFilters = mapGa4FiltersToGsc(allFilters, project)

  const cacheKey = buildCacheKey(['gsc', 'project', projectKey, period, 'summary' + filterCacheKey(gscFilters)])
  const ttlSec = Math.floor(METRICS_CACHE_TTL_MS / 1000)

  const cached = await readCache(db, project.project_id, cacheKey)
  if (cached) return reqSuccess(cached)

  /* 无 GSC 数据源 → 全 0 兜底 */
  if (!sources.length) {
    const empty = buildEmpty(project, period)
    await writeCache(db, project.project_id, cacheKey, empty, ttlSec)
    return reqSuccess(empty)
  }

  const range = periodToRange(period)
  const prevRange = shiftPreviousAbsolute(range)   /* 等长上一周期, custom 与固定周期通用 */

  /* ---- 并发: 每个 site 拉 current + previous totals ---- */
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
      console.error('[metrics/gsc/summary] runReport error:', err?.message || err)
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
