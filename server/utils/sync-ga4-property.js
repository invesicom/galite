/* ===================================================================
 * syncProjectMetaToGa4 - 站点 name / site_url 改动同步到挂载的 GA4
 *
 *  触发: server/api/projects/[projectKey]/update.post.js 改完本地 DB 后
 *        同步 await 调用 — 等 GA4 结果回来, 把 { status } 回传前端提示.
 *
 *  行为 (每个 GA4 挂载):
 *    ① scope 判定: 含 analytics.edit 或旧版 full analytics → 有编辑权,
 *       否则记 no_scope (不打 GA4 让它返 403)
 *    ② getAccessToken (自动 decrypt + refresh), 失败记 token_invalid
 *    ③ name → PATCH /properties/{id}?updateMask=displayName  (主, 结果上报)
 *    ④ url  → fetchWebStreamInfo + PATCH defaultUri          (次, best-effort)
 *
 *  返回 { status }:
 *    noop          未改 name/url, 没动 GA4
 *    no_ga4        项目没挂 GA4
 *    synced        name 同步成功 (或只改了 url)
 *    no_scope      授权只读, 无编辑权
 *    token_invalid 取 token 失败 / GA4 返 401
 *    rate_limited  GA4 返 429·503
 *    error         其它失败
 *
 *  设计哲学:
 *    1. 本地 DB 是真相源, GA4 是镜像 — 镜像失败不回滚本地, 但要如实上报
 *    2. 全程不抛: 单挂载异常归类成 status code, 多挂载 Promise.all 聚合
 *    3. scope 判定在 caller 侧, 不依赖 GA4 返 403 — 省一次往返
 * =================================================================== */

import { and, eq } from 'drizzle-orm'
import { project_data_source, data_source_auth } from '../database/schema'
import { getAccessToken } from './data-source-token'
import {
  patchPropertyDisplayName,
  patchWebStreamDefaultUri,
  fetchWebStreamInfo,
  SCOPE_GA4_EDIT,
  SCOPE_GA4_FULL,
} from './providers/ga4-oauth'
import { DataSourceProvider, RecordStatus } from './constants'
import { mapLimit } from './map-limit'

/* ---- GA4 异常 → 状态码: 给前端映射友好文案 ---- */
function classifyGa4Error(e) {
  const code = e?.statusCode
  if (code === 401) return 'token_invalid'
  if (code === 403 || e?.message === 'ga4_permission_denied') return 'no_scope'
  if (code === 429 || code === 503) return 'rate_limited'
  return 'error'
}

/* ---- scope 精确判定: 按 token 拆分匹配, 含 .edit 或旧 full analytics 才可改
        (不能用 includes 子串 — 'analytics' 是 'analytics.readonly' 的前缀, 会误判) ---- */
function canEditGa4(auth) {
  const scopes = new Set(String(auth?.scope || '').split(/\s+/).filter(Boolean))
  return scopes.has(SCOPE_GA4_EDIT) || scopes.has(SCOPE_GA4_FULL)
}

/* ---- 单挂载同步: 返回 name 同步结果码 ('ok' | 'no_scope' | 'token_invalid' | 'rate_limited' | 'error')
        url 同步是 best-effort, 失败只 log, 不拉低 name 结果 ---- */
async function syncOneMount(db, ds, auth, changes, jwtSecret, siteConfig, hasName, hasUrl) {
  if (!canEditGa4(auth)) {
    console.warn(`[ga4-sync] skip ${ds.resource_id}: no edit scope (auth_id=${auth.id})`)
    return 'no_scope'
  }

  let accessToken
  try {
    accessToken = await getAccessToken(db, auth, jwtSecret, siteConfig)
  } catch (e) {
    console.warn(`[ga4-sync] getAccessToken failed auth_id=${auth.id}:`, e?.message || e)
    return 'token_invalid'
  }

  const propertyName = ds.resource_id   /* "properties/123456" */
  let nameResult = 'ok'                  /* 未改 name 时默认 ok, 不拖累聚合 */

  if (hasName) {
    try {
      await patchPropertyDisplayName({ accessToken, propertyName, displayName: changes.name })
    } catch (e) {
      console.warn(`[ga4-sync] patchDisplayName failed ${propertyName}:`, e?.message || e)
      nameResult = classifyGa4Error(e)
    }
  }

  if (hasUrl) {
    try {
      const stream = await fetchWebStreamInfo(accessToken, propertyName)
      if (stream.name) {
        await patchWebStreamDefaultUri({ accessToken, streamName: stream.name, defaultUri: changes.site_url })
      } else {
        console.warn(`[ga4-sync] ${propertyName} has no WEB_DATA_STREAM, skip url sync`)
      }
    } catch (e) {
      console.warn(`[ga4-sync] patchDefaultUri failed ${propertyName}:`, e?.message || e)
    }
  }

  return nameResult
}

/* ---- 多挂载聚合 → 单一 status. 失败优先级: 越该提示的越优先 ---- */
function aggregate(results, hasName) {
  if (!hasName) return 'synced'                       /* 只改 url, name 不参与提示 */
  if (results.every((r) => r === 'ok')) return 'synced'
  for (const code of ['token_invalid', 'no_scope', 'rate_limited', 'error']) {
    if (results.includes(code)) return code
  }
  return 'error'
}

/**
 * 同步站点 meta 到所有 GA4 挂载, 返回结构化结果给 caller 回传前端.
 *
 * @returns {Promise<{status: string}>}  见文件头 status 取值
 */
export async function syncProjectMetaToGa4(db, user, projectKey, changes, jwtSecret, siteConfig) {
  const hasName = typeof changes?.name === 'string'
  const hasUrl  = typeof changes?.site_url === 'string'
  if (!hasName && !hasUrl) return { status: 'noop' }

  const rows = await db.select()
    .from(project_data_source)
    .innerJoin(data_source_auth, eq(project_data_source.auth_id, data_source_auth.id))
    .where(and(
      eq(project_data_source.project_id, user.project_id),
      eq(project_data_source.union_id,   user.union_id),
      eq(project_data_source.project_key, projectKey),
      eq(project_data_source.provider,    DataSourceProvider.GA4),
      eq(project_data_source.status,      RecordStatus.ACTIVE),
    ))

  if (!rows.length) return { status: 'no_ga4' }

  const results = await mapLimit(rows, 6, (row) =>
    syncOneMount(db, row.project_data_source, row.data_source_auth, changes, jwtSecret, siteConfig, hasName, hasUrl)
      .catch((e) => {
        console.warn('[ga4-sync] mount unexpected:', e?.message || e)
        return 'error'
      }),
  )

  return { status: aggregate(results, hasName) }
}
