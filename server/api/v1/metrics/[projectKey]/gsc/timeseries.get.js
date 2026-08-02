/* ===================================================================
 * v1 · GET /api/v1/metrics/{projectKey}/gsc/timeseries?period=28days&metric=impressions
 *
 * 与内部 /api/metrics/{projectKey}/gsc/timeseries 字段一字不差
 * 唯一差异: sk- 鉴权 + 60req/min 限流
 *
 * metric 白名单 = { impressions, clicks, ctr, position }, 默认 impressions.
 * 多 site 时每个 site 一条 series. 缺失日期补 0.
 * =================================================================== */

import { DataSourceProvider, MetricsPeriod, METRICS_CACHE_TTL_MS } from '../../../../../utils/constants'
import { isValidPeriod } from '../../../../../utils/period'
import { useDb } from '../../../../../utils/db'
import { getAccessToken } from '../../../../../utils/data-source-token'
import { runReport, periodToRange } from '../../../../../utils/providers/gsc'
import { readCache, staleCacheOptions, writeCache, buildCacheKey } from '../../../../../utils/metrics-cache'
import { loadProjectAndSources, markAuthInvalid } from '../../../../../utils/metrics-helpers'
import { parseFiltersFromQuery, mapGa4FiltersToGsc, filterCacheKey } from '../../../../../utils/filters'

const ALLOWED_METRICS = new Set(['impressions', 'clicks', 'ctr', 'position'])

function enumerateDates(startDate, endDate) {
  const out = []
  const s = new Date(startDate)
  const e = new Date(endDate)
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

export default defineEventHandler(async (event) => {
  await guardV1(event)

  const projectKey = getRouterParam(event, 'projectKey')
  const query = getQuery(event)
  const period = String(query.period || MetricsPeriod.LAST_7_DAYS)
  const metric = String(query.metric || 'impressions')

  if (!isValidPeriod(period)) return reqFail('invalid_period')
  if (!ALLOWED_METRICS.has(metric)) return reqFail('invalid_metric')

  const db = await useDb(event)
  const { project, sources, jwtSecret, siteConfig } = await loadProjectAndSources(
    event, db, projectKey, { provider: DataSourceProvider.GSC },
  )

  const allFilters = parseFiltersFromQuery(query)
  const gscFilters = mapGa4FiltersToGsc(allFilters, project)

  const cacheKey = buildCacheKey(['gsc', 'project', projectKey, period, 'timeseries', metric + filterCacheKey(gscFilters)])
  const ttlSec = Math.floor(METRICS_CACHE_TTL_MS / 1000)

  const cached = await readCache(db, project.project_id, cacheKey, staleCacheOptions(event))
  if (cached) return reqSuccess(cached)

  const range = periodToRange(period)
  const labels = enumerateDates(range.startDate, range.endDate)

  if (!sources.length) {
    const empty = { period, metric, labels, series: [] }
    await writeCache(db, project.project_id, cacheKey, empty, ttlSec)
    return reqSuccess(empty)
  }

  const series = []
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
        siteUrl: ds.resource_id,
        startDate: range.startDate,
        endDate: range.endDate,
        dimensions: ['date'],
        rowLimit: 25000,
        filters: gscFilters,
      })
    } catch (err) {
      if (err?.statusCode === 401) { await markAuthInvalid(db, auth.id); continue }
      if (err?.statusCode === 503) return reqFail('rate_limited, retry later')
      console.error('[v1/metrics/gsc/timeseries] runReport error:', err?.message || err)
      continue
    }

    const byDate = new Map()
    for (const r of (report?.rows || [])) {
      const date = String(r.keys?.[0] || '')
      if (!date) continue
      byDate.set(date, Number(r[metric]) || 0)
    }
    const points = labels.map((d) => byDate.get(d) || 0)
    series.push({
      source_id: ds.resource_id,
      source_label: ds.resource_label || ds.resource_id,
      points,
    })
  }

  const payload = { period, metric, labels, series }
  await writeCache(db, project.project_id, cacheKey, payload, ttlSec)
  return reqSuccess(payload)
})
