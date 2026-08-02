/* ===================================================================
 * 公开指标聚合
 *
 * 职责:
 *   - 公开 API 复用 provider/cache, 但不复用私有 handler.
 *   - 输出只给 public DTO 层使用, 不返回 data_sources/token/auth 信息.
 *   - semi_public 上层只取 summary/timeseries, dimensions 默认不算.
 * =================================================================== */

import { and, desc, eq, inArray } from 'drizzle-orm'
import {
  data_source_auth,
  project_funnel,
  project_data_source,
} from '../../database/schema'
import {
  DataSourceProvider,
  GA4_CORE_METRICS,
  RecordStatus,
} from '../constants'
import { getAccessToken, getProviderCredential } from '../data-source-token'
import { selectInBatches } from '../db'
import {
  CONSUMER_STALE_TTL_SECONDS,
  readCache,
  readCacheEntry,
  writeCache,
  buildCacheKey,
  claimCacheRefresh,
} from '../metrics-cache'
import { getJwtSecret, getSiteConfig, markAuthInvalid } from '../metrics-helpers'
import { parseSteps, shapeStep } from '../funnel-steps'
import { periodToRange as ga4PeriodToRange, previousPeriodRange as ga4PreviousPeriodRange, extractTotals, extractRows, aggregateMetrics, runReport, runFunnelReport, extractFunnel } from '../providers/ga4'
import { periodToRange as searchPeriodToRange } from '../providers/gsc'
import { providerOf } from '../providers'
import { isValidPeriod, shiftPreviousAbsolute } from '../period'
import { mergeSearchMetrics, pickSearchOutput, resolveSearchProviders } from '../search-metrics'
import { buildDimensionFilter, filterCacheKey, mapGa4FiltersToGsc } from '../filters'
import { loadCachedProjectRealtime, isRealtimeError } from '../realtime-metrics'
import { mapLimit } from '../map-limit'
import { PublicProjectMode } from './public-access'
import { shapePublicProjectCard } from './public-dto'
import { loadPublicProjectProviderMap } from './public-sources'

const SEARCH_METRICS = new Set(['clicks', 'impressions', 'ctr', 'position'])
const TRAFFIC_RATIO_METRICS = new Set(['bounceRate', 'averageSessionDuration', 'userEngagementDuration'])

const TRAFFIC_DIMENSIONS = {
  sessionSource:              { ga4: 'sessionSource',               metrics: ['screenPageViews', 'totalUsers', 'sessions'], primary: 'screenPageViews' },
  pagePath:                   { ga4: 'pagePath',                    metrics: ['screenPageViews', 'totalUsers', 'sessions'], primary: 'screenPageViews' },
  eventName:                  { ga4: 'eventName',                   metrics: ['eventCount', 'totalUsers'],                  primary: 'eventCount' },
  country:                    { ga4: 'countryId',                   metrics: ['screenPageViews', 'totalUsers', 'sessions'], primary: 'screenPageViews' },
  browser:                    { ga4: 'browser',                     metrics: ['screenPageViews', 'totalUsers', 'sessions'], primary: 'screenPageViews' },
  operatingSystem:            { ga4: 'operatingSystem',             metrics: ['screenPageViews', 'totalUsers', 'sessions'], primary: 'screenPageViews' },
  deviceCategory:             { ga4: 'deviceCategory',              metrics: ['screenPageViews', 'totalUsers', 'sessions'], primary: 'screenPageViews' },
  sessionDefaultChannelGroup: { ga4: 'sessionDefaultChannelGroup',  metrics: ['screenPageViews', 'totalUsers', 'sessions'], primary: 'screenPageViews' },
}

const SEARCH_DIMENSIONS = {
  query:   { api: 'query',   primary: 'impressions' },
  page:    { api: 'page',    primary: 'impressions' },
  country: { api: 'country', primary: 'impressions' },
  device:  { api: 'device',  primary: 'impressions' },
}

function publicPeriod(period) {
  const value = String(period || '28days')
  return isValidPeriod(value) ? value : '28days'
}

function emptyGa4Metrics() {
  const out = {}
  for (const key of GA4_CORE_METRICS) out[key] = 0
  return out
}

function emptySearchMetrics() {
  return pickSearchOutput({})
}

async function createMetricsContext(event, db, owner, projectKey) {
  const dsRows = await db.select().from(project_data_source)
    .where(and(
      eq(project_data_source.project_id, owner.project_id),
      eq(project_data_source.union_id, owner.union_id),
      eq(project_data_source.project_key, projectKey),
      inArray(project_data_source.provider, [DataSourceProvider.GA4, DataSourceProvider.GSC, DataSourceProvider.BING]),
      eq(project_data_source.status, RecordStatus.ACTIVE),
    ))

  const authIds = Array.from(new Set(dsRows.map((ds) => ds.auth_id).filter(Boolean)))
  const authRows = authIds.length
    ? await selectInBatches(authIds, (ids) => db.select().from(data_source_auth)
      .where(and(
        eq(data_source_auth.project_id, owner.project_id),
        eq(data_source_auth.union_id, owner.union_id),
        inArray(data_source_auth.id, ids),
      )))
    : []
  const authById = new Map(authRows.map((auth) => [auth.id, auth]))
  const jwtSecret = getJwtSecret(event)
  const siteConfig = getSiteConfig(event)
  const accessTokenByAuthId = new Map()
  const credentialByAuthId = new Map()

  return {
    db,
    owner,
    projectKey,
    sources(providers) {
      const providerSet = new Set(Array.isArray(providers) ? providers : [providers])
      return dsRows
        .filter((ds) => providerSet.has(ds.provider))
        .map((ds) => ({ ds, auth: authById.get(ds.auth_id) }))
        .filter(({ auth }) => auth)
    },
    async accessToken(auth) {
      if (!auth || auth.status !== RecordStatus.ACTIVE) return null
      if (!accessTokenByAuthId.has(auth.id)) {
        try {
          accessTokenByAuthId.set(auth.id, await getAccessToken(db, auth, jwtSecret, siteConfig))
        } catch {
          accessTokenByAuthId.set(auth.id, null)
        }
      }
      return accessTokenByAuthId.get(auth.id)
    },
    async accessTokenStrict(auth) {
      if (!auth || auth.status !== RecordStatus.ACTIVE) return null
      if (!accessTokenByAuthId.has(auth.id)) {
        accessTokenByAuthId.set(auth.id, await getAccessToken(db, auth, jwtSecret, siteConfig))
      }
      return accessTokenByAuthId.get(auth.id)
    },
    async credential(auth) {
      if (!auth || auth.status !== RecordStatus.ACTIVE) return null
      if (!credentialByAuthId.has(auth.id)) {
        try {
          credentialByAuthId.set(auth.id, await getProviderCredential(db, auth, jwtSecret, siteConfig))
        } catch {
          credentialByAuthId.set(auth.id, null)
        }
      }
      return credentialByAuthId.get(auth.id)
    },
  }
}

function formatGa4Date(value) {
  const v = String(value || '')
  if (v.length === 8) return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`
  return v
}

function addMapValue(map, key, value) {
  if (!key) return
  map.set(key, (map.get(key) || 0) + (Number(value) || 0))
}

async function buildTrafficSummary(ctx, period, filters = [], options = {}) {
  const sources = ctx.sources(DataSourceProvider.GA4)
  if (!sources.length) {
    return { period, metrics: emptyGa4Metrics(), previous_metrics: emptyGa4Metrics(), fetched_at: Math.floor(Date.now() / 1000) }
  }

  const dimensionFilter = buildDimensionFilter(filters)
  const range = ga4PeriodToRange(period)
  const prevRange = ga4PreviousPeriodRange(period)
  const includePrevious = options.includePrevious !== false
  const totals = []
  const previous = []

  for (const { ds, auth } of sources) {
    const accessToken = await ctx.accessToken(auth)
    if (!accessToken) continue

    try {
      const dateRanges = [
        { name: 'current', startDate: range.startDate, endDate: range.endDate },
      ]
      if (includePrevious) {
        dateRanges.push({ name: 'previous', startDate: prevRange.startDate, endDate: prevRange.endDate })
      }
      const report = await runReport({
        accessToken,
        propertyId: ds.resource_id,
        dateRanges,
        metrics: GA4_CORE_METRICS,
        dimensionFilter,
      })
      totals.push(extractTotals(report, GA4_CORE_METRICS, 0))
      if (includePrevious) previous.push(extractTotals(report, GA4_CORE_METRICS, 1))
    } catch (err) {
      if (err?.statusCode === 401) await markAuthInvalid(ctx.db, auth.id)
      else console.error('[public-metrics] ga4 summary error:', err?.message || err)
    }
  }

  return {
    period,
    metrics: aggregateMetrics(totals),
    previous_metrics: aggregateMetrics(previous),
    fetched_at: Math.floor(Date.now() / 1000),
  }
}

async function buildTrafficTimeseries(ctx, period, metric = 'screenPageViews', filters = []) {
  const safeMetric = GA4_CORE_METRICS.includes(metric) ? metric : 'screenPageViews'
  const isRatioMetric = TRAFFIC_RATIO_METRICS.has(safeMetric)
  const requestMetrics = isRatioMetric && safeMetric !== 'sessions'
    ? [safeMetric, 'sessions']
    : [safeMetric]
  const sources = ctx.sources(DataSourceProvider.GA4)
  if (!sources.length) return { period, metric: safeMetric, labels: [], series: [] }

  const range = ga4PeriodToRange(period)
  const dimensionFilter = buildDimensionFilter(filters)
  const merged = new Map()

  for (const { ds, auth } of sources) {
    const accessToken = await ctx.accessToken(auth)
    if (!accessToken) continue

    try {
      const report = await runReport({
        accessToken,
        propertyId: ds.resource_id,
        startDate: range.startDate,
        endDate: range.endDate,
        metrics: requestMetrics,
        dimensions: ['date'],
        orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }],
        limit: 100000,
        dimensionFilter,
      })
      for (const row of extractRows(report, requestMetrics)) {
        const date = formatGa4Date(row.dimensions?.date)
        if (!date) continue
        if (isRatioMetric) {
          const sessions = Number(row.metrics?.sessions) || 0
          const acc = merged.get(date) || { weighted: 0, sessions: 0 }
          acc.weighted += (Number(row.metrics?.[safeMetric]) || 0) * sessions
          acc.sessions += sessions
          merged.set(date, acc)
        } else {
          addMapValue(merged, date, row.metrics?.[safeMetric])
        }
      }
    } catch (err) {
      if (err?.statusCode === 401) await markAuthInvalid(ctx.db, auth.id)
      else console.error('[public-metrics] ga4 timeseries error:', err?.message || err)
    }
  }

  const labels = periodDateLabels(period, merged.keys())
  return {
    period,
    metric: safeMetric,
    labels,
    series: [{
      label: 'Traffic',
      data: labels.map((label) => {
        const item = merged.get(label)
        if (!isRatioMetric) return Number(item) || 0
        return item?.sessions > 0 ? item.weighted / item.sessions : 0
      }),
    }],
  }
}

async function buildTrafficTimeseriesBundle(ctx, period, metrics, filters = []) {
  const safeMetrics = (Array.isArray(metrics) ? metrics : [])
    .filter((metric) => GA4_CORE_METRICS.includes(metric))
  if (!safeMetrics.length) safeMetrics.push('screenPageViews')

  const entries = await Promise.all(
    safeMetrics.map(async (metric) => [
      metric,
      await buildTrafficTimeseries(ctx, period, metric, filters),
    ]),
  )
  return Object.fromEntries(entries)
}

function freshAcc(metrics) {
  const out = {}
  for (const key of metrics) out[key] = 0
  return out
}

async function buildTrafficDimensions(ctx, period, filters = []) {
  const sources = ctx.sources(DataSourceProvider.GA4)
  const range = ga4PeriodToRange(period)
  const dimensionFilter = buildDimensionFilter(filters)

  const entries = await mapLimit(Object.entries(TRAFFIC_DIMENSIONS), 6, async ([name, config]) => {
    const merged = new Map()
    for (const { ds, auth } of sources) {
      const accessToken = await ctx.accessToken(auth)
      if (!accessToken) continue

      try {
        const report = await runReport({
          accessToken,
          propertyId: ds.resource_id,
          startDate: range.startDate,
          endDate: range.endDate,
          metrics: config.metrics,
          dimensions: [config.ga4],
          orderBys: [{ metric: { metricName: config.primary }, desc: true }],
          limit: 80,
          dimensionFilter,
        })
        for (const row of extractRows(report, config.metrics)) {
          const value = String(row.dimensions?.[config.ga4] || '').trim()
          if (!value) continue
          const acc = merged.get(value) || freshAcc(config.metrics)
          for (const key of config.metrics) acc[key] += Number(row.metrics?.[key]) || 0
          merged.set(value, acc)
        }
      } catch (err) {
        if (err?.statusCode === 401) await markAuthInvalid(ctx.db, auth.id)
        else console.error('[public-metrics] ga4 dimension error:', err?.message || err)
      }
    }
    return [name, {
      period,
      dimension: name,
      primary_metric: config.primary,
      rows: Array.from(merged, ([value, metrics]) => ({ value, ...metrics }))
        .sort((a, b) => (b[config.primary] || 0) - (a[config.primary] || 0))
        .slice(0, 50),
    }]
  })

  return Object.fromEntries(entries)
}

async function buildSearchSummary(ctx, project, period, filters = [], options = {}) {
  const providers = resolveSearchProviders('all')
  const sources = ctx.sources(providers)
  if (!sources.length) return { period, metrics: emptySearchMetrics(), previous_metrics: emptySearchMetrics(), provider_metrics: {} }

  const gscFilters = mapGa4FiltersToGsc(filters, project)
  const range = searchPeriodToRange(period)
  const prevRange = shiftPreviousAbsolute(range)
  const includePrevious = options.includePrevious !== false
  const totals = []
  const previous = []
  const providerMetrics = {}

  for (const { ds, auth } of sources) {
    const adapter = providerOf(ds.provider)
    const credential = await ctx.credential(auth)
    if (!credential) continue

    try {
      const report = await adapter.runReport({
        accessToken: credential,
        apiKey: credential,
        siteUrl: ds.resource_id,
        startDate: range.startDate,
        endDate: range.endDate,
        dimensions: [],
        rowLimit: 1,
        filters: ds.provider === DataSourceProvider.GSC ? gscFilters : undefined,
      })
      const item = adapter.extractTotals(report)
      totals.push(item)
      if (includePrevious) {
        const prevReport = await adapter.runReport({
          accessToken: credential,
          apiKey: credential,
          siteUrl: ds.resource_id,
          startDate: prevRange.startDate,
          endDate: prevRange.endDate,
          dimensions: [],
          rowLimit: 1,
          filters: ds.provider === DataSourceProvider.GSC ? gscFilters : undefined,
        })
        previous.push(adapter.extractTotals(prevReport))
      }
      if (!providerMetrics[ds.provider]) providerMetrics[ds.provider] = []
      providerMetrics[ds.provider].push(item)
    } catch (err) {
      if (err?.statusCode === 401) await markAuthInvalid(ctx.db, auth.id)
      else console.error('[public-metrics] search summary error:', err?.message || err)
    }
  }

  const mergedProviders = {}
  for (const [provider, arr] of Object.entries(providerMetrics)) {
    mergedProviders[provider] = pickSearchOutput(mergeSearchMetrics(arr))
  }

  return {
    period,
    metrics: pickSearchOutput(mergeSearchMetrics(totals)),
    previous_metrics: pickSearchOutput(mergeSearchMetrics(previous)),
    provider_metrics: mergedProviders,
    fetched_at: Math.floor(Date.now() / 1000),
  }
}

function enumerateDates(startDate, endDate) {
  const out = []
  const start = new Date(startDate)
  const end = new Date(endDate)
  for (let day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) {
    out.push(day.toISOString().slice(0, 10))
  }
  return out
}

/* ---- GA4 会省略 0 值日期；公共卡片补齐完整周期，确保所有站点横轴同构.
        实际响应日期一并保留，兼容 property timezone 与 Worker UTC 的日界差. ---- */
function periodDateLabels(period, actualLabels = []) {
  const range = searchPeriodToRange(period)
  return Array.from(new Set([
    ...enumerateDates(range.startDate, range.endDate),
    ...actualLabels,
  ])).sort()
}

function addSearchDaily(map, row) {
  const date = String(row?.keys?.[0] || '')
  if (!date) return
  const item = map.get(date) || { clicks: 0, impressions: 0, pos_w: 0, pos_i: 0 }
  const impressions = Number(row.impressions) || 0
  const position = Number(row.position) || 0
  item.clicks += Number(row.clicks) || 0
  item.impressions += impressions
  if (impressions > 0 && position > 0) {
    item.pos_w += position * impressions
    item.pos_i += impressions
  }
  map.set(date, item)
}

function searchPoint(item, metric) {
  if (!item) return 0
  if (metric === 'ctr') return item.impressions > 0 ? item.clicks / item.impressions : 0
  if (metric === 'position') return item.pos_i > 0 ? item.pos_w / item.pos_i : 0
  return Number(item[metric]) || 0
}

async function buildSearchTimeseriesBundle(ctx, project, period, metrics = ['clicks'], filters = []) {
  const safeMetrics = metrics.filter((metric) => SEARCH_METRICS.has(metric))
  if (!safeMetrics.length) safeMetrics.push('clicks')
  const providers = resolveSearchProviders('all')
  const sources = ctx.sources(providers)
  const range = searchPeriodToRange(period)
  const labels = enumerateDates(range.startDate, range.endDate)
  const merged = new Map()
  const gscFilters = mapGa4FiltersToGsc(filters, project)

  for (const { ds, auth } of sources) {
    const adapter = providerOf(ds.provider)
    const credential = await ctx.credential(auth)
    if (!credential) continue

    try {
      const report = await adapter.runReport({
        accessToken: credential,
        apiKey: credential,
        siteUrl: ds.resource_id,
        startDate: range.startDate,
        endDate: range.endDate,
        dimensions: ['date'],
        rowLimit: 25000,
        filters: ds.provider === DataSourceProvider.GSC ? gscFilters : undefined,
      })
      for (const row of (report?.rows || [])) addSearchDaily(merged, row)
    } catch (err) {
      if (err?.statusCode === 401) await markAuthInvalid(ctx.db, auth.id)
      else console.error('[public-metrics] search timeseries error:', err?.message || err)
    }
  }

  const out = {}
  for (const metric of safeMetrics) {
    out[metric] = {
      period,
      metric,
      labels,
      series: [{ label: 'Search', data: labels.map((date) => searchPoint(merged.get(date), metric)) }],
    }
  }
  return out
}

async function buildSearchDimensions(ctx, project, period, filters = []) {
  const providers = resolveSearchProviders('all')
  const sources = ctx.sources(providers)
  const range = searchPeriodToRange(period)
  const gscFilters = mapGa4FiltersToGsc(filters, project)

  const entries = await mapLimit(Object.entries(SEARCH_DIMENSIONS), 6, async ([name, config]) => {
    const merged = new Map()
    for (const { ds, auth } of sources) {
      const adapter = providerOf(ds.provider)
      const credential = await ctx.credential(auth)
      if (!credential) continue

      try {
        const report = await adapter.runReport({
          accessToken: credential,
          apiKey: credential,
          siteUrl: ds.resource_id,
          startDate: range.startDate,
          endDate: range.endDate,
          dimensions: [config.api],
          rowLimit: 80,
          filters: ds.provider === DataSourceProvider.GSC ? gscFilters : undefined,
        })
        for (const row of (report?.rows || [])) {
          const value = String(row?.keys?.[0] || '').trim()
          if (!value) continue
          const acc = merged.get(value) || { value, clicks: 0, impressions: 0, pos_w: 0, pos_i: 0 }
          const impressions = Number(row.impressions) || 0
          const position = Number(row.position) || 0
          acc.clicks += Number(row.clicks) || 0
          acc.impressions += impressions
          if (impressions > 0 && position > 0) {
            acc.pos_w += position * impressions
            acc.pos_i += impressions
          }
          merged.set(value, acc)
        }
      } catch (err) {
        if (err?.statusCode === 401) await markAuthInvalid(ctx.db, auth.id)
        else console.error('[public-metrics] search dimension error:', err?.message || err)
      }
    }

    return [name, {
      period,
      dimension: name,
      primary_metric: config.primary,
      rows: Array.from(merged.values())
        .map((row) => ({
          value: row.value,
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.impressions > 0 ? row.clicks / row.impressions : 0,
          position: row.pos_i > 0 ? row.pos_w / row.pos_i : 0,
        }))
        .sort((a, b) => (b.impressions || 0) - (a.impressions || 0))
        .slice(0, 50),
    }]
  })

  return Object.fromEntries(entries)
}

function shapeFunnel(row) {
  const steps = parseSteps(row.steps_config).map(shapeStep)
  return {
    funnel_key: row.funnel_key,
    project_key: row.project_key,
    name: row.name || '',
    step_count: steps.length,
    steps,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function emptyFunnelResult(funnel, period, error, dataSource = null) {
  const steps = (funnel.steps || []).map((step, index) => ({
    index,
    ...step,
    users: 0,
    cumulative_conversion: 0,
    drop_users: 0,
    drop_rate: 0,
  }))
  return {
    funnel_key: funnel.funnel_key,
    project_key: funnel.project_key,
    period,
    steps,
    total_users: 0,
    final_users: 0,
    overall_conversion_rate: 0,
    data_source: dataSource,
    error,
    fetched_at: Math.floor(Date.now() / 1000),
  }
}

async function buildFunnelResult(ctx, project, funnel, period, filters = []) {
  if ((funnel.steps || []).length < 2) return null

  const cacheKey = buildCacheKey(['public-ga4', 'funnel', funnel.funnel_key, period, publicPeriodRangeKey(period), cacheFilterPart(filters)])
  const ttlSec = publicCacheTtl({ period, filters, kind: 'funnels' })
  const cached = await readCache(ctx.db, project.project_id, cacheKey)
  if (cached) return cached

  const sources = ctx.sources(DataSourceProvider.GA4)
  const picked = sources.find(({ auth }) => auth?.status === RecordStatus.ACTIVE)
  if (!picked) return emptyFunnelResult(funnel, period, 'no_data_source')

  const { ds, auth } = picked
  const accessToken = await ctx.accessToken(auth)
  if (!accessToken) {
    return emptyFunnelResult(funnel, period, 'auth_invalid', {
      resource_id: ds.resource_id,
      resource_label: ds.resource_label || '',
      auth_status: 99,
    })
  }

  try {
    const range = ga4PeriodToRange(period)
    const report = await runFunnelReport({
      accessToken,
      propertyId: ds.resource_id,
      startDate: range.startDate,
      endDate: range.endDate,
      steps: funnel.steps,
      dimensionFilter: buildDimensionFilter(filters),
    })
    const parsed = extractFunnel(report, funnel.steps)
    const payload = {
      funnel_key: funnel.funnel_key,
      project_key: project.project_key,
      period,
      steps: parsed.steps,
      total_users: parsed.total_users,
      final_users: parsed.final_users,
      overall_conversion_rate: parsed.overall_conversion_rate,
      data_source: {
        resource_id: ds.resource_id,
        resource_label: ds.resource_label || '',
        auth_status: auth.status,
      },
      error: null,
      fetched_at: Math.floor(Date.now() / 1000),
    }
    await writeCache(ctx.db, project.project_id, cacheKey, payload, ttlSec)
    return payload
  } catch (err) {
    if (err?.statusCode === 401) {
      await markAuthInvalid(ctx.db, auth.id)
      return emptyFunnelResult(funnel, period, 'auth_invalid', {
        resource_id: ds.resource_id,
        resource_label: ds.resource_label || '',
        auth_status: 99,
      })
    }
    console.error('[public-metrics] funnel error:', err?.statusCode, err?.message || err)
    return emptyFunnelResult(funnel, period, 'funnel_unavailable', {
      resource_id: ds.resource_id,
      resource_label: ds.resource_label || '',
      auth_status: auth.status,
    })
  }
}

async function buildFunnels(ctx, project, period, filters = []) {
  const rows = await ctx.db.select().from(project_funnel)
    .where(and(
      eq(project_funnel.project_id, project.project_id),
      eq(project_funnel.union_id, project.union_id),
      eq(project_funnel.project_key, project.project_key),
      eq(project_funnel.status, RecordStatus.ACTIVE),
    ))
    .orderBy(desc(project_funnel.id))

  const list = rows.map(shapeFunnel).filter((funnel) => funnel.steps.length >= 2)
  if (!list.length) return { enabled: true, list: [], results: {} }

  const entries = await mapLimit(
    list,
    6,
    async (funnel) => [
      funnel.funnel_key,
      await buildFunnelResult(ctx, project, funnel, period, filters),
    ],
  )

  return {
    enabled: true,
    list,
    results: Object.fromEntries(entries.filter(([, result]) => result)),
  }
}

async function buildTrafficCard(ctx, period, filters = []) {
  const sources = ctx.sources(DataSourceProvider.GA4)
  const emptyTimeseries = { period, metric: 'screenPageViews', labels: [], series: [] }
  if (!sources.length) {
    return {
      summary: { period, metrics: emptyGa4Metrics(), previous_metrics: emptyGa4Metrics(), fetched_at: Math.floor(Date.now() / 1000) },
      timeseries: emptyTimeseries,
      timeseries_metrics: { screenPageViews: emptyTimeseries },
    }
  }

  const range = ga4PeriodToRange(period)
  const merged = new Map()
  const totals = []
  const dimensionFilter = buildDimensionFilter(filters)

  for (const { ds, auth } of sources) {
    const accessToken = await ctx.accessToken(auth)
    if (!accessToken) continue

    try {
      const report = await runReport({
        accessToken,
        propertyId: ds.resource_id,
        startDate: range.startDate,
        endDate: range.endDate,
        metrics: GA4_CORE_METRICS,
        dimensions: ['date'],
        orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }],
        limit: 100000,
        dimensionFilter,
      })
      totals.push(extractTotals(report, GA4_CORE_METRICS))
      for (const row of extractRows(report, ['screenPageViews'])) {
        const date = formatGa4Date(row.dimensions?.date)
        if (date) addMapValue(merged, date, row.metrics?.screenPageViews)
      }
    } catch (err) {
      if (err?.statusCode === 401) await markAuthInvalid(ctx.db, auth.id)
      else console.error('[public-metrics] ga4 card error:', err?.message || err)
    }
  }

  const labels = periodDateLabels(period, merged.keys())
  const timeseries = {
    period,
    metric: 'screenPageViews',
    labels,
    series: [{ label: 'Traffic', data: labels.map((date) => Number(merged.get(date)) || 0) }],
  }
  return {
    summary: {
      period,
      metrics: aggregateMetrics(totals),
      previous_metrics: emptyGa4Metrics(),
      fetched_at: Math.floor(Date.now() / 1000),
    },
    timeseries,
    timeseries_metrics: { screenPageViews: timeseries },
  }
}

async function buildSearchCard(ctx, project, period, filters = []) {
  const providers = resolveSearchProviders('all')
  const sources = ctx.sources(providers)
  const emptyTimeseries = { period, metric: 'clicks', labels: [], series: [] }
  if (!sources.length) {
    return {
      summary: { period, metrics: emptySearchMetrics(), previous_metrics: emptySearchMetrics(), provider_metrics: {} },
      timeseries: emptyTimeseries,
      timeseries_clicks: emptyTimeseries,
      timeseries_impressions: { ...emptyTimeseries, metric: 'impressions' },
    }
  }

  const range = searchPeriodToRange(period)
  const labels = enumerateDates(range.startDate, range.endDate)
  const merged = new Map()
  const totals = []
  const providerMetrics = {}
  const gscFilters = mapGa4FiltersToGsc(filters, project)

  for (const { ds, auth } of sources) {
    const adapter = providerOf(ds.provider)
    const credential = await ctx.credential(auth)
    if (!credential) continue

    try {
      const report = await adapter.runReport({
        accessToken: credential,
        apiKey: credential,
        siteUrl: ds.resource_id,
        startDate: range.startDate,
        endDate: range.endDate,
        dimensions: ['date'],
        rowLimit: 25000,
        filters: ds.provider === DataSourceProvider.GSC ? gscFilters : undefined,
      })
      for (const row of (report?.rows || [])) addSearchDaily(merged, row)
      const item = adapter.extractTotals(report)
      totals.push(item)
      if (!providerMetrics[ds.provider]) providerMetrics[ds.provider] = []
      providerMetrics[ds.provider].push(item)
    } catch (err) {
      if (err?.statusCode === 401) await markAuthInvalid(ctx.db, auth.id)
      else console.error('[public-metrics] search card error:', err?.message || err)
    }
  }

  const mergedProviders = {}
  for (const [provider, arr] of Object.entries(providerMetrics)) {
    mergedProviders[provider] = pickSearchOutput(mergeSearchMetrics(arr))
  }

  const clicks = {
    period,
    metric: 'clicks',
    labels,
    series: [{ label: 'Search', data: labels.map((date) => searchPoint(merged.get(date), 'clicks')) }],
  }
  const impressions = {
    period,
    metric: 'impressions',
    labels,
    series: [{ label: 'Search', data: labels.map((date) => searchPoint(merged.get(date), 'impressions')) }],
  }
  return {
    summary: {
      period,
      metrics: pickSearchOutput(mergeSearchMetrics(totals)),
      previous_metrics: emptySearchMetrics(),
      provider_metrics: mergedProviders,
      fetched_at: Math.floor(Date.now() / 1000),
    },
    timeseries: clicks,
    timeseries_clicks: clicks,
    timeseries_impressions: impressions,
  }
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

export function publicPeriodRangeKey(period) {
  const range = searchPeriodToRange(period)
  return `${range.startDate}_${range.endDate}`
}

export function publicCacheTtl({ period, filters = [], kind = 'core' }) {
  if (kind === 'realtime') return 25
  if (Array.isArray(filters) && filters.length) return 5 * 60
  if (kind === 'funnels') return 60 * 60

  const range = searchPeriodToRange(period)
  if (range.endDate < todayIso()) return 24 * 60 * 60
  return 60 * 60
}

function publicMetricsKind(options) {
  if (options.kind) return String(options.kind)
  if (options.includeDimensions || options.includeRealtime || options.includeFunnels) return 'full'
  if (options.includeTrafficMetricSeries) return 'core'
  return 'core-lite'
}

function cacheFilterPart(filters) {
  return filterCacheKey(filters).replace(/^:/, '')
}

function withCacheMeta(payload, cacheState) {
  return {
    ...(payload || {}),
    from_cache: cacheState === 'hit' || cacheState === 'stale',
    cache_state: cacheState,
  }
}

function payloadHasRealtimeError(payload) {
  return isRealtimeError(payload?.realtime)
}

function waitUntil(event, promise) {
  const guarded = promise.catch((err) => console.error('[public-metrics] background refresh error:', err?.message || err))
  const cfWaitUntil = event.context?.cloudflare?.context?.waitUntil
  if (typeof cfWaitUntil === 'function') cfWaitUntil(guarded)
}

async function refreshPublicMetricsCache(event, db, options, cacheKey, ttlSec) {
  const payload = await buildPublicProjectMetricsPayload(event, db, options)
  if (payloadHasRealtimeError(payload)) return
  await writeCache(db, options.project.project_id, cacheKey, payload, ttlSec)
}

async function loadPublicRealtimePayload(event, db, options, period) {
  const project = options.project
  const owner = { project_id: project.project_id, union_id: project.union_id }
  const ctx = await createMetricsContext(event, db, owner, project.project_key)
  return await loadCachedProjectRealtime(event, {
    db,
    projectId: project.project_id,
    projectKey: project.project_key,
    sources: ctx.sources(DataSourceProvider.GA4),
    logPrefix: '[public-metrics] realtime',
    accessTokenForSource: ({ auth }) => ctx.accessTokenStrict(auth),
    onAuthInvalid: (authId) => markAuthInvalid(db, authId),
  })
}

async function loadPublicRealtimeMetrics(event, db, options, period) {
  const realtime = options.mode === PublicProjectMode.PUBLIC
    ? await loadPublicRealtimePayload(event, db, options, period)
    : null
  return {
    mode: options.mode,
    period,
    realtime,
    fetched_at: realtime?.fetched_at || Math.floor(Date.now() / 1000),
    from_cache: Boolean(realtime?.from_cache),
    cache_state: realtime?.cache_state || 'miss',
  }
}

export async function loadPublicProjectMetrics(event, db, options) {
  const period = publicPeriod(options.period)
  const filters = Array.isArray(options.filters) ? options.filters : []
  const mode = options.mode
  const setting = options.setting
  const project = options.project
  const kind = publicMetricsKind(options)
  const ttlSec = publicCacheTtl({ period, filters, kind })

  if (kind === 'realtime') {
    return loadPublicRealtimeMetrics(event, db, { ...options, period }, period)
  }

  const cacheKey = buildCacheKey([
    'public-project-v3',
    setting.public_project_key,
    mode,
    period,
    publicPeriodRangeKey(period),
    kind,
    cacheFilterPart(filters),
  ])

  const entry = await readCacheEntry(db, project.project_id, cacheKey, {
    staleTtlSeconds: kind === 'realtime' ? 60 : CONSUMER_STALE_TTL_SECONDS,
  })
  if (entry?.state === 'hit') return withCacheMeta(entry.payload, 'hit')
  if (entry?.state === 'stale') {
    const claimed = await claimCacheRefresh(db, project.project_id, cacheKey, entry.expiresAt, 30)
    if (claimed) {
      waitUntil(event, refreshPublicMetricsCache(event, db, { ...options, period }, cacheKey, ttlSec))
    }
    return withCacheMeta(entry.payload, 'stale')
  }

  const payload = await buildPublicProjectMetricsPayload(event, db, { ...options, period })
  if (payloadHasRealtimeError(payload)) {
    return withCacheMeta(payload, payload.realtime?.cache_state || 'error-empty')
  }
  await writeCache(db, project.project_id, cacheKey, payload, ttlSec)
  return withCacheMeta(payload, 'miss')
}

async function buildPublicProjectMetricsPayload(event, db, options) {
  const period = publicPeriod(options.period)
  const filters = Array.isArray(options.filters) ? options.filters : []
  const mode = options.mode
  const project = options.project
  const owner = { project_id: project.project_id, union_id: project.union_id }
  const kind = publicMetricsKind(options)
  const ctx = await createMetricsContext(event, db, owner, project.project_key)
  const payload = {
    mode,
    period,
    fetched_at: Math.floor(Date.now() / 1000),
  }

  if (kind === 'card') {
    const [traffic, search] = await Promise.all([
      buildTrafficCard(ctx, period, filters),
      buildSearchCard(ctx, project, period, filters),
    ])
    payload.traffic = traffic
    payload.search = search
    return payload
  }

  const buildCore = !['dims', 'realtime', 'funnels'].includes(kind)
  const fullDetail = ['full', 'dims'].includes(kind) && mode === PublicProjectMode.PUBLIC
  const detailSeries = ['core', 'full'].includes(kind)
    && [PublicProjectMode.PUBLIC, PublicProjectMode.SEMI_PUBLIC].includes(mode)
  const trafficTimeseriesMetrics = detailSeries
    ? ['screenPageViews', 'totalUsers', 'bounceRate', 'averageSessionDuration']
    : ['screenPageViews']

  if (buildCore) {
    const [trafficSummary, trafficTimeseriesBundle, searchSummary, searchTimeseries] = await Promise.all([
      buildTrafficSummary(ctx, period, filters),
      buildTrafficTimeseriesBundle(ctx, period, trafficTimeseriesMetrics, filters),
      buildSearchSummary(ctx, project, period, filters),
      buildSearchTimeseriesBundle(ctx, project, period, ['clicks', 'impressions'], filters),
    ])
    const trafficTimeseries = trafficTimeseriesBundle.screenPageViews || { period, metric: 'screenPageViews', labels: [], series: [] }
    const searchClicks = searchTimeseries.clicks || { period, metric: 'clicks', labels: [], series: [] }
    const searchImpressions = searchTimeseries.impressions || { period, metric: 'impressions', labels: [], series: [] }

    payload.traffic = {
      summary: trafficSummary,
      timeseries: trafficTimeseries,
      timeseries_metrics: trafficTimeseriesBundle,
    }
    payload.search = {
      summary: searchSummary,
      timeseries: searchClicks,
      timeseries_clicks: searchClicks,
      timeseries_impressions: searchImpressions,
    }
  }

  if (fullDetail) {
    const trafficDimensions = await buildTrafficDimensions(ctx, period, filters)
    const searchDimensions = await buildSearchDimensions(ctx, project, period, filters)
    payload.traffic = { ...(payload.traffic || {}), dimensions: trafficDimensions }
    payload.search = { ...(payload.search || {}), dimensions: searchDimensions }
  }

  if ((kind === 'full' || kind === 'realtime') && mode === PublicProjectMode.PUBLIC) {
    payload.realtime = await loadPublicRealtimePayload(event, db, options, period)
  }

  if ((kind === 'full' || kind === 'funnels') && mode === PublicProjectMode.PUBLIC) {
    payload.funnels = await buildFunnels(ctx, project, period, filters)
  }

  return payload
}

function sumObjects(items) {
  const out = {}
  for (const item of items) {
    for (const [key, value] of Object.entries(item || {})) {
      out[key] = (Number(out[key]) || 0) + (Number(value) || 0)
    }
  }
  return out
}

function mergeSeries(items, label) {
  const map = new Map()
  let metric = ''
  for (const item of items) {
    if (!metric && item?.metric) metric = item.metric
    const labels = item?.labels || []
    const data = item?.series?.[0]?.data || []
    for (let i = 0; i < labels.length; i++) addMapValue(map, labels[i], data[i])
  }
  const labels = Array.from(map.keys()).sort()
  return { metric, labels, series: [{ label, data: labels.map((key) => map.get(key) || 0) }] }
}

function firstSeriesData(timeseries) {
  return Array.isArray(timeseries?.series?.[0]?.data)
    ? timeseries.series[0].data
    : []
}

function mergeSearchSummary(items) {
  return pickSearchOutput(mergeSearchMetrics(items))
}

function publicProjectMetricsCard(baseCard, metric, providers) {
  const card = {
    ...baseCard,
    providers,
  }
  if (!metric || baseCard.locked) return card

  card.traffic = {
    metrics: metric.traffic?.summary?.metrics || {},
    sparkline: firstSeriesData(metric.traffic?.timeseries),
  }
  card.search = {
    metrics: metric.search?.summary?.metrics || {},
    sparkline_clicks: firstSeriesData(metric.search?.timeseries_clicks || metric.search?.timeseries),
    sparkline_impressions: firstSeriesData(metric.search?.timeseries_impressions),
    provider_metrics: metric.search?.summary?.provider_metrics || {},
  }
  return card
}

export async function loadPublicProfileMetrics(event, db, profile, projects, period) {
  const safePeriod = publicPeriod(period)
  const visibilityVersion = [
    profile.updated_at || 0,
    ...projects.map((item) => [
      item.setting?.public_project_key || '',
      item.setting?.visibility_mode || '',
      item.setting?.updated_at || 0,
    ].join(':')),
  ].join('|')
  const cacheKey = buildCacheKey(['public-v3', profile.slug, safePeriod, publicPeriodRangeKey(safePeriod), visibilityVersion])
  const ttlSec = publicCacheTtl({ period: safePeriod, filters: [], kind: 'core' })
  const cached = await readCache(db, profile.project_id, cacheKey)
  if (cached) return cached

  const providersByProject = await loadPublicProjectProviderMap(db, profile)
  const metrics = []
  const projectCards = []
  for (let i = 0; i < projects.length; i++) {
    const item = projects[i]
    const baseCard = shapePublicProjectCard({
      project: item.project,
      setting: item.setting,
      mode: item.mode,
      index: i,
    })
    if (!baseCard) continue

    const providers = baseCard.locked
      ? []
      : (providersByProject.get(item.project?.project_key) || [])
    let metric = null
    if ([PublicProjectMode.PUBLIC, PublicProjectMode.SEMI_PUBLIC].includes(item.mode)) {
      metric = await loadPublicProjectMetrics(event, db, {
        project: item.project,
        setting: item.setting,
        mode: item.mode,
        period: safePeriod,
        includeDimensions: false,
      })
      metrics.push(metric)
    }
    projectCards.push(publicProjectMetricsCard(baseCard, metric, providers))
  }

  const payload = {
    period: safePeriod,
    traffic: {
      summary: {
        period: safePeriod,
        metrics: sumObjects(metrics.map((m) => m.traffic?.summary?.metrics)),
        previous_metrics: sumObjects(metrics.map((m) => m.traffic?.summary?.previous_metrics)),
      },
      timeseries: mergeSeries(metrics.map((m) => m.traffic?.timeseries), 'Traffic'),
    },
    search: {
      summary: {
        period: safePeriod,
        metrics: mergeSearchSummary(metrics.map((m) => m.search?.summary?.metrics)),
        previous_metrics: mergeSearchSummary(metrics.map((m) => m.search?.summary?.previous_metrics)),
      },
      timeseries: mergeSeries(metrics.map((m) => m.search?.timeseries), 'Search'),
    },
    projects: projectCards,
    fetched_at: Math.floor(Date.now() / 1000),
  }

  await writeCache(db, profile.project_id, cacheKey, payload, ttlSec)
  return payload
}
