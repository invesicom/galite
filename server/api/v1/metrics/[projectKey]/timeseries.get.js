/* ===================================================================
 * v1 · GET /api/v1/metrics/{projectKey}/timeseries?period=7days&metric=screenPageViews
 *
 * 与内部 /api/metrics/{projectKey}/timeseries 字段一字不差
 * 唯一差异: sk- 鉴权 + 60req/min 限流
 * =================================================================== */

import { GA4_CORE_METRICS, MetricsPeriod, METRICS_CACHE_TTL_MS } from '../../../../utils/constants'
import { isValidPeriod } from '../../../../utils/period'
import { getAccessToken } from '../../../../utils/data-source-token'
import { runReport, periodToRange, granularityOf, extractRows } from '../../../../utils/providers/ga4'
import { readCache, staleCacheOptions, writeCache, buildCacheKey } from '../../../../utils/metrics-cache'
import { loadProjectAndSources } from '../../../../utils/metrics-helpers'
import { parseFiltersFromQuery, buildDimensionFilter, filterCacheKey } from '../../../../utils/filters'

export default defineEventHandler(async (event) => {
  await guardV1(event)

  const projectKey = getRouterParam(event, 'projectKey')
  const query = getQuery(event)
  const period = String(query.period || MetricsPeriod.LAST_7_DAYS)
  const metric = String(query.metric || 'screenPageViews')

  if (!isValidPeriod(period)) return reqFail('invalid_period')
  if (!GA4_CORE_METRICS.includes(metric)) return reqFail('invalid_metric')

  const db = await useDb(event)
  const { project, sources, jwtSecret, siteConfig } = await loadProjectAndSources(event, db, projectKey)

  const filters = parseFiltersFromQuery(query)
  const dimensionFilter = buildDimensionFilter(filters)

  const cacheKey = buildCacheKey(['ga4', 'project', projectKey, period, 'timeseries', metric + filterCacheKey(filters)])
  const ttlSec = Math.floor(METRICS_CACHE_TTL_MS / 1000)

  const cached = await readCache(db, project.project_id, cacheKey, staleCacheOptions(event))
  if (cached) return reqSuccess(cached)

  const granularity = granularityOf(period)
  const dimName = granularity === 'hour' ? 'hour' : 'date'

  if (!sources.length) {
    const empty = { period, granularity, metric, labels: [], series: [] }
    await writeCache(db, project.project_id, cacheKey, empty, ttlSec)
    return reqSuccess(empty)
  }

  const range = periodToRange(period)
  const sourceSeries = []
  const labelSet = new Set()

  for (const { ds, auth } of sources) {
    if (auth.status !== 1) continue

    let accessToken
    try {
      accessToken = await getAccessToken(db, auth, jwtSecret, siteConfig)
    } catch { continue }

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
      console.error('[v1/metrics/timeseries] runReport error:', err?.message || err)
      continue
    }

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

function formatLabel(value, granularity) {
  if (granularity === 'hour') return String(value || '').padStart(2, '0')
  const v = String(value || '')
  if (v.length === 8) return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`
  return v
}
