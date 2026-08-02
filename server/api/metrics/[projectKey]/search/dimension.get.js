/* ===================================================================
 * GET /api/metrics/{projectKey}/search/dimension?period=28days&dimension=query&sp=all
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
import { mergeSearchRows, resolveSearchProviders } from '../../../../utils/search-metrics'

const DIMENSION_CONFIG = {
  query:            { api: 'query',            primary: 'impressions' },
  page:             { api: 'page',             primary: 'impressions' },
  country:          { api: 'country',          primary: 'impressions' },
  device:           { api: 'device',           primary: 'impressions' },
  searchAppearance: { api: 'searchAppearance', primary: 'impressions' },
}
const TOP_N = 50

function addRow(map, row) {
  const value = String(row?.keys?.[0] || '').trim()
  if (!value) return
  const imp = Number(row.impressions) || 0
  const pos = Number(row.position) || 0
  const acc = map.get(value) || { value, clicks: 0, impressions: 0, pos_w: 0, pos_i: 0 }
  acc.clicks += Number(row.clicks) || 0
  acc.impressions += imp
  if (imp > 0 && pos > 0) {
    acc.pos_w += pos * imp
    acc.pos_i += imp
  }
  map.set(value, acc)
}

function finalizeRows(map, provider) {
  return Array.from(map.values())
    .map((r) => ({
      value: r.value,
      provider,
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.impressions > 0 ? r.clicks / r.impressions : 0,
      position: r.pos_i > 0 ? r.pos_w / r.pos_i : 0,
    }))
    .sort((a, b) => (b.impressions || 0) - (a.impressions || 0))
    .slice(0, TOP_N)
}

export default defineEventHandler(async (event) => {
  const projectKey = getRouterParam(event, 'projectKey')
  const query = getQuery(event)
  const period = String(query.period || MetricsPeriod.LAST_28_DAYS)
  const dimension = String(query.dimension || 'query')
  const sp = String(query.sp || 'all')
  if (!isValidPeriod(period)) return reqFail('invalid_period')

  const config = DIMENSION_CONFIG[dimension]
  if (!config) return reqFail('invalid_dimension')

  const providers = resolveSearchProviders(sp)
  if (!providers.length) return reqFail('invalid_provider')

  const db = await useDb(event)
  const { project, sources, jwtSecret, siteConfig } = await loadProjectSearchSources(event, db, projectKey, providers)
  const allFilters = parseFiltersFromQuery(query)
  const gscFilters = mapGa4FiltersToGsc(allFilters, project)
  const cacheKey = buildCacheKey(['search', 'project', projectKey, period, 'dimension', 'v2', sp, dimension + filterCacheKey(gscFilters)])
  const ttlSec = Math.floor(METRICS_CACHE_TTL_MS / 1000)

  const force = String(query.force || '') === '1'
  if (!force) {
    const cached = await readCache(db, project.project_id, cacheKey)
    if (cached) return reqSuccess(cached)
  }

  const range = periodToRange(period)
  const rowsByProvider = {}
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
        dimensions: [config.api],
        rowLimit: TOP_N * 4,
        filters: ds.provider === 'gsc' ? gscFilters : undefined,
      })
      if (!rowsByProvider[ds.provider]) rowsByProvider[ds.provider] = new Map()
      for (const row of (report?.rows || [])) addRow(rowsByProvider[ds.provider], row)
    } catch (err) {
      if (err?.statusCode === 401) { await markAuthInvalid(db, auth.id); continue }
      if (err?.statusCode === 503) return reqFail('rate_limited, retry later')
      console.error('[metrics/search/dimension] runReport error:', { provider: ds.provider, message: err?.message })
    }
  }

  const providerRows = {}
  for (const [provider, map] of Object.entries(rowsByProvider)) {
    providerRows[provider] = finalizeRows(map, provider)
  }

  const rows = sp === 'all' || sp === 'search'
    ? mergeSearchRows(providerRows, TOP_N)
    : (providerRows[providers[0]] || [])

  const payload = {
    period,
    dimension,
    sp,
    primary_metric: config.primary,
    rows,
    provider_rows: providerRows,
  }
  await writeCache(db, project.project_id, cacheKey, payload, ttlSec)
  return reqSuccess(payload)
})
