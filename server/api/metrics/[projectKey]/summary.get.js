/* ===================================================================
 * GET /api/metrics/{projectKey}/summary?period=7days
 *
 * 输出 8 个核心指标 + previous_metrics (上一周期, 用于算 delta).
 * 多 property 聚合规则见 utils/providers/ga4.js::aggregateMetrics
 *
 * 缓存:
 *   key = ga4:project:{projectKey}:{period}:summary
 *   TTL = METRICS_CACHE_TTL_MS / 1000 = 60s
 *
 * 错误降级:
 *   - 项目无 GA4 数据源 -> 200, data_sources=[], metrics 全 0
 *   - token 401         -> 该 source 跳过 + status=99, 其他 source 继续
 *   - property 403/404  -> 仅跳过该 source，不污染账号授权
 *   - GA4 quota 503     -> reqFail('rate_limited, retry later')
 * =================================================================== */

import { GA4_CORE_METRICS, MetricsPeriod, METRICS_CACHE_TTL_MS } from '../../../utils/constants'
import { isValidPeriod } from '../../../utils/period'
import { useDb } from '../../../utils/db'
import { getAccessToken } from '../../../utils/data-source-token'
import { runReport, periodToRange, previousPeriodRange, extractTotals, aggregateMetrics } from '../../../utils/providers/ga4'
import { readCache, writeCache, buildCacheKey } from '../../../utils/metrics-cache'
import { loadProjectAndSources, markAuthInvalid, dataSourceSummary } from '../../../utils/metrics-helpers'
import { parseFiltersFromQuery, buildDimensionFilter, filterCacheKey } from '../../../utils/filters'

export default defineEventHandler(async (event) => {
  const projectKey = getRouterParam(event, 'projectKey')
  const query = getQuery(event)
  const period = String(query.period || MetricsPeriod.LAST_7_DAYS)
  if (!isValidPeriod(period)) {
    return reqFail('invalid_period')
  }

  const db = await useDb(event)
  const { project, sources, jwtSecret, siteConfig } = await loadProjectAndSources(event, db, projectKey)

  /* 解析 filters[] (含进 cache key + GA4 dimensionFilter) */
  const filters = parseFiltersFromQuery(query)
  const dimensionFilter = buildDimensionFilter(filters)

  const cacheKey = buildCacheKey(['ga4', 'project', projectKey, period, 'summary' + filterCacheKey(filters)])
  const ttlSec = Math.floor(METRICS_CACHE_TTL_MS / 1000)

  /* ---- 缓存命中直接返回 ---- */
  const cached = await readCache(db, project.project_id, cacheKey)
  if (cached) return reqSuccess(cached)

  /* ---- 项目无任何数据源: 不调 API, 直接全 0 ---- */
  if (!sources.length) {
    const empty = buildEmpty(project, period)
    await writeCache(db, project.project_id, cacheKey, empty, ttlSec)
    return reqSuccess(empty)
  }

  const range = periodToRange(period)
  const prevRange = previousPeriodRange(period)

  /* ---- 并发拉每个 property 的 totals (current + previous 一次请求) ---- */
  const tasks = sources.map(async ({ ds, auth }) => {
    /* auth 已失效, 跳过 */
    if (auth.status !== 1) return { ds, auth, skip: true }

    let accessToken
    try {
      accessToken = await getAccessToken(db, auth, jwtSecret, siteConfig)
    } catch (err) {
      /* getAccessToken 失败时已自行置 status=99, 这里只跳过 */
      return { ds, auth: { ...auth, status: 99 }, skip: true }
    }

    try {
      /* GA4 一次接受多 dateRange, 返回每个 range 的 totals */
      const report = await runReport({
        accessToken,
        propertyId: ds.resource_id,
        dateRanges: [
          { name: 'current', startDate: range.startDate, endDate: range.endDate },
          { name: 'previous', startDate: prevRange.startDate, endDate: prevRange.endDate },
        ],
        metrics: GA4_CORE_METRICS,
        dimensionFilter,
      })
      return {
        ds,
        auth,
        skip: false,
        totals: extractTotals(report, GA4_CORE_METRICS, 0),
        prevTotals: extractTotals(report, GA4_CORE_METRICS, 1),
      }
    } catch (err) {
      if (err?.statusCode === 401) {
        await markAuthInvalid(db, auth.id)
        return { ds, auth: { ...auth, status: 99 }, skip: true }
      }
      if (err?.statusCode === 503) throw err  // 上抛 quota
      console.error('[metrics/summary] runReport error:', err?.message || err)
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

  /* ---- 聚合 ---- */
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

/* ---- 项目无数据源时的 0 值结构 (保持 schema 与正常返回一致) ---- */
function buildEmpty(project, period) {
  const zeros = {}
  for (const name of GA4_CORE_METRICS) zeros[name] = 0
  return {
    project_key: project.project_key,
    period,
    data_sources: [],
    metrics: zeros,
    previous_metrics: { ...zeros },
    fetched_at: Math.floor(Date.now() / 1000),
  }
}
