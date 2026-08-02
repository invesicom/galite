/* ===================================================================
 * GET /api/metrics/overview/gsc?period=7days  (全站点 GSC 摘要)
 *
 * 跟 GA4 overview 同款形态, 每项目返:
 *   metrics              : { clicks, impressions, ctr, position }
 *   sparkline_clicks     : number[]  时序点 (granularity 按 period)
 *   sparkline_impressions: number[]  时序点 (granularity 按 period)
 *
 * 跨项目 totals + 两条 sparkline 同样按 site 累加 (clicks/impressions 加,
 * ctr/position 按 impressions 加权 — 与 gsc provider aggregateMetrics 同).
 *
 * 仅返"有 GSC 数据源"的项目, 没挂 GSC 的项目不出现在响应里
 * (前端 hasGscProjects = projects.length > 0).
 *
 * 缓存:
 *   key = gsc:overview:user:{union_id}:{period}
 *   TTL = 60s
 *
 * 错误降级与 GA4 overview 同口径:
 *   - token 401 → markAuthInvalid + 跳过单 site
 *   - 429/503  → log + 跳过, 不让全 overview 失败
 * =================================================================== */

import { and, eq, inArray } from 'drizzle-orm'
import { project_list, project_data_source, data_source_auth } from '../../../database/schema'
import { DataSourceProvider, MetricsPeriod, RecordStatus, METRICS_CACHE_TTL_MS } from '../../../utils/constants'
import { isValidPeriod } from '../../../utils/period'
import { useDb, selectInBatches } from '../../../utils/db'
import { getAccessToken } from '../../../utils/data-source-token'
import { runReport, periodToRange, extractTotals, aggregateMetrics } from '../../../utils/providers/gsc'
import { readCache, writeCache, buildCacheKey } from '../../../utils/metrics-cache'
import { getJwtSecret, getSiteConfig, markAuthInvalid } from '../../../utils/metrics-helpers'
import { mapLimit } from '../../../utils/map-limit'
import { addTimelinePoint, collectTimelineLabels, mergeTimeline, timelineValues } from '../../../utils/sparkline'

/* ---- GSC sparkline 配置 (与 GA4 overview 同款 granularity 适配)
        dateHour / date / yearMonth + bucketDays = 7 让 90d/6m 按周聚合 ---- */
const SPARKLINE_SPEC = {
  today:     { dim: 'dateHour',  bucketDays: 0 },
  yesterday: { dim: 'dateHour',  bucketDays: 0 },
  '7days':   { dim: 'date',      bucketDays: 0 },
  '28days':  { dim: 'date',      bucketDays: 0 },
  '90days':  { dim: 'date',      bucketDays: 7 },
  '6months': { dim: 'date',      bucketDays: 7 },
  '1year':   { dim: 'yearMonth', bucketDays: 0 },
}
function specOf(period) { return SPARKLINE_SPEC[period] || SPARKLINE_SPEC['7days'] }

/* ---- GSC 维度字符串归一化:
        date      → "2024-01-15"
        dateHour  → "2024-01-15 14"
        yearMonth → "2024-01"
        排序按字典序即可 (年份在前, 时间分量月日时跟随) ---- */
function extractDimKey(row, dim) {
  const keys = Array.isArray(row?.keys) ? row.keys : []
  return String(keys[0] || '')
}

/* ---- 从 GSC report 抽保留日期身份的双指标时间轴 ---- */
function extractSparklineTimeline(report, spec) {
  const timeline = new Map()
  for (const row of (Array.isArray(report?.rows) ? report.rows : [])) {
    addTimelinePoint(timeline, extractDimKey(row, spec.dim), {
      clicks: row.clicks,
      impressions: row.impressions,
    })
  }
  return timeline
}

const OUTPUT_FIELDS = ['clicks', 'impressions', 'ctr', 'position']
function pickOutput(merged) {
  const out = {}
  for (const k of OUTPUT_FIELDS) out[k] = merged?.[k] || 0
  return out
}

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const query = getQuery(event)
  const period = String(query.period || MetricsPeriod.LAST_7_DAYS)
  if (!isValidPeriod(period)) return reqFail('invalid_period')

  const db = await useDb(event)
  const jwtSecret = getJwtSecret(event)
  const siteConfig = getSiteConfig(event)

  const cacheKey = buildCacheKey(['gsc', 'overview', 'user', user.union_id, 'all', period])
  const ttlSec = Math.floor(METRICS_CACHE_TTL_MS / 1000)

  const cached = await readCache(db, user.project_id, cacheKey)
  if (cached) return reqSuccess(cached)

  /* ---- 拉所有 GSC 挂载的项目 (按 project_data_source.provider=gsc 反查) ---- */
  const allDsRows = await db.select().from(project_data_source)
    .where(and(
      eq(project_data_source.project_id, user.project_id),
      eq(project_data_source.union_id, user.union_id),
      eq(project_data_source.provider, DataSourceProvider.GSC),
      eq(project_data_source.status, RecordStatus.ACTIVE),
    ))
  const dsRows = allDsRows

  if (!dsRows.length) {
    const empty = {
      period, projects: [], totals: pickOutput({}),
      sparkline_clicks: [], sparkline_impressions: [],
    }
    await writeCache(db, user.project_id, cacheKey, empty, ttlSec)
    return reqSuccess(empty)
  }

  /* ---- 拉对应项目元信息 (一次性) ---- */
  const projectKeys = Array.from(new Set(dsRows.map((d) => d.project_key)))
  const projects = await selectInBatches(projectKeys, (keys) =>
    db.select().from(project_list)
        .where(and(
          eq(project_list.project_id, user.project_id),
          eq(project_list.union_id, user.union_id),
          inArray(project_list.project_key, keys),
          eq(project_list.status, RecordStatus.ACTIVE),
        )))
  const projectByKey = new Map(projects.map((project) => [project.project_key, project]))
  const projectRows = projectKeys.map((key) => projectByKey.get(key)).filter(Boolean)

  const authIds = [...new Set(dsRows.map((row) => row.auth_id).filter(Boolean))]
  const authRows = await selectInBatches(authIds, (ids) =>
    db.select().from(data_source_auth).where(and(
      eq(data_source_auth.project_id, user.project_id),
      eq(data_source_auth.union_id, user.union_id),
      inArray(data_source_auth.id, ids),
      eq(data_source_auth.status, RecordStatus.ACTIVE),
    )))
  const authById = new Map(authRows.map((auth) => [auth.id, auth]))
  const tokenByAuthId = new Map()
  await mapLimit(authRows, 6, async (auth) => {
    try {
      tokenByAuthId.set(auth.id, await getAccessToken(db, auth, jwtSecret, siteConfig))
    } catch {
      tokenByAuthId.set(auth.id, null)
    }
  })

  const spec = specOf(period)
  const range = periodToRange(period)

  /* ---- 并发: 每个 ds 拉 totals + 双线 sparkline (同一次 runReport) ---- */
  const totalsByProject     = new Map() /* project_key → [totals, ...] */
  const timelineByProject   = new Map() /* project_key → Map<time_key, metrics> */
  for (const p of projectRows) {
    totalsByProject.set(p.project_key, [])
    timelineByProject.set(p.project_key, new Map())
  }

  await mapLimit(dsRows, 6, async (ds) => {
    const auth = authById.get(ds.auth_id)
    const accessToken = tokenByAuthId.get(ds.auth_id)
    const r = await fetchOneSite(db, ds, auth, accessToken, range, spec)
      if (!r || !totalsByProject.has(ds.project_key)) return
      totalsByProject.get(ds.project_key).push(r.totals)
      mergeTimeline(timelineByProject.get(ds.project_key), r.timeline)
  })

  const sparklineLabels = collectTimelineLabels(timelineByProject.values())

  /* ---- 按项目聚合 ---- */
  const out = projectRows.map((p) => {
    const timeline = timelineByProject.get(p.project_key)
    return {
      project_key: p.project_key,
      name:        p.name,
      logo_url:    p.logo_url || '',
      site_url:    p.site_url || '',
      metrics:     pickOutput(aggregateMetrics(totalsByProject.get(p.project_key) || [])),
      sparkline_clicks: timelineValues(timeline, sparklineLabels, 'clicks', spec.bucketDays),
      sparkline_impressions: timelineValues(timeline, sparklineLabels, 'impressions', spec.bucketDays),
    }
  })

  /* ---- 跨项目 totals + 双线 sparkline 累加 ---- */
  const allTotals = []
  for (const arr of totalsByProject.values()) allTotals.push(...arr)
  const totals = pickOutput(aggregateMetrics(allTotals))

  const totalTimeline = new Map()
  for (const timeline of timelineByProject.values()) mergeTimeline(totalTimeline, timeline)

  const payload = {
    period, projects: out, totals,
    sparkline_clicks: timelineValues(totalTimeline, sparklineLabels, 'clicks', spec.bucketDays),
    sparkline_impressions: timelineValues(totalTimeline, sparklineLabels, 'impressions', spec.bucketDays),
  }
  await writeCache(db, user.project_id, cacheKey, payload, ttlSec)
  return reqSuccess(payload)
})

/* ===================================================================
 *  单 site 拉 totals + 双线 sparkline (同一次 runReport)
 * =================================================================== */
async function fetchOneSite(db, ds, auth, accessToken, range, spec) {
  if (!auth || !accessToken) return null
  try {
    const report = await runReport({
      accessToken,
      siteUrl:    ds.resource_id,
      startDate:  range.startDate,
      endDate:    range.endDate,
      dimensions: [spec.dim],
      rowLimit:   25000, /* GSC 单 site 1 年 dateHour 上限 ~365*24 = 8760, 留余量 */
    })
    return {
      totals: extractTotals(report),
      timeline: extractSparklineTimeline(report, spec),
    }
  } catch (err) {
    if (err?.statusCode === 401) {
      await markAuthInvalid(db, auth.id)
      console.error('[metrics/overview-gsc] auth invalidated:', { auth_id: auth.id, site_url: ds.resource_id })
    } else if (err?.statusCode === 503) {
      console.warn('[metrics/overview-gsc] rate_limited (skipped):', { site_url: ds.resource_id })
    } else {
      console.error('[metrics/overview-gsc] runReport error:', { message: err?.message, site_url: ds.resource_id })
    }
    return null
  }
}
