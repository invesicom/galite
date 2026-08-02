/* ===================================================================
 * 执行漏斗 - 调 GA4 v1alpha runFunnelReport
 *
 * GET /api/funnels/{funnelKey}/results?period=7days
 *
 * 流程:
 *   1) loadOwnedFunnel  - 闸门 + 拿 funnel + project
 *   2) 拉项目第一个活跃 GA4 source (漏斗是 session 级语义,
 *      跨 property 合并无意义, 单 property 跑即可)
 *   3) readCache (60s TTL) - 命中直接返
 *   4) getAccessToken -> ga4.runFunnelReport -> extractFunnel
 *   5) writeCache + 返回
 *
 * 错误降级:
 *   - 项目无 GA4 source     -> 200 + funnel_result.steps=[] + error: 'no_data_source'
 *   - auth.status != 1     -> 200 + error: 'auth_invalid'   (UI 提示重连)
 *   - GA4 401              -> markAuthInvalid + 上 error: 'auth_invalid'
 *   - GA4 403              -> 当前 property 权限不足，不污染账号授权
 *   - GA4 503 / 429        -> 0  + msg: 'rate_limited'
 *   - GA4 alpha 不可用     -> 0  + msg: 'funnel_unavailable' (UI 显 State 6)
 * =================================================================== */

import { MetricsPeriod, METRICS_CACHE_TTL_MS, DataSourceProvider, RecordStatus } from '../../../utils/constants'
import { isValidPeriod } from '../../../utils/period'
import { and, eq } from 'drizzle-orm'
import { project_data_source, data_source_auth } from '../../../database/schema'
import { loadOwnedFunnel } from '../../../utils/funnel-access'
import { parseSteps, shapeStep } from '../../../utils/funnel-steps'
import { getAccessToken } from '../../../utils/data-source-token'
import { runFunnelReport, extractFunnel, periodToRange } from '../../../utils/providers/ga4'
import { readCache, writeCache, buildCacheKey } from '../../../utils/metrics-cache'
import { markAuthInvalid, getJwtSecret, getSiteConfig } from '../../../utils/metrics-helpers'
import { parseFiltersFromQuery, buildDimensionFilter, filterCacheKey } from '../../../utils/filters'

/* ---- 项目第一个活跃 GA4 ds + 对应 auth ---- */
async function pickPrimarySource(db, user, projectKey) {
  const ds = await getFirst(
    db.select().from(project_data_source)
      .where(and(
        eq(project_data_source.project_id,  user.project_id),
        eq(project_data_source.union_id,    user.union_id),
        eq(project_data_source.project_key, projectKey),
        eq(project_data_source.provider,    DataSourceProvider.GA4),
        eq(project_data_source.status,      RecordStatus.ACTIVE),
      ))
      .limit(1),
  )
  if (!ds) return { ds: null, auth: null }

  const auth = await getFirst(
    db.select().from(data_source_auth)
      .where(and(
        eq(data_source_auth.id,         ds.auth_id),
        eq(data_source_auth.project_id, user.project_id),
      ))
      .limit(1),
  )
  return { ds, auth }
}

export default defineEventHandler(async (event) => {
  const funnelKey = getRouterParam(event, 'funnelKey')
  const query = getQuery(event)
  const period = String(query.period || MetricsPeriod.LAST_7_DAYS)
  if (!isValidPeriod(period)) return reqFail('invalid_period')

  const db = await useDb(event)
  const { user, project, funnel } = await loadOwnedFunnel(event, db, funnelKey)

  const steps = parseSteps(funnel.steps_config).map(shapeStep)
  if (steps.length < 2) return reqFail('funnel_steps_invalid')

  /* filters → dimensionFilter + cache key (跟 summary/dimension API 同款) */
  const filters = parseFiltersFromQuery(query)
  const dimensionFilter = buildDimensionFilter(filters)

  /* ---- 缓存 key + TTL (filter 进 key, 防"加 filter 仍命中旧 cache") ---- */
  const cacheKey = buildCacheKey(['ga4', 'funnel', funnelKey, period + filterCacheKey(filters)])
  const ttlSec   = Math.floor(METRICS_CACHE_TTL_MS / 1000)
  const force    = String(query.force || '') === '1'

  if (!force) {
    const cached = await readCache(db, project.project_id, cacheKey)
    if (cached) return reqSuccess(cached)
  }

  /* ---- 选数据源 ---- */
  const { ds, auth } = await pickPrimarySource(db, user, project.project_key)
  if (!ds) {
    /* 项目无 GA4 数据源: 不报错, 给前端"没接入"提示 */
    const empty = {
      funnel_key: funnelKey,
      project_key: project.project_key,
      period,
      steps: steps.map((s, i) => ({ index: i, ...s, users: 0, cumulative_conversion: 0, drop_users: 0, drop_rate: 0 })),
      total_users: 0,
      final_users: 0,
      overall_conversion_rate: 0,
      data_source: null,
      error: 'no_data_source',
      fetched_at: Math.floor(Date.now() / 1000),
    }
    /* 此处不入缓存, 用户挂上 ds 后立刻能看到真实结果 */
    return reqSuccess(empty)
  }

  if (!auth || auth.status !== RecordStatus.ACTIVE) {
    return reqSuccess({
      funnel_key: funnelKey,
      project_key: project.project_key,
      period,
      steps: steps.map((s, i) => ({ index: i, ...s, users: 0, cumulative_conversion: 0, drop_users: 0, drop_rate: 0 })),
      total_users: 0,
      final_users: 0,
      overall_conversion_rate: 0,
      data_source: { resource_id: ds.resource_id, resource_label: ds.resource_label || '', auth_status: auth?.status ?? 0 },
      error: 'auth_invalid',
      fetched_at: Math.floor(Date.now() / 1000),
    })
  }

  /* ---- 拿 token + 调 GA4 funnel ---- */
  const jwtSecret = getJwtSecret(event)
  const siteConfig = getSiteConfig(event)

  let accessToken
  try {
    accessToken = await getAccessToken(db, auth, jwtSecret, siteConfig)
  } catch {
    /* getAccessToken 失败时已自行置 status=99 */
    return reqSuccess({
      funnel_key: funnelKey,
      project_key: project.project_key,
      period,
      steps: steps.map((s, i) => ({ index: i, ...s, users: 0, cumulative_conversion: 0, drop_users: 0, drop_rate: 0 })),
      total_users: 0,
      final_users: 0,
      overall_conversion_rate: 0,
      data_source: { resource_id: ds.resource_id, resource_label: ds.resource_label || '', auth_status: 99 },
      error: 'auth_invalid',
      fetched_at: Math.floor(Date.now() / 1000),
    })
  }

  const range = periodToRange(period)
  let report
  try {
    report = await runFunnelReport({
      accessToken,
      propertyId: ds.resource_id,
      startDate: range.startDate,
      endDate:   range.endDate,
      steps,
      dimensionFilter,
    })
  } catch (err) {
    if (err?.statusCode === 401) {
      await markAuthInvalid(db, auth.id)
      return reqSuccess({
        funnel_key: funnelKey,
        project_key: project.project_key,
        period,
        steps: steps.map((s, i) => ({ index: i, ...s, users: 0, cumulative_conversion: 0, drop_users: 0, drop_rate: 0 })),
        total_users: 0,
        final_users: 0,
        overall_conversion_rate: 0,
        data_source: { resource_id: ds.resource_id, resource_label: ds.resource_label || '', auth_status: 99 },
        error: 'auth_invalid',
        fetched_at: Math.floor(Date.now() / 1000),
      })
    }
    if (err?.statusCode === 503) return reqFail('rate_limited')
    /* alpha 接口不可用 -> funnel_unavailable, 前端 State 6 */
    console.error('[funnel/results] runFunnelReport error:', err?.statusCode, err?.message, err?.data || '')
    return reqFail('funnel_unavailable')
  }

  /* ---- 归一为前端形态 ---- */
  const parsed = extractFunnel(report, steps)
  const payload = {
    funnel_key: funnelKey,
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

  await writeCache(db, project.project_id, cacheKey, payload, ttlSec)
  return reqSuccess(payload)
})
