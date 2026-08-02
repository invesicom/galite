/* ===================================================================
 * GET /api/metrics/{projectKey}/gsc/dimension?period=28days&dimension=query
 *
 * 输出 top 50 行 (按 impressions 降序), 多 site 同 key 行求和.
 *
 * dimension 白名单 = { query, page, country, device }
 *   country 在 GSC 是 ISO alpha-3 国家代码 (USA / DEU / CHN ...) —
 *   与 GA4 的 alpha-2 (US/DE/CN) 不同, 前端 CountryFlag 组件需识别两种.
 *
 * 缓存 key = gsc:project:{projectKey}:{period}:dimension:{dim}[:f:...]
 * TTL    = 60s
 * =================================================================== */

import { DataSourceProvider, MetricsPeriod, METRICS_CACHE_TTL_MS } from '../../../../utils/constants'
import { isValidPeriod } from '../../../../utils/period'
import { useDb } from '../../../../utils/db'
import { getAccessToken } from '../../../../utils/data-source-token'
import { runReport, periodToRange } from '../../../../utils/providers/gsc'
import { readCache, writeCache, buildCacheKey } from '../../../../utils/metrics-cache'
import { loadProjectAndSources, markAuthInvalid } from '../../../../utils/metrics-helpers'
import { parseFiltersFromQuery, mapGa4FiltersToGsc, filterCacheKey } from '../../../../utils/filters'

/* ---- 维度配置: GSC 详情页用 5 个, primary 一律 impressions (最自然排序键)
        searchAppearance = GSC 'Rich Results / AMP / News' 等搜索结果外观分类 ---- */
const DIMENSION_CONFIG = {
  query:            { gsc: 'query',            primary: 'impressions' },
  page:             { gsc: 'page',             primary: 'impressions' },
  country:          { gsc: 'country',          primary: 'impressions' },
  device:           { gsc: 'device',           primary: 'impressions' },
  searchAppearance: { gsc: 'searchAppearance', primary: 'impressions' },
}

const TOP_N = 50

export default defineEventHandler(async (event) => {
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

  /* 把全部 GA4 维度筛选转 GSC 形态 (country alpha-3 / page 完整URL / device 大写 / query)
     GSC 不识别的 GA4 维度自动 skip */
  const allFilters = parseFiltersFromQuery(query)
  const gscFilters = mapGa4FiltersToGsc(allFilters, project)

  const cacheKey = buildCacheKey(['gsc', 'project', projectKey, period, 'dimension', dimension + filterCacheKey(gscFilters)])
  const ttlSec = Math.floor(METRICS_CACHE_TTL_MS / 1000)

  const force = String(query.force || '') === '1'
  if (!force) {
    const cached = await readCache(db, project.project_id, cacheKey)
    if (cached) return reqSuccess(cached)
  }

  if (!sources.length) {
    const empty = { period, dimension, primary_metric: primary, rows: [] }
    await writeCache(db, project.project_id, cacheKey, empty, ttlSec)
    return reqSuccess(empty)
  }

  const range = periodToRange(period)

  /* ---- 多 site 行级合并: key = 维度值 → { impressions, clicks, ctr_w, position_w }
          ctr / position 用 impressions 加权累加, 最后除以总 impressions ---- */
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
      console.error('[metrics/gsc/dimension] runReport error:', err?.message || err)
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

  /* ---- 收敛 ctr/position + 排序 top 50 ---- */
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
