/* ===================================================================
 * metrics handler 共享 helper
 *
 * 职责:
 *   - loadProjectAndSources: 鉴权 + 拉项目 + 拉挂载的 GA4 数据源
 *     (同时把 auth row 一起带回, 让 handler 直接用)
 *   - getJwtSecret:         读取 APP_SECRET, 给 token 解密用
 *   - markAuthInvalid:      把 data_source_auth.status 置 99
 *
 * 设计哲学: 把跨 handler 的"项目-数据源-auth"拼装一次到位,
 *          避免每个 metrics 接口各写一遍 join.
 * =================================================================== */

import { and, eq, inArray } from 'drizzle-orm'
import { project_list, project_data_source, data_source_auth } from '../database/schema'
import { DataSourceProvider, RecordStatus } from './constants'
import { getFirst, selectInBatches } from './db'
import { getAppSecret } from './self-hosted'

/* ---- APP_SECRET 是 token 加密 / JWT 的共同密钥 ---- */
export function getJwtSecret(event) {
  return getAppSecret(event)
}

/* ---- siteConfig 读取 (data-source-token 走 google_oauth 配置时要) ---- */
export function getSiteConfig(event) {
  return event.context.siteConfig || {}
}

/* ===================================================================
 *  项目存在性 + 所属校验 + GA4 数据源拉取
 *
 *  返回:
 *    {
 *      project: { project_key, name, logo_url, ... },
 *      sources: [
 *        {
 *          ds: <project_data_source row>,
 *          auth: <data_source_auth row>,
 *        }
 *      ],
 *      jwtSecret: string
 *    }
 *
 *  policy:
 *    - 项目不存在 / 不属于当前 user / 已软删 -> throw 404
 *    - 项目存在但 GA4 数据源为空 -> 返回 sources=[]
 *    - 数据源 auth status != 1 (97/99) -> 仍然带上, 让上层决定显示哪种"重连"提示
 *
 *  仅过滤 provider=ga4 的数据源 (本 doc 仅处理 GA4).
 * =================================================================== */

export async function loadProjectAndSources(event, db, projectKey, { onlyRealtime = false, provider = DataSourceProvider.GA4 } = {}) {
  const user = requireAuth(event)
  const jwtSecret = getJwtSecret(event)
  const siteConfig = getSiteConfig(event)

  /* ---- 项目: 必须属于当前 user, 必须有效 ---- */
  const project = await getFirst(
    db.select().from(project_list)
      .where(and(
        eq(project_list.project_id, user.project_id),
        eq(project_list.union_id, user.union_id),
        eq(project_list.project_key, projectKey),
        eq(project_list.status, RecordStatus.ACTIVE),
      ))
      .limit(1),
  )
  if (!project) throw createError({ statusCode: 404, message: 'project_not_found' })

  /* ---- 数据源 (按 provider 过滤): 一次 join 带上 auth
          provider 默认 ga4 保持向后兼容, 显式传 'gsc' 切换 ---- */
  const baseConds = [
    eq(project_data_source.project_id, user.project_id),
    eq(project_data_source.project_key, projectKey),
    eq(project_data_source.provider, provider),
    eq(project_data_source.status, RecordStatus.ACTIVE),
  ]
  if (onlyRealtime) baseConds.push(eq(project_data_source.realtime_dashboard, 1))

  const dsRows = await db.select().from(project_data_source).where(and(...baseConds))

  /* ---- 批量拉对应 auth (一次性查, 避免 N+1) ---- */
  const authIds = [...new Set(dsRows.map((row) => row.auth_id).filter(Boolean))]
  const authRows = await selectInBatches(authIds, (ids) => db.select().from(data_source_auth)
    .where(and(
      inArray(data_source_auth.id, ids),
      eq(data_source_auth.project_id, user.project_id),
      eq(data_source_auth.union_id, user.union_id),
    )))
  const authById = new Map(authRows.map((auth) => [auth.id, auth]))
  const sources = dsRows
    .map((ds) => ({ ds, auth: authById.get(ds.auth_id) }))
    .filter(({ auth }) => auth)

  return { user, project, sources, jwtSecret, siteConfig }
}

/* ---- token 失效: status=99, 让前端弹"重新授权" ---- */
export async function markAuthInvalid(db, authId) {
  if (!db || !authId) return
  try {
    await db.update(data_source_auth)
      .set({ status: 99, updated_at: Math.floor(Date.now() / 1000) })
      .where(eq(data_source_auth.id, authId))
  } catch (err) {
    console.error('[metrics-helpers] markAuthInvalid error:', err?.message || err)
  }
}

/* ---- ds + auth 转前端可见数据源摘要 (永远不暴露 token) ---- */
export function dataSourceSummary({ ds, auth }) {
  return {
    auth_id: ds.auth_id,
    provider: ds.provider,
    resource_id: ds.resource_id,
    resource_label: ds.resource_label || '',
    status: auth?.status ?? 99,
    account_email: auth?.account_email || '',
  }
}
