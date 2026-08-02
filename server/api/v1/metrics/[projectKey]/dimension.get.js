/* ===================================================================
 * v1 · GET /api/v1/metrics/{projectKey}/dimension?period=28days&dimension=country
 *
 * 与内部 /api/metrics/{projectKey}/dimension 字段一字不差
 * 唯一差异: sk- 鉴权 + 60req/min 限流
 * =================================================================== */

import { MetricsPeriod, METRICS_CACHE_TTL_MS } from '../../../../utils/constants'
import { isValidPeriod } from '../../../../utils/period'
import { getAccessToken } from '../../../../utils/data-source-token'
import { runReport, periodToRange, extractRows } from '../../../../utils/providers/ga4'
import { readCache, staleCacheOptions, writeCache, buildCacheKey } from '../../../../utils/metrics-cache'
import { loadProjectAndSources } from '../../../../utils/metrics-helpers'
import { parseFiltersFromQuery, buildDimensionFilter, filterCacheKey } from '../../../../utils/filters'

/* ---- 维度配置 (与内部 dimension.get.js 一字不差) ---- */
const DIMENSION_CONFIG = {
  country:                    { ga4: 'countryId',                  metrics: ['screenPageViews', 'totalUsers', 'sessions'], primary: 'screenPageViews' },
  sessionDefaultChannelGroup: { ga4: 'sessionDefaultChannelGroup', metrics: ['screenPageViews', 'totalUsers', 'sessions'], primary: 'screenPageViews' },
  deviceCategory:             { ga4: 'deviceCategory',             metrics: ['screenPageViews', 'totalUsers', 'sessions'], primary: 'screenPageViews' },
  pagePath:                   { ga4: 'pagePath',                   metrics: ['screenPageViews', 'totalUsers', 'sessions'], primary: 'screenPageViews' },
  browser:                    { ga4: 'browser',                    metrics: ['screenPageViews', 'totalUsers', 'sessions'], primary: 'screenPageViews' },
  operatingSystem:            { ga4: 'operatingSystem',             metrics: ['screenPageViews', 'totalUsers', 'sessions'], primary: 'screenPageViews' },
  sessionSource:              { ga4: 'sessionSource',               metrics: ['screenPageViews', 'totalUsers', 'sessions'], primary: 'screenPageViews' },
  eventName:                  { ga4: 'eventName',                   metrics: ['eventCount', 'totalUsers'],                  primary: 'eventCount' },
}

const TOP_N = 50

function freshAcc(metrics) {
  const out = {}
  for (const m of metrics) out[m] = 0
  return out
}

export default defineEventHandler(async (event) => {
  await guardV1(event)

  const projectKey = getRouterParam(event, 'projectKey')
  const query = getQuery(event)
  const period = String(query.period || MetricsPeriod.LAST_28_DAYS)
  const dimension = String(query.dimension || 'country')

  if (!isValidPeriod(period)) return reqFail('invalid_period')
  const config = DIMENSION_CONFIG[dimension]
  if (!config) return reqFail('invalid_dimension')

  const { ga4: ga4Dim, metrics: rowMetrics, primary } = config

  const db = await useDb(event)
  const { project, sources, jwtSecret, siteConfig } = await loadProjectAndSources(event, db, projectKey)

  const filters = parseFiltersFromQuery(query)
  const dimensionFilter = buildDimensionFilter(filters)

  const cacheKey = buildCacheKey(['ga4', 'project', projectKey, period, 'dimension', dimension + filterCacheKey(filters)])
  const ttlSec = Math.floor(METRICS_CACHE_TTL_MS / 1000)

  const cached = await readCache(db, project.project_id, cacheKey, staleCacheOptions(event))
  if (cached) return reqSuccess(cached)

  if (!sources.length) {
    const empty = { period, dimension, primary_metric: primary, rows: [] }
    await writeCache(db, project.project_id, cacheKey, empty, ttlSec)
    return reqSuccess(empty)
  }

  const range = periodToRange(period)
  const merged = new Map()

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
        metrics: rowMetrics,
        dimensions: [ga4Dim],
        orderBys: [{ metric: { metricName: primary }, desc: true }],
        limit: TOP_N * 4,
        dimensionFilter,
      })
    } catch (err) {
      if (err?.statusCode === 503) return reqFail('rate_limited, retry later')
      console.error('[v1/metrics/dimension] runReport error:', err?.message || err)
      continue
    }

    const rows = extractRows(report, rowMetrics)
    for (const r of rows) {
      const key = String(r.dimensions[ga4Dim] || '')
      const acc = merged.get(key) || freshAcc(rowMetrics)
      for (const m of rowMetrics) acc[m] += r.metrics[m]
      merged.set(key, acc)
    }
  }

  const rows = Array.from(merged, ([value, m]) => ({ value, ...m }))
    .sort((a, b) => (b[primary] || 0) - (a[primary] || 0))
    .slice(0, TOP_N)

  const payload = { period, dimension, primary_metric: primary, rows }
  await writeCache(db, project.project_id, cacheKey, payload, ttlSec)
  return reqSuccess(payload)
})
