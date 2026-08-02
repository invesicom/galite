import { and, desc, eq, sql } from 'drizzle-orm'
import {
  data_source_auth,
  project_data_source,
  project_list,
  public_profile,
  public_project_setting,
} from '../database/schema'
import { METRICS_CACHE_TTL_MS, RecordStatus } from './constants'
import { getFirst, runWithAmbientEnv, runWithAmbientUser, useDb } from './db'
import { filterCacheKey } from './filters'
import {
  buildCacheKey,
  claimCacheRefresh,
  CONSUMER_STALE_TTL_SECONDS,
  readCacheEntry,
  writeCache,
} from './metrics-cache'
import { resolveOrigin } from './mcp-oauth'
import { enforceRateLimit } from './rate-limit'

const PERIOD_ENUM = ['today', 'yesterday', '7days', '28days', '90days', '6months', '1year']
const METRIC_ENUM = [
  'screenPageViews', 'totalUsers', 'activeUsers', 'newUsers',
  'sessions', 'bounceRate', 'averageSessionDuration', 'userEngagementDuration',
]
const DIMENSION_ENUM = [
  'country', 'sessionDefaultChannelGroup', 'deviceCategory', 'pagePath',
  'browser', 'operatingSystem', 'sessionSource', 'eventName',
]
const SEARCH_PROVIDER_ENUM = ['all', 'gsc', 'bing']
const SEARCH_METRIC_ENUM = ['impressions', 'clicks', 'ctr', 'position']
const SEARCH_DIMENSION_ENUM = ['query', 'page', 'country', 'device', 'searchAppearance']
const GSC_METRIC_ENUM = SEARCH_METRIC_ENUM
const GSC_DIMENSION_ENUM = SEARCH_DIMENSION_ENUM
const OVERVIEW_DIMENSIONS = ['sessionSource', 'pagePath', 'country', 'deviceCategory']

const ANY_OBJECT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
}
const READ_ONLY_ANNOTATIONS = { readOnlyHint: true }

const FILTER_DIM_ENUM = [
  'sessionSource', 'pagePath', 'eventName', 'country',
  'browser', 'operatingSystem', 'deviceCategory',
  'sessionDefaultChannelGroup', 'searchQuery',
]
const FILTER_MATCH_ENUM = [
  'exact', 'not_equals',
  'contains', 'not_contains',
  'starts_with', 'not_starts_with',
  'ends_with', 'not_ends_with',
]

const FILTERS_SCHEMA = {
  type: 'array',
  description: 'Optional dimension filters. Example: [{dim:"country",match:"exact",value:"US"},{dim:"pagePath",match:"starts_with",value:"/blog"}]. Unsupported provider dimensions are ignored by that provider.',
  items: {
    type: 'object',
    properties: {
      dim: { type: 'string', enum: FILTER_DIM_ENUM, description: 'Dimension to filter on' },
      match: { type: 'string', enum: FILTER_MATCH_ENUM, description: 'Match mode' },
      value: { type: 'string', description: 'Value to match against' },
    },
    required: ['dim', 'match', 'value'],
    additionalProperties: false,
  },
  default: [],
}

function filtersQuery(filters) {
  if (!Array.isArray(filters) || !filters.length) return {}
  const f = filters
    .filter((x) => x && x.dim && x.match && x.value)
    .map((x) => `${x.dim}:${x.match}:${x.value}`)
  return f.length ? { f } : {}
}

function spOf(value = 'all') {
  return String(value || 'all').trim() || 'all'
}

const TOOL_DEFS = [
  {
    name: 'list_projects',
    description: 'List all projects accessible by the API key. Returns project_key and provider hints for other tools.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    route: () => ({ method: 'GET', path: '/api/v1/projects/list' }),
  },
  {
    name: 'get_project',
    description: 'Fetch one project metadata plus attached data sources. Secrets are not returned.',
    inputSchema: {
      type: 'object',
      properties: { project_key: { type: 'string', description: 'Project key from list_projects' } },
      required: ['project_key'],
      additionalProperties: false,
    },
    route: ({ project_key }) => ({ method: 'GET', path: `/api/v1/projects/${encodeURIComponent(project_key)}` }),
  },
  {
    name: 'list_data_sources',
    description: 'Read-only diagnostic list of connected data source accounts, token status, and mounted resource counts. Use this when metrics fail or a user asks what is connected.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', enum: ['ga4', 'gsc', 'bing'], description: 'Optional provider filter' },
      },
      additionalProperties: false,
    },
    handler: listDataSources,
  },
  {
    name: 'get_public_profile',
    description: 'Read-only public profile status: profile URL, display settings, and per-project visibility. Does not expose password hashes or private identifiers.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: getPublicProfile,
  },
  {
    name: 'get_connect_url',
    description: 'Return dashboard deep links and OAuth start URLs so the user can connect or reauthorize data sources in the browser. This tool never performs authorization itself.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', enum: ['ga4', 'gsc', 'bing'], default: 'ga4' },
        mode: { type: 'string', enum: ['basic', 'extended'], default: 'basic' },
      },
      additionalProperties: false,
    },
    handler: getConnectUrl,
  },
  {
    name: 'get_summary',
    description: 'Aggregated GA4 core metrics for a project over a period. Supports dimension filters.',
    inputSchema: {
      type: 'object',
      properties: {
        project_key: { type: 'string' },
        period: { type: 'string', enum: PERIOD_ENUM, default: '7days' },
        filters: FILTERS_SCHEMA,
      },
      required: ['project_key'],
      additionalProperties: false,
    },
    route: ({ project_key, period = '7days', filters }) => ({
      method: 'GET',
      path: `/api/v1/metrics/${encodeURIComponent(project_key)}/summary`,
      query: { period, ...filtersQuery(filters) },
    }),
  },
  {
    name: 'get_timeseries',
    description: 'Time series of one GA4 metric. Supports dimension filters.',
    inputSchema: {
      type: 'object',
      properties: {
        project_key: { type: 'string' },
        period: { type: 'string', enum: PERIOD_ENUM, default: '7days' },
        metric: { type: 'string', enum: METRIC_ENUM, default: 'screenPageViews' },
        filters: FILTERS_SCHEMA,
      },
      required: ['project_key'],
      additionalProperties: false,
    },
    route: ({ project_key, period = '7days', metric = 'screenPageViews', filters }) => ({
      method: 'GET',
      path: `/api/v1/metrics/${encodeURIComponent(project_key)}/timeseries`,
      query: { period, metric, ...filtersQuery(filters) },
    }),
  },
  {
    name: 'get_dimension',
    description: 'Top-50 GA4 rows broken down by a dimension. Supports dimension filters.',
    inputSchema: {
      type: 'object',
      properties: {
        project_key: { type: 'string' },
        period: { type: 'string', enum: PERIOD_ENUM, default: '28days' },
        dimension: { type: 'string', enum: DIMENSION_ENUM, default: 'country' },
        filters: FILTERS_SCHEMA,
      },
      required: ['project_key'],
      additionalProperties: false,
    },
    route: ({ project_key, period = '28days', dimension = 'country', filters }) => ({
      method: 'GET',
      path: `/api/v1/metrics/${encodeURIComponent(project_key)}/dimension`,
      query: { period, dimension, ...filtersQuery(filters) },
    }),
  },
  {
    name: 'get_realtime',
    description: 'Active users in the last 30 minutes for a project.',
    inputSchema: {
      type: 'object',
      properties: { project_key: { type: 'string' } },
      required: ['project_key'],
      additionalProperties: false,
    },
    route: ({ project_key }) => ({ method: 'GET', path: `/api/v1/metrics/${encodeURIComponent(project_key)}/realtime` }),
  },
  {
    name: 'search_summary',
    description: 'Aggregated Search performance across Google Search Console and Bing Webmaster. Use search_provider=all, gsc, or bing.',
    inputSchema: {
      type: 'object',
      properties: {
        project_key: { type: 'string' },
        period: { type: 'string', enum: PERIOD_ENUM, default: '7days' },
        search_provider: { type: 'string', enum: SEARCH_PROVIDER_ENUM, default: 'all' },
        filters: FILTERS_SCHEMA,
      },
      required: ['project_key'],
      additionalProperties: false,
    },
    route: ({ project_key, period = '7days', search_provider = 'all', filters }) => ({
      method: 'GET',
      path: `/api/v1/metrics/${encodeURIComponent(project_key)}/search/summary`,
      query: { period, sp: spOf(search_provider), ...filtersQuery(filters) },
    }),
  },
  {
    name: 'search_timeseries',
    description: 'Search daily time series for one metric. Use search_provider=all, gsc, or bing.',
    inputSchema: {
      type: 'object',
      properties: {
        project_key: { type: 'string' },
        period: { type: 'string', enum: PERIOD_ENUM, default: '28days' },
        metric: { type: 'string', enum: SEARCH_METRIC_ENUM, default: 'clicks' },
        search_provider: { type: 'string', enum: SEARCH_PROVIDER_ENUM, default: 'all' },
        filters: FILTERS_SCHEMA,
      },
      required: ['project_key'],
      additionalProperties: false,
    },
    route: ({ project_key, period = '28days', metric = 'clicks', search_provider = 'all', filters }) => ({
      method: 'GET',
      path: `/api/v1/metrics/${encodeURIComponent(project_key)}/search/timeseries`,
      query: { period, metric, sp: spOf(search_provider), ...filtersQuery(filters) },
    }),
  },
  {
    name: 'search_dimension',
    description: 'Top Search rows by query, page, country, device, or searchAppearance. Use search_provider=all, gsc, or bing.',
    inputSchema: {
      type: 'object',
      properties: {
        project_key: { type: 'string' },
        period: { type: 'string', enum: PERIOD_ENUM, default: '28days' },
        dimension: { type: 'string', enum: SEARCH_DIMENSION_ENUM, default: 'query' },
        search_provider: { type: 'string', enum: SEARCH_PROVIDER_ENUM, default: 'all' },
        filters: FILTERS_SCHEMA,
      },
      required: ['project_key'],
      additionalProperties: false,
    },
    route: ({ project_key, period = '28days', dimension = 'query', search_provider = 'all', filters }) => ({
      method: 'GET',
      path: `/api/v1/metrics/${encodeURIComponent(project_key)}/search/dimension`,
      query: { period, dimension, sp: spOf(search_provider), ...filtersQuery(filters) },
    }),
  },
  {
    name: 'gsc_summary',
    description: 'Compatibility alias for search_summary with search_provider=gsc. Prefer search_summary for new clients.',
    inputSchema: {
      type: 'object',
      properties: {
        project_key: { type: 'string' },
        period: { type: 'string', enum: PERIOD_ENUM, default: '7days' },
        filters: FILTERS_SCHEMA,
      },
      required: ['project_key'],
      additionalProperties: false,
    },
    route: ({ project_key, period = '7days', filters }) => ({
      method: 'GET',
      path: `/api/v1/metrics/${encodeURIComponent(project_key)}/search/summary`,
      query: { period, sp: 'gsc', ...filtersQuery(filters) },
    }),
  },
  {
    name: 'gsc_timeseries',
    description: 'Compatibility alias for search_timeseries with search_provider=gsc. Prefer search_timeseries for new clients.',
    inputSchema: {
      type: 'object',
      properties: {
        project_key: { type: 'string' },
        period: { type: 'string', enum: PERIOD_ENUM, default: '28days' },
        metric: { type: 'string', enum: GSC_METRIC_ENUM, default: 'impressions' },
        filters: FILTERS_SCHEMA,
      },
      required: ['project_key'],
      additionalProperties: false,
    },
    route: ({ project_key, period = '28days', metric = 'impressions', filters }) => ({
      method: 'GET',
      path: `/api/v1/metrics/${encodeURIComponent(project_key)}/search/timeseries`,
      query: { period, metric, sp: 'gsc', ...filtersQuery(filters) },
    }),
  },
  {
    name: 'gsc_dimension',
    description: 'Compatibility alias for search_dimension with search_provider=gsc. Prefer search_dimension for new clients.',
    inputSchema: {
      type: 'object',
      properties: {
        project_key: { type: 'string' },
        period: { type: 'string', enum: PERIOD_ENUM, default: '28days' },
        dimension: { type: 'string', enum: GSC_DIMENSION_ENUM, default: 'query' },
        filters: FILTERS_SCHEMA,
      },
      required: ['project_key'],
      additionalProperties: false,
    },
    route: ({ project_key, period = '28days', dimension = 'query', filters }) => ({
      method: 'GET',
      path: `/api/v1/metrics/${encodeURIComponent(project_key)}/search/dimension`,
      query: { period, dimension, sp: 'gsc', ...filtersQuery(filters) },
    }),
  },
  {
    name: 'get_site_overview',
    description: 'Start here for any site analysis. Returns GA4 summary, primary traffic trend, top dimensions, and Search summary in one call. Values include fetched_at timestamps when available.',
    inputSchema: {
      type: 'object',
      properties: {
        project_key: { type: 'string', description: 'Project key from list_projects' },
        period: { type: 'string', enum: PERIOD_ENUM, default: '28days' },
        filters: FILTERS_SCHEMA,
      },
      required: ['project_key'],
      additionalProperties: false,
    },
    handler: getSiteOverview,
  },
  {
    name: 'ga4_run_report',
    description: 'Native GA4 Data API runReport compatibility tool. Request and response format match properties/{property}:runReport; pass project_key plus optional resource_id/property_id to select a mounted GA4 property.',
    inputSchema: {
      type: 'object',
      properties: {
        project_key: { type: 'string' },
        resource_id: { type: 'string', description: 'Optional mounted GA4 resource_id, e.g. properties/123456' },
        property_id: { type: 'string', description: 'Alias for resource_id' },
        dateRanges: { type: 'array', items: { type: 'object', additionalProperties: true } },
        dimensions: { type: 'array', items: { type: 'object', additionalProperties: true } },
        metrics: { type: 'array', items: { type: 'object', additionalProperties: true } },
        dimensionFilter: ANY_OBJECT_SCHEMA,
        metricFilter: ANY_OBJECT_SCHEMA,
        orderBys: { type: 'array', items: { type: 'object', additionalProperties: true } },
        limit: { type: ['integer', 'string'] },
        offset: { type: ['integer', 'string'] },
        keepEmptyRows: { type: 'boolean' },
        metricAggregations: { type: 'array', items: { type: 'string' } },
      },
      required: ['project_key', 'dateRanges', 'metrics'],
      additionalProperties: true,
    },
    route: (args) => rawGa4Route(args, 'runReport'),
    shape: rawResponse,
  },
  {
    name: 'ga4_run_realtime_report',
    description: 'Native GA4 Data API runRealtimeReport compatibility tool. Request and response format match properties/{property}:runRealtimeReport.',
    inputSchema: {
      type: 'object',
      properties: {
        project_key: { type: 'string' },
        resource_id: { type: 'string' },
        property_id: { type: 'string' },
        dimensions: { type: 'array', items: { type: 'object', additionalProperties: true } },
        metrics: { type: 'array', items: { type: 'object', additionalProperties: true } },
        minuteRanges: { type: 'array', items: { type: 'object', additionalProperties: true } },
        dimensionFilter: ANY_OBJECT_SCHEMA,
        metricFilter: ANY_OBJECT_SCHEMA,
        orderBys: { type: 'array', items: { type: 'object', additionalProperties: true } },
        limit: { type: ['integer', 'string'] },
        metricAggregations: { type: 'array', items: { type: 'string' } },
      },
      required: ['project_key', 'metrics'],
      additionalProperties: true,
    },
    route: (args) => rawGa4Route(args, 'runRealtimeReport'),
    shape: rawResponse,
  },
  {
    name: 'gsc_search_analytics',
    description: 'Native Google Search Console searchanalytics/query compatibility tool. Response uses rows[{keys,clicks,impressions,ctr,position}] exactly as the Search Console API.',
    inputSchema: {
      type: 'object',
      properties: {
        project_key: { type: 'string' },
        resource_id: { type: 'string', description: 'Optional mounted GSC siteUrl, e.g. sc-domain:example.com or https://example.com/' },
        site_url: { type: 'string', description: 'Alias for resource_id' },
        startDate: { type: 'string' },
        endDate: { type: 'string' },
        dimensions: { type: 'array', items: { type: 'string' } },
        rowLimit: { type: 'integer', default: 1000 },
        startRow: { type: 'integer' },
        dimensionFilterGroups: { type: 'array', items: { type: 'object', additionalProperties: true } },
        searchType: { type: 'string' },
        dataState: { type: 'string' },
      },
      required: ['project_key', 'startDate', 'endDate'],
      additionalProperties: true,
    },
    route: rawGscRoute,
    shape: rawResponse,
  },
  {
    name: 'bing_query_stats',
    description: 'Bing Webmaster native query/page stats compatibility tool. Returns the Bing Webmaster JSON response with the API key injected server-side.',
    inputSchema: {
      type: 'object',
      properties: {
        project_key: { type: 'string' },
        resource_id: { type: 'string', description: 'Optional mounted Bing site URL' },
        site_url: { type: 'string', description: 'Alias for resource_id' },
        dimension: { type: 'string', enum: ['query', 'page', 'rank'], default: 'query' },
        startDate: { type: 'string', description: 'Optional native query param, when supported by Bing' },
        endDate: { type: 'string', description: 'Optional native query param, when supported by Bing' },
        rowLimit: { type: ['integer', 'string'], description: 'Optional native query param, when supported by Bing' },
        params: ANY_OBJECT_SCHEMA,
        query: ANY_OBJECT_SCHEMA,
      },
      required: ['project_key'],
      additionalProperties: false,
    },
    route: rawBingRoute,
    shape: rawResponse,
  },
  {
    name: 'list_funnels',
    description: 'List all conversion funnels configured under a project.',
    inputSchema: {
      type: 'object',
      properties: { project_key: { type: 'string', description: 'Project key from list_projects' } },
      required: ['project_key'],
      additionalProperties: false,
    },
    route: ({ project_key }) => ({ method: 'GET', path: `/api/v1/projects/${encodeURIComponent(project_key)}/funnels/list` }),
  },
  {
    name: 'get_funnel',
    description: 'Fetch a single funnel definition.',
    inputSchema: {
      type: 'object',
      properties: { funnel_key: { type: 'string', description: 'Funnel key from list_funnels' } },
      required: ['funnel_key'],
      additionalProperties: false,
    },
    route: ({ funnel_key }) => ({ method: 'GET', path: `/api/v1/funnels/${encodeURIComponent(funnel_key)}` }),
  },
  {
    name: 'get_funnel_results',
    description: 'Execute a funnel against GA4 for the given period.',
    inputSchema: {
      type: 'object',
      properties: {
        funnel_key: { type: 'string' },
        period: { type: 'string', enum: PERIOD_ENUM, default: '7days' },
      },
      required: ['funnel_key'],
      additionalProperties: false,
    },
    route: ({ funnel_key, period = '7days' }) => ({
      method: 'GET',
      path: `/api/v1/funnels/${encodeURIComponent(funnel_key)}/results`,
      query: { period },
    }),
  },
]

export const TOOLS = TOOL_DEFS.map((tool) => ({
  outputSchema: tool.outputSchema || ANY_OBJECT_SCHEMA,
  annotations: { ...READ_ONLY_ANNOTATIONS, ...(tool.annotations || {}) },
  ...tool,
}))

const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]))

export function getTool(name) {
  return TOOL_MAP.get(name) || null
}

export async function callTool(event, name, args) {
  const tool = TOOL_MAP.get(name)
  if (!tool) {
    const e = new Error(`unknown tool: ${name}`)
    e.rpcCode = -32601
    throw e
  }
  assertRequiredArgs(tool, args || {})

  if (typeof tool.handler === 'function') {
    event.context.user = event.context.mcpAuth?.user || event.context.user
    await enforceRateLimit(event)
    return tool.handler(event, args || {})
  }

  const data = await fetchV1(event, tool.route(args || {}))
  return typeof tool.shape === 'function' ? tool.shape(data) : data
}

function assertRequiredArgs(tool, args) {
  for (const k of tool.inputSchema?.required || []) {
    if (args[k] === undefined || args[k] === null || args[k] === '') {
      const e = new Error(`missing required arg: ${k}`)
      e.rpcCode = -32602
      throw e
    }
  }
}

async function fetchV1(event, route, extraHeaders = {}) {
  const { method, path, query, body } = route
  const auth = getHeader(event, 'authorization') || ''
  const host = getHeader(event, 'host') || ''
  const xfProto = getHeader(event, 'x-forwarded-proto') || ''
  const headers = {}
  if (auth) headers.Authorization = auth
  if (host) headers.Host = host
  if (xfProto) headers['x-forwarded-proto'] = xfProto
  Object.assign(headers, extraHeaders || {})

  const cfEnv = event?.context?.cloudflare?.env
  const authedUser = event?.context?.mcpAuth?.user || null

  let json
  try {
    json = await runWithAmbientEnv(cfEnv, () =>
      runWithAmbientUser(authedUser, () =>
        $fetch(path, { method, query, body, headers }),
      ),
    )
  } catch (fetchErr) {
    const status = fetchErr?.statusCode || fetchErr?.response?.status || 0
    const body = fetchErr?.data || fetchErr?.response?._data || null
    const reason = body?.msg || body?.message || fetchErr?.statusMessage || fetchErr?.message || 'fetch_failed'
    const err = new Error(`v1 ${method} ${path} → ${status}: ${reason}`)
    err.toolError = true
    err.status = status
    throw err
  }

  if (json?.code !== 200) {
    const err = new Error(`v1 ${method} ${path} → ${json?.code}: ${json?.msg || 'tool_call_failed'}`)
    err.toolError = true
    err.status = json?.code
    throw err
  }
  return json.data
}

function rawResponse(data) {
  return data?.response !== undefined ? data.response : data
}

function rawResource(args, aliases = []) {
  for (const key of ['resource_id', ...aliases]) {
    const value = String(args?.[key] || '').trim()
    if (value) return value
  }
  return ''
}

function nativeBody(args, ignored) {
  const skip = new Set(['project_key', 'resource_id', 'property_id', 'property', 'site_url', ...ignored])
  const body = {}
  for (const [key, value] of Object.entries(args || {})) {
    if (skip.has(key) || value === undefined) continue
    body[key] = value
  }
  return body
}

function rawGa4Route(args, methodName) {
  const resourceId = rawResource(args, ['property_id', 'property'])
  return {
    method: 'POST',
    path: '/api/v1/raw/ga4/proxy',
    body: {
      project_key: args.project_key,
      resource_id: resourceId,
      endpoint: resourceId ? `${resourceId}:${methodName}` : `{resource_id}:${methodName}`,
      body: nativeBody(args, []),
    },
  }
}

function rawGscRoute(args) {
  const resourceId = rawResource(args, ['site_url'])
  return {
    method: 'POST',
    path: '/api/v1/raw/gsc/proxy',
    body: {
      project_key: args.project_key,
      resource_id: resourceId,
      endpoint: resourceId
        ? `sites/${encodeURIComponent(resourceId)}/searchAnalytics/query`
        : 'sites/{resource_id_encoded}/searchAnalytics/query',
      body: nativeBody(args, ['site_url']),
    },
  }
}

function rawBingRoute(args) {
  const dimension = String(args.dimension || 'query')
  const endpoint = dimension === 'page'
    ? 'GetPageStats'
    : dimension === 'rank'
      ? 'GetRankAndTrafficStats'
      : 'GetQueryStats'
  return {
    method: 'POST',
    path: '/api/v1/raw/bing/proxy',
    body: {
      project_key: args.project_key,
      resource_id: rawResource(args, ['site_url']),
      endpoint,
      method: 'GET',
      body: {
        query: {
          ...nativeBody(args, ['site_url', 'dimension', 'query', 'params']),
          ...(args.params && typeof args.params === 'object' ? args.params : {}),
          ...(args.query && typeof args.query === 'object' ? args.query : {}),
        },
      },
    },
  }
}

async function getSiteOverview(event, args) {
  const projectKey = String(args.project_key || '')
  const period = String(args.period || '28days')
  const filters = args.filters
  const user = event.context.mcpAuth?.user || event.context.user
  const db = await useDb(event)
  const cacheKey = buildCacheKey(['mcp', 'overview', projectKey, period, filterCacheKey(filters)])
  const ttlSec = Math.floor(METRICS_CACHE_TTL_MS / 1000)

  const entry = await readCacheEntry(db, user.project_id, cacheKey, {
    staleTtlSeconds: CONSUMER_STALE_TTL_SECONDS,
  })
  if (entry?.state === 'hit') return withCacheMeta(entry.payload, 'hit')
  if (entry?.state === 'stale') {
    const claimed = await claimCacheRefresh(db, user.project_id, cacheKey, entry.expiresAt, 30)
    if (claimed) {
      waitUntil(event, refreshSiteOverviewCache(event, db, user.project_id, cacheKey, ttlSec, { projectKey, period, filters }))
    }
    return withCacheMeta(entry.payload, 'stale')
  }

  const payload = await buildSiteOverviewPayload(event, { projectKey, period, filters })
  await writeCache(db, user.project_id, cacheKey, payload, ttlSec)
  return withCacheMeta(payload, 'miss')
}

async function refreshSiteOverviewCache(event, db, projectId, cacheKey, ttlSec, args) {
  const payload = await buildSiteOverviewPayload(event, args)
  await writeCache(db, projectId, cacheKey, payload, ttlSec)
}

async function buildSiteOverviewPayload(event, { projectKey, period, filters }) {
  const filterQuery = filtersQuery(filters)
  const queryBase = { period, ...filterQuery }
  const overview = {
    project_key: projectKey,
    period,
    summary: null,
    traffic_timeseries: null,
    dimensions: {},
    search_summary: null,
    errors: [],
  }

  const calls = [
    ['summary', { method: 'GET', path: `/api/v1/metrics/${encodeURIComponent(projectKey)}/summary`, query: queryBase }],
    ['traffic_timeseries', { method: 'GET', path: `/api/v1/metrics/${encodeURIComponent(projectKey)}/timeseries`, query: { ...queryBase, metric: 'screenPageViews' } }],
    ['search_summary', { method: 'GET', path: `/api/v1/metrics/${encodeURIComponent(projectKey)}/search/summary`, query: { ...queryBase, sp: 'all' } }],
    ...OVERVIEW_DIMENSIONS.map((dimension) => [
      `dimension:${dimension}`,
      { method: 'GET', path: `/api/v1/metrics/${encodeURIComponent(projectKey)}/dimension`, query: { ...queryBase, dimension } },
    ]),
  ]

  const results = await Promise.allSettled(
    calls.map(([key, route]) =>
      fetchV1(event, route, { 'x-mcp-internal-composite': '1' }).then((data) => [key, data]),
    ),
  )

  for (const result of results) {
    if (result.status === 'fulfilled') {
      const [key, data] = result.value
      if (key.startsWith('dimension:')) overview.dimensions[key.slice('dimension:'.length)] = data
      else overview[key] = data
      continue
    }
    overview.errors.push(result.reason?.message || 'overview_part_failed')
  }

  overview.generated_at = Math.floor(Date.now() / 1000)
  return overview
}

function withCacheMeta(payload, cacheState) {
  return {
    ...(payload || {}),
    from_cache: cacheState === 'hit' || cacheState === 'stale',
    cache_state: cacheState,
  }
}

function waitUntil(event, promise) {
  const guarded = promise.catch((err) => console.error('[mcp-tools] background overview refresh error:', err?.message || err))
  const cfWaitUntil = event.context?.cloudflare?.context?.waitUntil
  if (typeof cfWaitUntil === 'function') cfWaitUntil(guarded)
}

async function listDataSources(event, args) {
  const user = event.context.mcpAuth?.user || event.context.user
  const provider = String(args.provider || '').trim()
  const db = await useDb(event)
  const conds = [
    eq(data_source_auth.project_id, user.project_id),
    eq(data_source_auth.union_id, user.union_id),
    sql`${data_source_auth.status} <> 97`,
  ]
  if (provider) conds.push(eq(data_source_auth.provider, provider))

  const rows = await db.select({
    id: data_source_auth.id,
    provider: data_source_auth.provider,
    account_email: data_source_auth.account_email,
    account_name: data_source_auth.account_name,
    scope: data_source_auth.scope,
    status: data_source_auth.status,
    token_expires_at: data_source_auth.token_expires_at,
    created_at: data_source_auth.created_at,
  })
    .from(data_source_auth)
    .where(and(...conds))
    .orderBy(data_source_auth.provider, data_source_auth.account_email)

  const mounts = await db.select({
    provider: project_data_source.provider,
    auth_id: project_data_source.auth_id,
    resource_id: project_data_source.resource_id,
    resource_label: project_data_source.resource_label,
    project_key: project_data_source.project_key,
  })
    .from(project_data_source)
    .where(and(
      eq(project_data_source.project_id, user.project_id),
      eq(project_data_source.union_id, user.union_id),
      eq(project_data_source.status, RecordStatus.ACTIVE),
    ))

  const mountedByAccount = new Map()
  for (const mount of mounts) {
    const key = `${mount.provider}:${mount.auth_id}`
    const list = mountedByAccount.get(key) || []
    list.push({
      project_key: mount.project_key,
      resource_id: mount.resource_id,
      resource_label: mount.resource_label || '',
    })
    mountedByAccount.set(key, list)
  }

  return {
    data_sources: rows.map((row) => ({
      provider: row.provider,
      account_email: row.account_email || '',
      account_name: row.account_name || '',
      scope: row.scope || '',
      status: Number(row.status) || 99,
      status_label: statusLabel(row.status),
      token_expires_at: Number(row.token_expires_at) || 0,
      mounted_resources: mountedByAccount.get(`${row.provider}:${row.id}`) || [],
      created_at: Number(row.created_at) || 0,
    })),
  }
}

async function getPublicProfile(event) {
  const user = event.context.mcpAuth?.user || event.context.user
  const db = await useDb(event)
  const profile = await getFirst(
    db.select({
      slug: public_profile.slug,
      display_name: public_profile.display_name,
      bio: public_profile.bio,
      visibility_mode: public_profile.visibility_mode,
      show_branding: public_profile.show_branding,
      website_url: public_profile.website_url,
      theme_key: public_profile.theme_key,
      status: public_profile.status,
      updated_at: public_profile.updated_at,
    })
      .from(public_profile)
      .where(and(
        eq(public_profile.project_id, user.project_id),
        eq(public_profile.union_id, user.union_id),
      ))
      .limit(1),
  )

  const projects = await db.select({
    project_key: project_list.project_key,
    name: project_list.name,
    site_url: project_list.site_url,
    public_project_key: public_project_setting.public_project_key,
    visibility_mode: public_project_setting.visibility_mode,
    anonymous_label: public_project_setting.anonymous_label,
    public_title: public_project_setting.public_title,
    priority: public_project_setting.priority,
  })
    .from(project_list)
    .leftJoin(public_project_setting, and(
      eq(public_project_setting.project_id, project_list.project_id),
      eq(public_project_setting.project_key, project_list.project_key),
    ))
    .where(and(
      eq(project_list.project_id, user.project_id),
      eq(project_list.union_id, user.union_id),
      eq(project_list.status, RecordStatus.ACTIVE),
    ))
    .orderBy(desc(project_list.priority), desc(project_list.id))

  const origin = resolveOrigin(event)
  const slug = profile?.slug || ''
  return {
    profile: profile
      ? {
          slug,
          display_name: profile.display_name || '',
          bio: profile.bio || '',
          visibility_mode: profile.visibility_mode || 'semi_public',
          show_branding: profile.show_branding !== 0,
          website_url: profile.website_url || '',
          theme_key: profile.theme_key || 'default',
          status: Number(profile.status) || 97,
          public_url: slug ? `${origin}/@${slug}` : '',
          updated_at: Number(profile.updated_at) || 0,
        }
      : { status: 97, public_url: '' },
    projects: projects.map((row) => ({
      project_key: row.project_key,
      name: row.name || '',
      site_url: row.site_url || '',
      public_project_key: row.public_project_key || '',
      visibility_mode: row.visibility_mode || 'inherit',
      anonymous_label: row.anonymous_label || '',
      public_title: row.public_title || '',
      priority: Number(row.priority) || 0,
      public_url: slug && row.public_project_key ? `${origin}/@${slug}/${row.public_project_key}` : '',
    })),
  }
}

async function getConnectUrl(event, args) {
  const origin = resolveOrigin(event)
  const provider = String(args.provider || 'ga4')
  const mode = args.mode === 'extended' ? 'extended' : 'basic'
  const dashboardUrl = `${origin}/integrations`
  const profileSettingsUrl = `${origin}/projects?public_settings=1`
  const out = {
    provider,
    dashboard_url: dashboardUrl,
    profile_settings_url: profileSettingsUrl,
    note: 'Open these links in the browser. MCP does not perform OAuth or settings writes.',
  }
  if (provider === 'bing') {
    return { ...out, action: 'open_integrations_and_add_bing_api_key' }
  }
  return {
    ...out,
    oauth_start_url: `${origin}/api/data-sources/oauth/${encodeURIComponent(provider)}?return_to=${encodeURIComponent('/integrations')}&mode=${encodeURIComponent(mode)}`,
  }
}

function statusLabel(status) {
  const n = Number(status)
  if (n === 1) return 'active'
  if (n === 99) return 'reauthorization_required'
  if (n === 97) return 'revoked'
  return 'unknown'
}
