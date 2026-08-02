/* ===================================================================
 * GET /api/metrics/{projectKey}/search/timeseries?period=7days&metric=clicks&sp=all
 * =================================================================== */

import { MetricsPeriod, METRICS_CACHE_TTL_MS } from '../../../../utils/constants'
import { isValidPeriod } from '../../../../utils/period'
import { useDb } from '../../../../utils/db'
import { providerOf } from '../../../../utils/providers'
import { getProviderCredential } from '../../../../utils/data-source-token'
import { readCache, writeCache, buildCacheKey } from '../../../../utils/metrics-cache'
import { markAuthInvalid } from '../../../../utils/metrics-helpers'
import { parseFiltersFromQuery, mapGa4FiltersToGsc, filterCacheKey } from '../../../../utils/filters'
import { periodToRange } from '../../../../utils/providers/gsc'
import { loadProjectSearchSources } from '../../../../utils/search-project'
import { resolveSearchProviders } from '../../../../utils/search-metrics'

const ALLOWED_METRICS = new Set(['clicks', 'impressions', 'ctr', 'position'])
const PROVIDER_LABEL = {
  gsc: 'Google Search Console',
  bing: 'Bing Webmaster',
}

function enumerateDates(startDate, endDate) {
  const out = []
  const s = new Date(startDate)
  const e = new Date(endDate)
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

function addDaily(acc, row) {
  const date = String(row?.keys?.[0] || '')
  if (!date) return
  const imp = Number(row.impressions) || 0
  const pos = Number(row.position) || 0
  const item = acc.get(date) || { clicks: 0, impressions: 0, pos_w: 0, pos_i: 0 }
  item.clicks += Number(row.clicks) || 0
  item.impressions += imp
  if (imp > 0 && pos > 0) {
    item.pos_w += pos * imp
    item.pos_i += imp
  }
  acc.set(date, item)
}

function pointOf(item, metric) {
  if (!item) return 0
  if (metric === 'ctr') return item.impressions > 0 ? item.clicks / item.impressions : 0
  if (metric === 'position') return item.pos_i > 0 ? item.pos_w / item.pos_i : 0
  return Number(item[metric]) || 0
}

export default defineEventHandler(async (event) => {
  const projectKey = getRouterParam(event, 'projectKey')
  const query = getQuery(event)
  const period = String(query.period || MetricsPeriod.LAST_7_DAYS)
  const metric = String(query.metric || 'clicks')
  const sp = String(query.sp || 'all')
  if (!isValidPeriod(period)) return reqFail('invalid_period')
  if (!ALLOWED_METRICS.has(metric)) return reqFail('invalid_metric')

  const providers = resolveSearchProviders(sp)
  if (!providers.length) return reqFail('invalid_provider')

  const db = await useDb(event)
  const { project, sources, jwtSecret, siteConfig } = await loadProjectSearchSources(event, db, projectKey, providers)
  const allFilters = parseFiltersFromQuery(query)
  const gscFilters = mapGa4FiltersToGsc(allFilters, project)
  const cacheKey = buildCacheKey(['search', 'project', projectKey, period, 'timeseries', sp, metric + filterCacheKey(gscFilters)])
  const ttlSec = Math.floor(METRICS_CACHE_TTL_MS / 1000)

  const cached = await readCache(db, project.project_id, cacheKey)
  if (cached) return reqSuccess(cached)

  const range = periodToRange(period)
  const labels = enumerateDates(range.startDate, range.endDate)
  const dailyByProvider = {}

  for (const { ds, auth } of sources) {
    if (auth.status !== 1) continue
    const adapter = providerOf(ds.provider)
    let credential
    try { credential = await getProviderCredential(db, auth, jwtSecret, siteConfig) } catch { continue }

    try {
      const report = await adapter.runReport({
        accessToken: credential,
        apiKey: credential,
        siteUrl: ds.resource_id,
        startDate: range.startDate,
        endDate: range.endDate,
        dimensions: ['date'],
        rowLimit: 25000,
        filters: ds.provider === 'gsc' ? gscFilters : undefined,
      })
      if (!dailyByProvider[ds.provider]) dailyByProvider[ds.provider] = new Map()
      for (const row of (report?.rows || [])) addDaily(dailyByProvider[ds.provider], row)
    } catch (err) {
      if (err?.statusCode === 401) { await markAuthInvalid(db, auth.id); continue }
      if (err?.statusCode === 503) return reqFail('rate_limited, retry later')
      console.error('[metrics/search/timeseries] runReport error:', { provider: ds.provider, message: err?.message })
    }
  }

  const series = Object.entries(dailyByProvider).map(([provider, map]) => ({
    source_id: provider,
    source_label: PROVIDER_LABEL[provider] || provider,
    points: labels.map((date) => pointOf(map.get(date), metric)),
  }))

  const payload = { period, metric, sp, labels, series }
  await writeCache(db, project.project_id, cacheKey, payload, ttlSec)
  return reqSuccess(payload)
})
