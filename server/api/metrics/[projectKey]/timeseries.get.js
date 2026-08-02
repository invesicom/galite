/* ===================================================================
 * GET /api/metrics/{projectKey}/timeseries?period=7days&metric=screenPageViews
 *
 * 输出:
 *   labels: ["2026-05-01", ...] (granularity=day) 或 ["00", "01", ...] (hour)
 *   series: [{ auth_id, resource_id, label, data: [...] }, ...]   按 source 拆开
 *
 * granularity:
 *   today/yesterday -> "hour"  (dim: hour)
 *   其他            -> "day"   (dim: date)
 *
 * 缓存:
 *   key = ga4:project:{projectKey}:{period}:timeseries:{metric}
 *   TTL = 60s
 * =================================================================== */

import { GA4_CORE_METRICS, MetricsPeriod, METRICS_CACHE_TTL_MS } from '../../../utils/constants'
import { isValidPeriod } from '../../../utils/period'
import { useDb } from '../../../utils/db'
import { getAccessToken } from '../../../utils/data-source-token'
import { runReport, periodToRange, granularityOf, extractRows } from '../../../utils/providers/ga4'
import { readCache, writeCache, buildCacheKey } from '../../../utils/metrics-cache'
import { loadProjectAndSources } from '../../../utils/metrics-helpers'
import { parseFiltersFromQuery, buildDimensionFilter, filterCacheKey } from '../../../utils/filters'

export default defineEventHandler(async (event) => {
  const projectKey = getRouterParam(event, 'projectKey')
  const query = getQuery(event)
  const period = String(query.period || MetricsPeriod.LAST_7_DAYS)
  const metric = String(query.metric || 'screenPageViews')

  if (!isValidPeriod(period)) return reqFail('invalid_period')
  if (!GA4_CORE_METRICS.includes(metric)) return reqFail('invalid_metric')

  const db = await useDb(event)
  const { project, sources, jwtSecret, siteConfig } = await loadProjectAndSources(event, db, projectKey)

  /* filters → dimensionFilter + cache key */
  const filters = parseFiltersFromQuery(query)
  const dimensionFilter = buildDimensionFilter(filters)

  const cacheKey = buildCacheKey(['ga4', 'project', projectKey, period, 'timeseries', metric + filterCacheKey(filters)])
  const ttlSec = Math.floor(METRICS_CACHE_TTL_MS / 1000)

  const cached = await readCache(db, project.project_id, cacheKey)
  if (cached) return reqSuccess(cached)

  const granularity = granularityOf(period)
  const dimName = granularity === 'hour' ? 'hour' : 'date'

  /* ---- 项目无数据源: 返回空 series ---- */
  if (!sources.length) {
    const empty = { period, granularity, metric, labels: [], series: [] }
    await writeCache(db, project.project_id, cacheKey, empty, ttlSec)
    return reqSuccess(empty)
  }

  const range = periodToRange(period)

  /* ---- 拉每个 source 的时序 ---- */
  const sourceSeries = []
  const labelSet = new Set()  /* 收集所有 label, 缺失的点补 0 */

  for (const { ds, auth } of sources) {
    if (auth.status !== 1) continue

    let accessToken
    try {
      accessToken = await getAccessToken(db, auth, jwtSecret, siteConfig)
    } catch {
      continue
    }

    let report
    try {
      report = await runReport({
        accessToken,
        propertyId: ds.resource_id,
        startDate: range.startDate,
        endDate: range.endDate,
        metrics: [metric],
        dimensions: [dimName],
        orderBys: [{ dimension: { dimensionName: dimName }, desc: false }],
        limit: 100000,
        dimensionFilter,
      })
    } catch (err) {
      if (err?.statusCode === 503) return reqFail('rate_limited, retry later')
      console.error('[metrics/timeseries] runReport error:', err?.message || err)
      continue
    }

    /* 解析: { dim_value -> metric_value } */
    const rows = extractRows(report, [metric])
    const map = {}
    for (const r of rows) {
      const key = formatLabel(r.dimensions[dimName], granularity)
      map[key] = (map[key] || 0) + r.metrics[metric]
      labelSet.add(key)
    }
    sourceSeries.push({
      auth_id: ds.auth_id,
      resource_id: ds.resource_id,
      label: ds.resource_label || ds.resource_id,
      _map: map,
    })
  }

  /* ---- labels 排序 + 每个 series 按 label 对齐 ---- */
  const labels = Array.from(labelSet).sort()
  const series = sourceSeries.map((s) => ({
    auth_id: s.auth_id,
    resource_id: s.resource_id,
    label: s.label,
    data: labels.map((lab) => s._map[lab] || 0),
  }))

  const payload = { period, granularity, metric, labels, series }
  await writeCache(db, project.project_id, cacheKey, payload, ttlSec)
  return reqSuccess(payload)
})

/* ---- GA4 dim value 格式化 ---- */
/* day:  "20260501" -> "2026-05-01" */
/* hour: "00".."23" 原样保留                                              */
function formatLabel(value, granularity) {
  if (granularity === 'hour') return String(value || '').padStart(2, '0')
  const v = String(value || '')
  if (v.length === 8) return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`
  return v
}
