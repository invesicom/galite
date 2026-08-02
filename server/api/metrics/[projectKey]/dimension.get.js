/* ===================================================================
 * GET /api/metrics/{projectKey}/dimension?period=28days&dimension=country
 *
 * 输出 top 50 行 (按 screenPageViews 降序), 多 property 同 value 行求和.
 *
 * dimension 白名单:
 *   country | sessionDefaultChannelGroup | deviceCategory | pagePath |
 *   browser | operatingSystem | sessionSource | eventName
 *
 * 缓存 key = ga4:project:{projectKey}:{period}:dimension:{dim}
 * =================================================================== */

import { MetricsPeriod, METRICS_CACHE_TTL_MS } from '../../../utils/constants'
import { isValidPeriod } from '../../../utils/period'
import { useDb } from '../../../utils/db'
import { getAccessToken } from '../../../utils/data-source-token'
import { runReport, periodToRange, extractRows } from '../../../utils/providers/ga4'
import { readCache, writeCache, buildCacheKey } from '../../../utils/metrics-cache'
import { loadProjectAndSources } from '../../../utils/metrics-helpers'
import { parseFiltersFromQuery, buildDimensionFilter, filterCacheKey } from '../../../utils/filters'

/* ===================================================================
 *  维度查询配置 - 每个维度自带语义, 替代"白名单 + alias + 全局 ROW_METRICS"三处分散
 *
 *  ga4:     前端短名 -> GA4 实际字段名 (country -> countryId 因 GA4
 *           的 country 返国家全名而非 ISO alpha-2)
 *  metrics: 拉哪些指标 (后端 query + 出参字段)
 *  primary: 排序键 + 前端 BarList 主显示字段
 *
 *  ⚠ eventName 必须用 eventCount 而非 screenPageViews:
 *    GA4 中 page_view 事件本身计 screenPageViews=N, 但自定义事件
 *    (begin_checkout / login / purchase / session_start ...) 的
 *    screenPageViews 恒为 0, 用 PV 当 primary 会让所有非 page_view 事件
 *    显示为 0. eventCount 才是 GA4 对"事件次数"的正确字段.
 * =================================================================== */
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

/* ---- 多源初始累加器: 按 config.metrics 全 0 初始化 ---- */
function freshAcc(metrics) {
  const out = {}
  for (const m of metrics) out[m] = 0
  return out
}

export default defineEventHandler(async (event) => {
  const projectKey = getRouterParam(event, 'projectKey')
  const query = getQuery(event)
  const period = String(query.period || MetricsPeriod.LAST_28_DAYS)
  const dimension = String(query.dimension || 'country')

  if (!isValidPeriod(period)) return reqFail('invalid_period')
  const config = DIMENSION_CONFIG[dimension]
  if (!config) return reqFail('invalid_dimension')

  /* ---- 前端短名 -> GA4 字段 + 该维度的 metrics 列表 + 排序 primary ---- */
  const { ga4: ga4Dim, metrics: rowMetrics, primary } = config

  const db = await useDb(event)
  const { project, sources, jwtSecret, siteConfig } = await loadProjectAndSources(event, db, projectKey)

  /* filters: 严格 slicing — 被筛选的维度本身也只显示条件值
     (e.g. country=US filter 下, country 卡只剩 US 一行符合 OLAP 标准) */
  const allFilters = parseFiltersFromQuery(query)
  const dimensionFilter = buildDimensionFilter(allFilters)

  const cacheKey = buildCacheKey(['ga4', 'project', projectKey, period, 'dimension', dimension + filterCacheKey(allFilters)])
  const ttlSec = Math.floor(METRICS_CACHE_TTL_MS / 1000)

  /* ?force=1 跳过缓存 (前端手动刷新用, 避免旧数据 60s 内还在) */
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

  /* ---- 多 property 行级求和: { value -> { config.metrics 全 0 起步 } } ---- */
  const merged = new Map()

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
        metrics: rowMetrics,
        dimensions: [ga4Dim],
        orderBys: [{ metric: { metricName: primary }, desc: true }],
        limit: TOP_N * 4,  /* 每个 source 多取一些, 合并后再截取 top */
        dimensionFilter,
      })
    } catch (err) {
      if (err?.statusCode === 503) return reqFail('rate_limited, retry later')
      console.error('[metrics/dimension] runReport error:', err?.message || err)
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

  /* ---- 排序按 config.primary 取前 50 ---- */
  const rows = Array.from(merged, ([value, m]) => ({ value, ...m }))
    .sort((a, b) => (b[primary] || 0) - (a[primary] || 0))
    .slice(0, TOP_N)

  const payload = { period, dimension, primary_metric: primary, rows }
  await writeCache(db, project.project_id, cacheKey, payload, ttlSec)
  return reqSuccess(payload)
})
