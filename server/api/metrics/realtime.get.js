/* ===================================================================
 * GET /api/metrics/realtime  (全站点聚合)
 *
 * 当前用户在所有 GA4 数据源上的实时人数, 按 project 聚合,
 * 给 projects 列表 / realtime 看板用.
 *
 * 注: 不再按 realtime_dashboard 过滤 -> 默认全部站点纳入.
 * (字段保留在 schema 不删, 代码不再读不再写.)
 *
 * 规模: 站点数量无上限. project / auth 各用一次 inArray 批量查 (消除 N+1),
 *       token 按 auth 去重 (一 auth 多 property 只解析一次), GA4 实时请求走
 *       mapLimit 并发池 (上限 6, 对齐 overview) — 分批拉取但全部拉完, 不会
 *       打爆 Worker 出站连接上限.
 *
 * 缓存 key = ga4:user:{union_id}:realtime:{period}
 * TTL    = 15s
 * =================================================================== */

import { and, eq, inArray } from 'drizzle-orm'
import { project_list, project_data_source, data_source_auth } from '../../database/schema'
import { DataSourceProvider, RecordStatus, REALTIME_CACHE_TTL_MS, RealtimePeriod, REALTIME_PERIOD_TO_MINUTES } from '../../utils/constants'
import { selectInBatches, useDb } from '../../utils/db'
import { getAccessToken } from '../../utils/data-source-token'
import { runRealtimeReport, extractTotals, extractRows } from '../../utils/providers/ga4'
import { readCache, writeCache, buildCacheKey } from '../../utils/metrics-cache'
import { getJwtSecret, getSiteConfig } from '../../utils/metrics-helpers'
import { mapLimit } from '../../utils/map-limit'
import { mergeRealtimeMinutes, realtimeMinuteSeries } from '../../utils/realtime-metrics'

/* ---- 并发池上限: 与 overview 对齐 (Worker 出站连接上限是 6) ---- */
const REALTIME_CONCURRENCY = 6

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const db = await useDb(event)
  const jwtSecret = getJwtSecret(event)
  const siteConfig = getSiteConfig(event)

  /* ---- 周期: 30min / 5min / 1min, 默认 30min ---- */
  const query = getQuery(event)
  const period = String(query.period || RealtimePeriod.LAST_30_MIN)
  const minutesAgo = REALTIME_PERIOD_TO_MINUTES[period]
  if (!minutesAgo) return reqFail('invalid_period')

  const cacheKey = buildCacheKey(['ga4', 'user', user.union_id, 'all', 'realtime', period])
  const ttlSec = Math.floor(REALTIME_CACHE_TTL_MS / 1000)

  const cached = await readCache(db, user.project_id, cacheKey)
  if (cached) return reqSuccess(cached)

  const emptyPayload = () => ({
    projects: [],
    total_active_users_30min: 0,
    by_minute: [],
    by_country: [],
    fetched_at: Math.floor(Date.now() / 1000),
  })

  /* ---- 拉所有挂载 (仅 ga4, 默认全部纳入实时) ---- */
  const allDsRows = await db.select({
    project_key: project_data_source.project_key,
    auth_id: project_data_source.auth_id,
    resource_id: project_data_source.resource_id,
  })
    .from(project_data_source)
    .where(and(
      eq(project_data_source.project_id, user.project_id),
      eq(project_data_source.union_id, user.union_id),
      eq(project_data_source.provider, DataSourceProvider.GA4),
      eq(project_data_source.status, RecordStatus.ACTIVE),
    ))

  if (!allDsRows.length) {
    const empty = emptyPayload()
    await writeCache(db, user.project_id, cacheKey, empty, ttlSec)
    return reqSuccess(empty)
  }
  const dsRows = allDsRows

  /* ---- 项目元信息: 一次 inArray 查全部, 保持 dsRows 出现顺序 ---- */
  const projectKeys = Array.from(new Set(allDsRows.map((d) => d.project_key)))
  const projectRows = await selectInBatches(projectKeys, (keys) => db.select().from(project_list)
    .where(and(
      eq(project_list.project_id, user.project_id),
      eq(project_list.union_id, user.union_id),
      inArray(project_list.project_key, keys),
      eq(project_list.status, RecordStatus.ACTIVE),
    )))
  const projectByKey = new Map(projectRows.map((p) => [p.project_key, p]))
  const orderedProjects = projectKeys.map((pk) => projectByKey.get(pk)).filter(Boolean)

  if (!orderedProjects.length) {
    const empty = emptyPayload()
    await writeCache(db, user.project_id, cacheKey, empty, ttlSec)
    return reqSuccess(empty)
  }

  /* ---- 授权与 token 去重: 同 auth 多 property 只查库/解密/刷新一次 ---- */
  const authIds = Array.from(new Set(dsRows.map((d) => d.auth_id).filter(Boolean)))
  const authRows = authIds.length
    ? await selectInBatches(authIds, (ids) => db.select().from(data_source_auth)
      .where(and(
        eq(data_source_auth.project_id, user.project_id),
        eq(data_source_auth.union_id, user.union_id),
        inArray(data_source_auth.id, ids),
        eq(data_source_auth.status, RecordStatus.ACTIVE),
      )))
    : []
  const authById = new Map(authRows.map((a) => [a.id, a]))
  const tokenByAuthId = new Map()
  await mapLimit(authRows, REALTIME_CONCURRENCY, async (auth) => {
    try {
      tokenByAuthId.set(auth.id, await getAccessToken(db, auth, jwtSecret, siteConfig))
    } catch {
      tokenByAuthId.set(auth.id, null) /* getAccessToken 失败时已自行置 status=99, 此 ds 跳过 */
    }
  })

  /* ---- 实时 totals: 全 ds 走并发池 (上限 6), 单失败不阻塞其他 ---- */
  let totalActive = 0
  const projectActive = new Map()  /* project_key -> active users */
  const byCode = new Map()         /* ISO countryId -> { value(全名), activeUsers } — 喂地图 */
  const byMinute = new Map()       /* minutesAgo -> active users — 喂地图左下柱状图 */
  for (const proj of orderedProjects) projectActive.set(proj.project_key, 0)

  await mapLimit(dsRows, REALTIME_CONCURRENCY, async (ds) => {
    const auth = authById.get(ds.auth_id)
    const accessToken = tokenByAuthId.get(ds.auth_id)
    if (!auth || auth.status !== 1 || !accessToken || !projectActive.has(ds.project_key)) return
    try {
      /* 一次 countryId 请求同时拿 property 总活跃(totals) + 分国家明细(rows):
         站点卡与地图共用同一份数据 → 天然同步, 不额外多发请求 */
      const report = await runRealtimeReport({ accessToken, propertyId: ds.resource_id, dimensions: ['countryId', 'country'], minutesAgo })
      const active = extractTotals(report, ['activeUsers']).activeUsers || 0
      totalActive += active
      projectActive.set(ds.project_key, (projectActive.get(ds.project_key) || 0) + active)
      for (const r of extractRows(report, ['activeUsers'])) {
        const code = String(r.dimensions.countryId || '').toUpperCase()
        if (!code) continue
        const prev = byCode.get(code) || { value: '', activeUsers: 0 }
        prev.activeUsers += (r.metrics.activeUsers || 0)
        if (!prev.value && r.dimensions.country) prev.value = String(r.dimensions.country)
        byCode.set(code, prev)
      }
    } catch (err) {
      if (err?.statusCode === 503) return  /* rate_limited: 跳过该 ds, 其它正常 */
      console.error('[metrics/realtime-all] error:', { resource_id: ds.resource_id, message: err?.message || err })
      return
    }

    /* 国家维度不能与 minutesAgo 混查后再相加：activeUsers 是去重指标，
       混合维度会重复计算国家人数。分钟趋势独立一条请求，语义才正确. */
    try {
      const minuteReport = await runRealtimeReport({
        accessToken,
        propertyId: ds.resource_id,
        dimensions: ['minutesAgo'],
        limit: minutesAgo + 1,
        minutesAgo,
      })
      mergeRealtimeMinutes(byMinute, minuteReport)
    } catch (err) {
      if (err?.statusCode !== 503) {
        console.error('[metrics/realtime-all] minute error:', { resource_id: ds.resource_id, message: err?.message || err })
      }
    }
  })

  const payload = {
    projects: orderedProjects.map((p) => {
      return {
        project_key: p.project_key,
        name: p.name,
        site_url: p.site_url || '',
        logo_url: p.logo_url || '',
        active_users_30min: projectActive.get(p.project_key) || 0,
      }
    }),
    total_active_users_30min: totalActive,
    by_minute: realtimeMinuteSeries(byMinute, minutesAgo),
    by_country: Array.from(byCode, ([code, v]) => ({ code, value: v.value, activeUsers: v.activeUsers }))
      .sort((a, b) => b.activeUsers - a.activeUsers)
      .slice(0, 250),
    fetched_at: Math.floor(Date.now() / 1000),
  }
  await writeCache(db, user.project_id, cacheKey, payload, ttlSec)
  return reqSuccess(payload)
})
