/* ===================================================================
 * 共享 GA4 实时指标
 *
 * 职责:
 *   - dash / v1 / public 共用同一份 realtime builder 与缓存 key.
 *   - 失败是状态, 0 是数据; 失败 payload 永远不写缓存.
 *   - totals 是主数字, totals 失败不能用 0 猜测.
 * =================================================================== */

import { RecordStatus, REALTIME_CACHE_TTL_MS } from './constants'
import { runRealtimeReport, extractRows, extractTotals } from './providers/ga4'
import { readCacheEntry, writeCache, buildCacheKey, claimCacheRefresh } from './metrics-cache'
import { mapLimit } from './map-limit'

export const REALTIME_TOP_N = 50
export const REALTIME_CACHE_TTL_SECONDS = Math.floor(REALTIME_CACHE_TTL_MS / 1000)
export const REALTIME_STALE_TTL_SECONDS = 60
export const REALTIME_ERROR_STALE_TTL_SECONDS = 10 * 60

export class RealtimeUnavailableError extends Error {
  constructor(reason, cause = null) {
    super(reason)
    this.name = 'RealtimeUnavailableError'
    this.reason = reason
    this.cause = cause
  }
}

export function realtimeCacheKey(projectKey) {
  return buildCacheKey(['ga4', 'project', projectKey, 'realtime'])
}

export function realtimeErrorPayload(reason = 'error') {
  return {
    realtime_status: 'error',
    realtime_reason: reason,
    fetched_at: Math.floor(Date.now() / 1000),
  }
}

export function isRealtimeError(payload) {
  return payload?.realtime_status === 'error'
}

export function emptyRealtime(reason = 'no_source') {
  return {
    realtime_status: 'ok',
    realtime_reason: reason,
    active_users_30min: 0,
    by_minute: [],
    by_country: [],
    by_page: [],
    by_event: [],
    by_device: [],
    by_city: [],
    fetched_at: Math.floor(Date.now() / 1000),
  }
}

function errorReason(err) {
  if (err instanceof RealtimeUnavailableError) return err.reason
  return err?.message || 'error'
}

function withCacheMeta(payload, cacheState) {
  return {
    ...(payload || {}),
    from_cache: cacheState === 'hit'
      || cacheState === 'stale'
      || cacheState === 'error-stale',
    cache_state: cacheState,
  }
}

function logRealtimeError(prefix, phase, ds, auth, err) {
  const status = err?.statusCode ? ` status=${err.statusCode}` : ''
  console.error(
    `${prefix} ${phase} error auth=${auth?.id || '-'} property=${ds?.resource_id || '-'}${status}:`,
    err?.message || err,
  )
}

async function handleRealtimeError(prefix, phase, ds, auth, err, onAuthInvalid) {
  if (err?.statusCode === 401 && auth?.id) {
    await onAuthInvalid(auth.id)
  } else {
    logRealtimeError(prefix, phase, ds, auth, err)
  }
}

function mergeRealtime(target, report, dimName, metric = 'activeUsers') {
  const rows = extractRows(report, [metric])
  for (const row of rows) {
    const key = String(row.dimensions?.[dimName] || '').trim()
    if (!key) continue
    target.set(key, (target.get(key) || 0) + (Number(row.metrics?.[metric]) || 0))
  }
}

function mergeRealtimeCountry(target, report) {
  const rows = extractRows(report, ['activeUsers'])
  for (const row of rows) {
    const code = String(row.dimensions?.countryId || '').toUpperCase()
    if (!code) continue
    const prev = target.get(code) || { value: '', activeUsers: 0 }
    prev.activeUsers += Number(row.metrics?.activeUsers) || 0
    if (!prev.value && row.dimensions?.country) prev.value = String(row.dimensions.country)
    target.set(code, prev)
  }
}

/* ---- minutesAgo: 0=当前分钟, 29=最早一分钟；跨 property 按分钟相加 ---- */
export function mergeRealtimeMinutes(target, report) {
  const rows = extractRows(report, ['activeUsers'])
  for (const row of rows) {
    const raw = String(row.dimensions?.minutesAgo ?? '').trim()
    if (!/^\d+$/.test(raw)) continue
    const minute = Number(raw)
    target.set(minute, (target.get(minute) || 0) + (Number(row.metrics?.activeUsers) || 0))
  }
}

/* ---- 固定补齐整个窗口, 由最早分钟排到当前分钟, 前端无需猜缺失点 ---- */
export function realtimeMinuteSeries(map, minutesAgo = 29) {
  const maxMinute = Math.max(0, Math.trunc(Number(minutesAgo) || 0))
  return Array.from({ length: maxMinute + 1 }, (_, index) => {
    const minute = maxMinute - index
    return { minutesAgo: minute, activeUsers: Number(map.get(minute)) || 0 }
  })
}

function topNFromMap(map, field = 'activeUsers') {
  return Array.from(map, ([value, count]) => ({ value, [field]: count }))
    .sort((a, b) => (Number(b[field]) || 0) - (Number(a[field]) || 0))
    .slice(0, REALTIME_TOP_N)
}

function topNCountries(map) {
  return Array.from(map, ([code, value]) => ({
    code,
    value: value.value,
    activeUsers: value.activeUsers,
  }))
    .sort((a, b) => (Number(b.activeUsers) || 0) - (Number(a.activeUsers) || 0))
    .slice(0, REALTIME_TOP_N)
}

async function buildSourceRealtime({
  ds,
  auth,
  accessToken,
  logPrefix,
  onAuthInvalid,
  byCountry,
  byMinute,
  byPage,
  byEvent,
  byDevice,
  byCity,
}) {
  let totals
  try {
    /* minutesAgo report 的 totals 仍是 30 分钟去重活跃人数；rows 同时给柱状图，
       取代旧 dimensions=[] totals 请求，因此新增趋势能力不增加请求数. */
    totals = await runRealtimeReport({
      accessToken,
      propertyId: ds.resource_id,
      dimensions: ['minutesAgo'],
      limit: 30,
    })
    mergeRealtimeMinutes(byMinute, totals)
  } catch (err) {
    await handleRealtimeError(logPrefix, 'totals', ds, auth, err, onAuthInvalid)
    throw new RealtimeUnavailableError('totals_unavailable', err)
  }

  const tasks = [
    {
      phase: 'country',
      run: () => runRealtimeReport({
        accessToken,
        propertyId: ds.resource_id,
        dimensions: ['countryId', 'country'],
        limit: REALTIME_TOP_N,
      }),
      merge: (report) => mergeRealtimeCountry(byCountry, report),
    },
    {
      phase: 'page',
      run: () => runRealtimeReport({
        accessToken,
        propertyId: ds.resource_id,
        dimensions: ['unifiedScreenName'],
        limit: REALTIME_TOP_N,
      }),
      merge: (report) => mergeRealtime(byPage, report, 'unifiedScreenName'),
    },
    {
      phase: 'event',
      run: () => runRealtimeReport({
        accessToken,
        propertyId: ds.resource_id,
        dimensions: ['eventName'],
        limit: REALTIME_TOP_N,
        metric: 'eventCount',
      }),
      merge: (report) => mergeRealtime(byEvent, report, 'eventName', 'eventCount'),
    },
    {
      phase: 'device',
      run: () => runRealtimeReport({
        accessToken,
        propertyId: ds.resource_id,
        dimensions: ['deviceCategory'],
        limit: REALTIME_TOP_N,
      }),
      merge: (report) => mergeRealtime(byDevice, report, 'deviceCategory'),
    },
    {
      phase: 'city',
      run: () => runRealtimeReport({
        accessToken,
        propertyId: ds.resource_id,
        dimensions: ['city'],
        limit: REALTIME_TOP_N,
      }),
      merge: (report) => mergeRealtime(byCity, report, 'city'),
    },
  ]

  await mapLimit(tasks, 3, async (task) => {
    try {
      task.merge(await task.run())
    } catch (err) {
      await handleRealtimeError(logPrefix, task.phase, ds, auth, err, onAuthInvalid)
    }
  })

  return Number(extractTotals(totals, ['activeUsers']).activeUsers) || 0
}

export async function buildProjectRealtime({
  sources,
  accessTokenForSource,
  onAuthInvalid = null,
  logPrefix = '[realtime]',
}) {
  const sourceList = Array.isArray(sources) ? sources : []
  if (!sourceList.length) return emptyRealtime('no_source')

  const activeSources = sourceList.filter(({ auth }) => auth?.status === RecordStatus.ACTIVE)
  if (!activeSources.length) throw new RealtimeUnavailableError('no_active_source')

  const invalidateAuth = typeof onAuthInvalid === 'function' ? onAuthInvalid : async () => {}

  let totalActive = 0
  const byCountry = new Map()
  const byMinute = new Map()
  const byPage = new Map()
  const byEvent = new Map()
  const byDevice = new Map()
  const byCity = new Map()

  for (const { ds, auth } of activeSources) {
    let accessToken
    try {
      accessToken = await accessTokenForSource({ ds, auth })
    } catch (err) {
      await handleRealtimeError(logPrefix, 'token', ds, auth, err, invalidateAuth)
      throw new RealtimeUnavailableError('token_unavailable', err)
    }
    if (!accessToken) {
      logRealtimeError(logPrefix, 'token', ds, auth, new Error('token_unavailable'))
      throw new RealtimeUnavailableError('token_unavailable')
    }

    totalActive += await buildSourceRealtime({
      ds,
      auth,
      accessToken,
      logPrefix,
      onAuthInvalid: invalidateAuth,
      byCountry,
      byMinute,
      byPage,
      byEvent,
      byDevice,
      byCity,
    })
  }

  return {
    realtime_status: 'ok',
    active_users_30min: totalActive,
    by_minute: realtimeMinuteSeries(byMinute),
    by_country: topNCountries(byCountry),
    by_page: topNFromMap(byPage),
    by_event: topNFromMap(byEvent, 'eventCount'),
    by_device: topNFromMap(byDevice),
    by_city: topNFromMap(byCity),
    fetched_at: Math.floor(Date.now() / 1000),
  }
}

function waitUntil(event, promise, logPrefix) {
  const guarded = promise.catch((err) => {
    console.error(`${logPrefix} background refresh error:`, err?.message || err)
  })
  const cfWaitUntil = event?.context?.cloudflare?.context?.waitUntil
  if (typeof cfWaitUntil === 'function') cfWaitUntil(guarded)
}

async function rebuildRealtimeCache(params) {
  const payload = await buildProjectRealtime(params)
  await writeCache(
    params.db,
    params.projectId,
    params.cacheKey,
    payload,
    params.ttlSeconds || REALTIME_CACHE_TTL_SECONDS,
  )
  return payload
}

export async function refreshProjectRealtimeCache(params) {
  try {
    return await rebuildRealtimeCache(params)
  } catch (err) {
    console.error(`${params.logPrefix || '[realtime]'} refresh skipped:`, errorReason(err))
    return null
  }
}

export async function loadCachedProjectRealtime(event, params) {
  const cacheKey = params.cacheKey || realtimeCacheKey(params.projectKey)
  const ttlSeconds = params.ttlSeconds || REALTIME_CACHE_TTL_SECONDS
  const logPrefix = params.logPrefix || '[realtime]'
  const base = { ...params, cacheKey, ttlSeconds, logPrefix }
  const entry = await readCacheEntry(params.db, params.projectId, cacheKey, {
    staleTtlSeconds: params.staleTtlSeconds ?? REALTIME_STALE_TTL_SECONDS,
  })

  if (entry?.state === 'hit') return withCacheMeta(entry.payload, 'hit')
  if (entry?.state === 'stale') {
    const claimed = await claimCacheRefresh(params.db, params.projectId, cacheKey, entry.expiresAt, 30)
    if (claimed) waitUntil(event, refreshProjectRealtimeCache(base), logPrefix)
    return withCacheMeta(entry.payload, 'stale')
  }

  try {
    const payload = await rebuildRealtimeCache(base)
    return withCacheMeta(payload, 'miss')
  } catch (err) {
    const stale = await readCacheEntry(params.db, params.projectId, cacheKey, {
      staleTtlSeconds: params.errorStaleTtlSeconds ?? REALTIME_ERROR_STALE_TTL_SECONDS,
    })
    if (stale) return withCacheMeta(stale.payload, 'error-stale')

    console.error(`${logPrefix} build failed:`, errorReason(err))
    return withCacheMeta(realtimeErrorPayload(errorReason(err)), 'error-empty')
  }
}
