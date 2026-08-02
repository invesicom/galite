/* ===================================================================
 * GET /api/metrics/{projectKey}/search/summary?period=7days&sp=all|gsc|bing
 * =================================================================== */

import { MetricsPeriod, METRICS_CACHE_TTL_MS } from '../../../../utils/constants'
import { isValidPeriod, shiftPreviousAbsolute } from '../../../../utils/period'
import { useDb } from '../../../../utils/db'
import { providerOf } from '../../../../utils/providers'
import { getProviderCredential } from '../../../../utils/data-source-token'
import { readCache, writeCache, buildCacheKey } from '../../../../utils/metrics-cache'
import { markAuthInvalid, dataSourceSummary } from '../../../../utils/metrics-helpers'
import { parseFiltersFromQuery, mapGa4FiltersToGsc, filterCacheKey } from '../../../../utils/filters'
import { periodToRange } from '../../../../utils/providers/gsc'
import { loadProjectSearchSources } from '../../../../utils/search-project'
import { mergeProviderMap, mergeSearchMetrics, pickSearchOutput, resolveSearchProviders } from '../../../../utils/search-metrics'

export default defineEventHandler(async (event) => {
  const projectKey = getRouterParam(event, 'projectKey')
  const query = getQuery(event)
  const period = String(query.period || MetricsPeriod.LAST_7_DAYS)
  const sp = String(query.sp || 'all')
  if (!isValidPeriod(period)) return reqFail('invalid_period')

  const providers = resolveSearchProviders(sp)
  if (!providers.length) return reqFail('invalid_provider')

  const db = await useDb(event)
  const { project, sources, jwtSecret, siteConfig } = await loadProjectSearchSources(event, db, projectKey, providers)
  const allFilters = parseFiltersFromQuery(query)
  const gscFilters = mapGa4FiltersToGsc(allFilters, project)
  const cacheKey = buildCacheKey(['search', 'project', projectKey, period, 'summary', sp + filterCacheKey(gscFilters)])
  const ttlSec = Math.floor(METRICS_CACHE_TTL_MS / 1000)

  const cached = await readCache(db, project.project_id, cacheKey)
  if (cached) return reqSuccess(cached)

  if (!sources.length) {
    const empty = buildEmpty(project, period)
    await writeCache(db, project.project_id, cacheKey, empty, ttlSec)
    return reqSuccess(empty)
  }

  const range = periodToRange(period)
  const prevRange = shiftPreviousAbsolute(range)
  const providerMetrics = {}
  const providerPrevious = {}
  const results = []

  for (const { ds, auth } of sources) {
    if (auth.status !== 1) {
      results.push({ ds, auth, skip: true })
      continue
    }
    const adapter = providerOf(ds.provider)
    let credential
    try {
      credential = await getProviderCredential(db, auth, jwtSecret, siteConfig)
    } catch {
      results.push({ ds, auth: { ...auth, status: 99 }, skip: true })
      continue
    }

    try {
      const common = {
        accessToken: credential,
        apiKey: credential,
        siteUrl: ds.resource_id,
        dimensions: [],
        rowLimit: 1,
        filters: ds.provider === 'gsc' ? gscFilters : undefined,
      }
      const [report, prevReport] = await Promise.all([
        adapter.runReport({ ...common, startDate: range.startDate, endDate: range.endDate }),
        adapter.runReport({ ...common, startDate: prevRange.startDate, endDate: prevRange.endDate }),
      ])
      const totals = adapter.extractTotals(report)
      const prevTotals = adapter.extractTotals(prevReport)
      if (!providerMetrics[ds.provider]) providerMetrics[ds.provider] = []
      if (!providerPrevious[ds.provider]) providerPrevious[ds.provider] = []
      providerMetrics[ds.provider].push(totals)
      providerPrevious[ds.provider].push(prevTotals)
      results.push({ ds, auth, totals, prevTotals })
    } catch (err) {
      if (err?.statusCode === 401) {
        await markAuthInvalid(db, auth.id)
        results.push({ ds, auth: { ...auth, status: 99 }, skip: true })
      } else if (err?.statusCode === 503) {
        return reqFail('rate_limited, retry later')
      } else {
        console.error('[metrics/search/summary] runReport error:', { provider: ds.provider, message: err?.message })
        results.push({ ds, auth, skip: true })
      }
    }
  }

  const usable = results.filter((r) => !r.skip)
  const payload = {
    project_key: project.project_key,
    period,
    sp,
    data_sources: results.map((r) => dataSourceSummary({ ds: r.ds, auth: r.auth })),
    metrics: pickSearchOutput(mergeSearchMetrics(usable.map((r) => r.totals))),
    previous_metrics: pickSearchOutput(mergeSearchMetrics(usable.map((r) => r.prevTotals))),
    provider_metrics: mergeProviderMap(providerMetrics),
    provider_previous_metrics: mergeProviderMap(providerPrevious),
    fetched_at: Math.floor(Date.now() / 1000),
  }

  await writeCache(db, project.project_id, cacheKey, payload, ttlSec)
  return reqSuccess(payload)
})

function buildEmpty(project, period) {
  const zeros = pickSearchOutput({})
  return {
    project_key: project.project_key,
    period,
    sp: 'all',
    data_sources: [],
    metrics: zeros,
    previous_metrics: { ...zeros },
    provider_metrics: {},
    provider_previous_metrics: {},
    fetched_at: Math.floor(Date.now() / 1000),
  }
}
