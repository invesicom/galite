/* ===================================================================
 * v1 · 漏斗结果 (开放 API)
 *
 * GET /api/v1/funnels/{funnelKey}/results?period=7days
 *   Authorization: Bearer sk-xxxxxxxxxxxx
 *
 * 与内部 /api/funnels/{funnelKey}/results 字段一字不差
 * 直接 import 内部 handler 的同款 SQL/调用流程 (复用 alpha funnel API)
 * =================================================================== */

import { MetricsPeriod, METRICS_CACHE_TTL_MS, DataSourceProvider, RecordStatus } from '../../../../utils/constants'
import { isValidPeriod } from '../../../../utils/period'
import { and, eq } from 'drizzle-orm'
import { project_data_source, data_source_auth } from '../../../../database/schema'
import { loadOwnedFunnel } from '../../../../utils/funnel-access'
import { parseSteps, shapeStep } from '../../../../utils/funnel-steps'
import { getAccessToken } from '../../../../utils/data-source-token'
import { runFunnelReport, extractFunnel, periodToRange } from '../../../../utils/providers/ga4'
import { readCache, staleCacheOptions, writeCache, buildCacheKey } from '../../../../utils/metrics-cache'
import { markAuthInvalid, getJwtSecret, getSiteConfig } from '../../../../utils/metrics-helpers'

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

/* ---- 0 行模板: 用户没接 / auth 失效时给前端结构稳定占位 ---- */
function buildZeroSteps(steps) {
  return steps.map((s, i) => ({
    index: i, ...s,
    users: 0, cumulative_conversion: 0, drop_users: 0, drop_rate: 0,
  }))
}

export default defineEventHandler(async (event) => {
  await guardV1(event)

  const funnelKey = getRouterParam(event, 'funnelKey')
  const query = getQuery(event)
  const period = String(query.period || MetricsPeriod.LAST_7_DAYS)
  if (!isValidPeriod(period)) return reqFail('invalid_period')

  const db = await useDb(event)
  const { user, project, funnel } = await loadOwnedFunnel(event, db, funnelKey)

  const steps = parseSteps(funnel.steps_config).map(shapeStep)
  if (steps.length < 2) return reqFail('funnel_steps_invalid')

  const cacheKey = buildCacheKey(['ga4', 'funnel', funnelKey, period])
  const ttlSec   = Math.floor(METRICS_CACHE_TTL_MS / 1000)
  const force    = String(query.force || '') === '1'

  if (!force) {
    const cached = await readCache(db, project.project_id, cacheKey, staleCacheOptions(event))
    if (cached) return reqSuccess(cached)
  }

  const { ds, auth } = await pickPrimarySource(db, user, project.project_key)
  const now = Math.floor(Date.now() / 1000)

  if (!ds) {
    return reqSuccess({
      funnel_key: funnelKey, project_key: project.project_key, period,
      steps: buildZeroSteps(steps), total_users: 0, final_users: 0,
      overall_conversion_rate: 0, data_source: null,
      error: 'no_data_source', fetched_at: now,
    })
  }
  if (!auth || auth.status !== RecordStatus.ACTIVE) {
    return reqSuccess({
      funnel_key: funnelKey, project_key: project.project_key, period,
      steps: buildZeroSteps(steps), total_users: 0, final_users: 0,
      overall_conversion_rate: 0,
      data_source: { resource_id: ds.resource_id, resource_label: ds.resource_label || '', auth_status: auth?.status ?? 0 },
      error: 'auth_invalid', fetched_at: now,
    })
  }

  const jwtSecret = getJwtSecret(event)
  const siteConfig = getSiteConfig(event)

  let accessToken
  try { accessToken = await getAccessToken(db, auth, jwtSecret, siteConfig) }
  catch {
    return reqSuccess({
      funnel_key: funnelKey, project_key: project.project_key, period,
      steps: buildZeroSteps(steps), total_users: 0, final_users: 0,
      overall_conversion_rate: 0,
      data_source: { resource_id: ds.resource_id, resource_label: ds.resource_label || '', auth_status: 99 },
      error: 'auth_invalid', fetched_at: now,
    })
  }

  const range = periodToRange(period)
  let report
  try {
    report = await runFunnelReport({
      accessToken, propertyId: ds.resource_id,
      startDate: range.startDate, endDate: range.endDate, steps,
    })
  } catch (err) {
    if (err?.statusCode === 401) {
      await markAuthInvalid(db, auth.id)
      return reqSuccess({
        funnel_key: funnelKey, project_key: project.project_key, period,
        steps: buildZeroSteps(steps), total_users: 0, final_users: 0,
        overall_conversion_rate: 0,
        data_source: { resource_id: ds.resource_id, resource_label: ds.resource_label || '', auth_status: 99 },
        error: 'auth_invalid', fetched_at: now,
      })
    }
    if (err?.statusCode === 503) return reqFail('rate_limited')
    console.error('[v1/funnel/results] runFunnelReport error:', err?.statusCode, err?.message, err?.data || '')
    return reqFail('funnel_unavailable')
  }

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
    fetched_at: now,
  }

  await writeCache(db, project.project_id, cacheKey, payload, ttlSec)
  return reqSuccess(payload)
})
