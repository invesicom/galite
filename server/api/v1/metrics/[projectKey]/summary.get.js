/* ===================================================================
 * v1 · GET /api/v1/metrics/{projectKey}/summary?period=7days
 *
 * 与内部 /api/metrics/{projectKey}/summary 字段一字不差
 * 唯一差异: sk- 鉴权 + 60req/min 限流入口
 *
 * 实现:
 *   - 直接复用 utils/metrics-helpers 与 utils/providers/ga4
 *   - 内部 loadProjectAndSources 调 requireAuth, requireApiKey 已写入
 *     event.context.user, 形态一致, 透明复用
 *
 * 待 Agent C 把 handler body 抽到 utils/metrics-service.js::summary(),
 * 我们就改成单行 import + 调用 (philosophy_pragmatism: 现在直接镜像)
 * =================================================================== */

import { GA4_CORE_METRICS, MetricsPeriod, METRICS_CACHE_TTL_MS } from '../../../../utils/constants'
import { isValidPeriod } from '../../../../utils/period'
import { getAccessToken } from '../../../../utils/data-source-token'
import { runReport, periodToRange, previousPeriodRange, extractTotals, aggregateMetrics } from '../../../../utils/providers/ga4'
import { readCache, staleCacheOptions, writeCache, buildCacheKey } from '../../../../utils/metrics-cache'
import { loadProjectAndSources, markAuthInvalid, dataSourceSummary } from '../../../../utils/metrics-helpers'
import { parseFiltersFromQuery, buildDimensionFilter, filterCacheKey } from '../../../../utils/filters'

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
  const { project, sources, jwtSecret, siteConfig } = await loadProjectAndSources(event, db, projectKey)

  /* filters[]: 解析 query 里的 ?f=dim:match:value, 进 cacheKey + GA4 dimensionFilter
     与 internal endpoint 行为对齐, sk- API key 用户能用同款筛选 */
  const filters = parseFiltersFromQuery(query)
  const dimensionFilter = buildDimensionFilter(filters)

  const cacheKey = buildCacheKey(['ga4', 'project', projectKey, period, 'summary' + filterCacheKey(filters)])
  const ttlSec = Math.floor(METRICS_CACHE_TTL_MS / 1000)

  const cached = await readCache(db, project.project_id, cacheKey, staleCacheOptions(event))
  if (cached) return reqSuccess(cached)

  if (!sources.length) {
    const empty = buildEmpty(project, period)
    await writeCache(db, project.project_id, cacheKey, empty, ttlSec)
    return reqSuccess(empty)
  }

  const range = periodToRange(period)
  const prevRange = previousPeriodRange(period)

  const tasks = sources.map(async ({ ds, auth }) => {
    if (auth.status !== 1) return { ds, auth, skip: true }

    let accessToken
    try {
      accessToken = await getAccessToken(db, auth, jwtSecret, siteConfig)
    } catch {
      return { ds, auth: { ...auth, status: 99 }, skip: true }
    }

    try {
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
      if (err?.statusCode === 503) throw err
      console.error('[v1/metrics/summary] runReport error:', err?.message || err)
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
