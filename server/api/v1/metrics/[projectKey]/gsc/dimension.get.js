/* ===================================================================
 * v1 · GET /api/v1/metrics/{projectKey}/gsc/dimension?period=28days&dimension=query
 *
 * 与内部 /api/metrics/{projectKey}/gsc/dimension 字段一字不差
 * 唯一差异: sk- 鉴权 + 60req/min 限流
 *
 * dimension 白名单 = { query, page, country, device, searchAppearance }
 *   country 是 ISO alpha-3 (USA / DEU / CHN). 输出 top 50 行 (按 impressions desc).
 *
 * 筛选: 跟 GA4 同 URL 协议 ?f=dim:match:value;
 *       GA4 维度名自动映射到 GSC 形态 (mapGa4FiltersToGsc), 其他维度 skip.
 * =================================================================== */

import { DataSourceProvider, MetricsPeriod, METRICS_CACHE_TTL_MS } from '../../../../../utils/constants'
import { isValidPeriod } from '../../../../../utils/period'
import { useDb } from '../../../../../utils/db'
import { getAccessToken } from '../../../../../utils/data-source-token'
import { runReport, periodToRange } from '../../../../../utils/providers/gsc'
import { readCache, staleCacheOptions, writeCache, buildCacheKey } from '../../../../../utils/metrics-cache'
import { loadProjectAndSources, markAuthInvalid } from '../../../../../utils/metrics-helpers'
import { parseFiltersFromQuery, mapGa4FiltersToGsc, filterCacheKey } from '../../../../../utils/filters'

const DIMENSION_CONFIG = {
  query:            { gsc: 'query',            primary: 'impressions' },
  page:             { gsc: 'page',             primary: 'impressions' },
  country:          { gsc: 'country',          primary: 'impressions' },
  device:           { gsc: 'device',           primary: 'impressions' },
  searchAppearance: { gsc: 'searchAppearance', primary: 'impressions' },
}

const TOP_N = 50

export default defineEventHandler(async (event) => {
  await guardV1(event)

  const projectKey = getRouterParam(event, 'projectKey')
  const query = getQuery(event)
  const period = String(query.period || MetricsPeriod.LAST_28_DAYS)
  const dimension = String(query.dimension || 'query')

  if (!isValidPeriod(period)) return reqFail('invalid_period')
  const config = DIMENSION_CONFIG[dimension]
  if (!config) return reqFail('invalid_dimension')

  const { gsc: gscDim, primary } = config

  const db = await useDb(event)
  const { project, sources, jwtSecret, siteConfig } = await loadProjectAndSources(
    event, db, projectKey, { provider: DataSourceProvider.GSC },
  )

  const allFilters = parseFiltersFromQuery(query)
  const gscFilters = mapGa4FiltersToGsc(allFilters, project)

  const cacheKey = buildCacheKey(['gsc', 'project', projectKey, period, 'dimension', dimension + filterCacheKey(gscFilters)])
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
        siteUrl: ds.resource_id,
        startDate: range.startDate,
        endDate: range.endDate,
        dimensions: [gscDim],
        rowLimit: TOP_N * 4,
        filters: gscFilters,
      })
    } catch (err) {
      if (err?.statusCode === 401) { await markAuthInvalid(db, auth.id); continue }
      if (err?.statusCode === 503) return reqFail('rate_limited, retry later')
      console.error('[v1/metrics/gsc/dimension] runReport error:', err?.message || err)
      continue
    }

    const rows = Array.isArray(report?.rows) ? report.rows : []
    for (const r of rows) {
      const key = String(r.keys?.[0] || '')
      if (!key) continue
      const imp = Number(r.impressions) || 0
      const acc = merged.get(key) || { impressions: 0, clicks: 0, _pos_w: 0 }
      acc.impressions += imp
      acc.clicks      += Number(r.clicks) || 0
      acc._pos_w      += (Number(r.position) || 0) * imp
      merged.set(key, acc)
    }
  }

  const rows = Array.from(merged, ([value, m]) => ({
    value,
    impressions: m.impressions,
    clicks:      m.clicks,
    ctr:         m.impressions > 0 ? m.clicks / m.impressions : 0,
    position:    m.impressions > 0 ? m._pos_w / m.impressions : 0,
  }))
    .sort((a, b) => (b[primary] || 0) - (a[primary] || 0))
    .slice(0, TOP_N)

  const payload = { period, dimension, primary_metric: primary, rows }
  await writeCache(db, project.project_id, cacheKey, payload, ttlSec)
  return reqSuccess(payload)
})
