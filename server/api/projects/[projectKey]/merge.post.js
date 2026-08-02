/* ===================================================================
 * POST /api/projects/[projectKey]/merge
 *
 * 把当前项目合并到目标项目 (同 user 范围内). 用户在 ProjectFormModal
 * 改 site_url 撞到已存在的项目时, 通过此端点显式合并.
 *
 * Body: { target_project_key: 'xxx' }
 *
 * 行为 (按顺序):
 *   1. 校验 target_project_key 属于同 user 且为 active 项目
 *   2. 把当前项目的所有 active 挂载 (project_data_source) 迁移到 target
 *      - 同 (provider, resource_id) 已挂在 target 时跳过, 避免唯一约束冲突
 *   3. 把当前项目的所有 active 漏斗 (project_funnel) 迁移到 target
 *   4. 当前项目软删 (status=97)
 *   5. invalidateUserCache 清掉用户级 metrics 缓存
 *   6. fire-and-forget 同步 GA4: 用 syncProjectMetaToGa4 把迁移过去的
 *      properties displayName/defaultUri 更新为 target 项目的 name/site_url
 *      (cloudflare waitUntil 让异步完成)
 *
 * 不可逆: 当前项目软删后不会自动恢复; 数据源全迁移到 target;
 *         合并前应在前端弹明确警告.
 * =================================================================== */

import { and, eq } from 'drizzle-orm'
import { project_list, project_data_source, project_funnel } from '../../../database/schema'
import { loadOwnedProject } from '../../../utils/project-access'
import { RecordStatus } from '../../../utils/constants'
import { invalidateUserCache } from '../../../utils/metrics-cache'
import { syncProjectMetaToGa4 } from '../../../utils/sync-ga4-property'
import { getJwtSecret, getSiteConfig } from '../../../utils/metrics-helpers'
import { getFirst } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const projectKey = getRouterParam(event, 'projectKey')
  const body = await readBody(event)
  const targetKey = String(body?.target_project_key || '').trim()
  if (!targetKey) return reqFail('target_project_key required')
  if (targetKey === projectKey) return reqFail('cannot merge into self')

  const db = await useDb(event)

  /* ---- 当前项目 (loadOwnedProject 校验归属 + active) ---- */
  const { user, project: srcProject } = await loadOwnedProject(event, db, projectKey)

  /* ---- 目标项目: 必须属于同 user 且 active ---- */
  const target = await getFirst(
    db.select().from(project_list)
      .where(and(
        eq(project_list.project_id, user.project_id),
        eq(project_list.union_id,   user.union_id),
        eq(project_list.project_key, targetKey),
        eq(project_list.status,     RecordStatus.ACTIVE),
      ))
      .limit(1),
  )
  if (!target) return reqFail('target_not_found')

  const now = Math.floor(Date.now() / 1000)

  /* ===========================================================
     1) 迁移 project_data_source
     --
     目标项目可能已有同 (provider, resource_id) 挂载 (同站点重复挂):
       存在 → 当前项目这条软删 (避免 unique 约束冲突)
       不存在 → UPDATE project_key=target, 保留挂载关系
     --
     loop 单挂载处理, 数据量小 (一项目通常 ≤ 5 挂载)
     =========================================================== */
  const srcMounts = await db.select().from(project_data_source)
    .where(and(
      eq(project_data_source.project_id, user.project_id),
      eq(project_data_source.union_id,   user.union_id),
      eq(project_data_source.project_key, srcProject.project_key),
      eq(project_data_source.status,     RecordStatus.ACTIVE),
    ))

  let migrated = 0
  let mergedDup = 0  /* 目标已有同 ds, 当前这条软删的数量 */
  for (const ds of srcMounts) {
    const dup = await getFirst(
      db.select({ id: project_data_source.id }).from(project_data_source)
        .where(and(
          eq(project_data_source.project_id,  user.project_id),
          eq(project_data_source.union_id,    user.union_id),
          eq(project_data_source.project_key, targetKey),
          eq(project_data_source.provider,    ds.provider),
          eq(project_data_source.resource_id, ds.resource_id),
          eq(project_data_source.status,      RecordStatus.ACTIVE),
        ))
        .limit(1),
    )
    if (dup) {
      /* 目标已挂同 resource → 当前项目这条软删 (target 那条留着) */
      await db.update(project_data_source)
        .set({ status: RecordStatus.DELETED, updated_at: now })
        .where(eq(project_data_source.id, ds.id))
      mergedDup++
    } else {
      await db.update(project_data_source)
        .set({ project_key: targetKey, updated_at: now })
        .where(eq(project_data_source.id, ds.id))
      migrated++
    }
  }

  /* ===========================================================
     2) 迁移 project_funnel (漏斗配置)
        funnel_key 是项目级唯一即可, 跨项目同 key 几乎不可能 (18 位随机),
        直接 UPDATE project_key 不会触发唯一约束冲突
     =========================================================== */
  await db.update(project_funnel)
    .set({ project_key: targetKey, updated_at: now })
    .where(and(
      eq(project_funnel.project_id,  user.project_id),
      eq(project_funnel.union_id,    user.union_id),
      eq(project_funnel.project_key, srcProject.project_key),
      eq(project_funnel.status,      RecordStatus.ACTIVE),
    ))

  /* ===========================================================
     3) 当前项目软删
     =========================================================== */
  await db.update(project_list)
    .set({ status: RecordStatus.DELETED, updated_at: now })
    .where(and(
      eq(project_list.id, srcProject.id),
      eq(project_list.project_id, user.project_id),
      eq(project_list.union_id,   user.union_id),
    ))

  /* ===========================================================
     4) 清用户级 metrics 缓存
     =========================================================== */
  await invalidateUserCache(db, user.project_id, user.union_id)

  /* ===========================================================
     5) 同步 GA4: 把迁移过去的 property displayName/defaultUri 改成
        target 项目的 name/site_url (统一站点身份)
        cloudflare waitUntil 让 fire-and-forget 异步完成不被砍
     =========================================================== */
  if (migrated > 0) {
    const jwtSecret = getJwtSecret(event)
    const siteConfig = getSiteConfig(event)
    const syncPromise = syncProjectMetaToGa4(
      db,
      { project_id: user.project_id, union_id: user.union_id },
      targetKey,
      { name: target.name, site_url: target.site_url },
      jwtSecret,
      siteConfig,
    ).catch((e) => console.warn('[merge ga4-sync] unexpected error:', e?.message || e))

    const cfWaitUntil = event.context?.cloudflare?.context?.waitUntil
    if (typeof cfWaitUntil === 'function') {
      cfWaitUntil(syncPromise)
    } else {
      await syncPromise
    }
  }

  return reqSuccess({
    target_project_key: targetKey,
    migrated,        /* 迁移到 target 的挂载数 */
    merged_duplicate: mergedDup,  /* 目标已有同 ds 而软删的当前项目挂载数 */
  }, 'merged')
})
