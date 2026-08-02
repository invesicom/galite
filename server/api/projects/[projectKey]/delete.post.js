/* ===================================================================
 * 软删项目 - status=97 + 级联挂载 status=97
 *
 * POST /api/projects/[projectKey]/delete
 * Body: { also_delete_ga4?: boolean }   // 勾选时顺带删 GA4 远端 property
 *
 * 范围:
 *   ✅ project_list           本项目软删
 *   ✅ project_data_source    该项目下所有挂载软删
 *   ✅ metrics_cache          用户级缓存清空 (避免删后 60s 仍看到该项目幽灵数据)
 *   ❌ data_source_auth       不动 — OAuth 凭证是用户级, 跨项目复用 (要删走 /integrations 解除授权)
 *   ⚠️ Google GA4 property    仅当 also_delete_ga4=true: 把项目挂的 GA4 property
 *                             在 Google 端软删 (移入回收站, 72h 内可在 GA4 后台恢复).
 *                             尽力而为: 远端删失败不阻塞本地删除, 结果 { deleted, failed } 回前端提示.
 * =================================================================== */

import { and, eq } from 'drizzle-orm'
import { project_list, project_data_source, data_source_auth } from '../../../database/schema'
import { loadOwnedProject } from '../../../utils/project-access'
import { invalidateUserCache } from '../../../utils/metrics-cache'
import { getAccessToken } from '../../../utils/data-source-token'
import { getJwtSecret, getSiteConfig } from '../../../utils/metrics-helpers'
import { deleteProperty } from '../../../utils/providers/ga4-oauth'
import { DataSourceProvider, RecordStatus } from '../../../utils/constants'

export default defineEventHandler(async (event) => {
  const projectKey = getRouterParam(event, 'projectKey')
  const body = await readBody(event).catch(() => ({}))
  const alsoDeleteGa4 = !!body?.also_delete_ga4

  const db = await useDb(event)
  const { user, project } = await loadOwnedProject(event, db, projectKey)

  const now = Math.floor(Date.now() / 1000)

  /* ---- 可选: 先删 GA4 远端 property (勾选时). 尽力而为, 失败只计数不阻塞本地删除 ---- */
  const ga4 = alsoDeleteGa4
    ? await deleteRemoteGa4(event, db, user, project.project_key)
    : null

  /* ---- 主体软删 ---- */
  await db.update(project_list)
    .set({ status: RecordStatus.DELETED, updated_at: now })
    .where(and(
      eq(project_list.id, project.id),
      eq(project_list.project_id, user.project_id),
      eq(project_list.union_id,   user.union_id),
    ))

  /* ---- 级联挂载行 ---- */
  await db.update(project_data_source)
    .set({ status: RecordStatus.DELETED, updated_at: now })
    .where(and(
      eq(project_data_source.project_id, user.project_id),
      eq(project_data_source.union_id,   user.union_id),
      eq(project_data_source.project_key, project.project_key),
    ))

  /* ---- 清用户级 metrics 缓存: 防 60s 内总览/实时仍带"幽灵项目" ---- */
  await invalidateUserCache(db, user.project_id, user.union_id)

  return reqSuccess({ ga4 }, 'deleted')
})

/* ===================================================================
 *  deleteRemoteGa4 - 把项目挂的所有 GA4 property 在 Google 端软删
 *  --
 *  逐个 property: 取 auth → access_token → DELETE /properties/{id}.
 *  单个失败 (token 失效 / 缺 analytics.edit scope / 已删) 仅计 failed + log, 不抛,
 *  保证本地删除照常进行.
 *  @returns { deleted, failed }
 * =================================================================== */
async function deleteRemoteGa4(event, db, user, projectKey) {
  const dsRows = await db.select({
    resource_id: project_data_source.resource_id,
    auth_id:     project_data_source.auth_id,
  })
    .from(project_data_source)
    .where(and(
      eq(project_data_source.project_id, user.project_id),
      eq(project_data_source.union_id,   user.union_id),
      eq(project_data_source.project_key, projectKey),
      eq(project_data_source.provider,   DataSourceProvider.GA4),
      eq(project_data_source.status,     RecordStatus.ACTIVE),
    ))
  if (!dsRows.length) return { deleted: 0, failed: 0 }

  const jwtSecret = getJwtSecret(event)
  const siteConfig = getSiteConfig(event)
  let deleted = 0
  let failed = 0
  for (const ds of dsRows) {
    try {
      const auth = await getFirst(
        db.select().from(data_source_auth).where(and(
          eq(data_source_auth.id,         ds.auth_id),
          eq(data_source_auth.project_id, user.project_id),
          eq(data_source_auth.union_id,   user.union_id),
        )).limit(1),
      )
      const token = auth ? await getAccessToken(db, auth, jwtSecret, siteConfig) : null
      if (!token) { failed++; continue }
      await deleteProperty({ accessToken: token, propertyName: ds.resource_id })
      deleted++
    } catch (e) {
      console.error('[project-delete] ga4 property delete failed:', { resource_id: ds.resource_id, message: e?.message })
      failed++
    }
  }
  return { deleted, failed }
}
