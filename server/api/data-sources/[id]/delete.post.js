/* ===================================================================
 * 删除一个数据源授权 (软删 + 级联)
 *
 *  POST /api/data-sources/{id}/delete
 *
 *  级联策略:
 *    1. data_source_auth.status        = 97
 *    2. project_data_source.status     = 97 (该 auth 下所有挂载)
 *    3. project_list.status            = 97
 *       仅当该项目"撤销该 auth 后已无任何活跃 ds"时才删 ——
 *       多 provider 项目保留, 单挂的自动同步项目随 auth 一起退场
 *    4. 清空该用户 metrics 缓存, 避免旧 0 值留在 60s TTL 内
 *
 *  设计选择:
 *    - Google 授权尽力 revoke；无论上游是否成功，本地密文立即清空
 *    - Bing 无远端 revoke 协议，断开时清空本地 API Key
 *    - 严格按 (project_id, union_id, id) 三元组定位, 防越权
 * =================================================================== */

import { and, eq, inArray } from 'drizzle-orm'
import { data_source_auth, project_data_source, project_list } from '../../../database/schema'
import { RecordStatus } from '../../../utils/constants'
import { decrypt } from '../../../utils/crypto'
import { invalidateUserCache, invalidateProjectCaches } from '../../../utils/metrics-cache'
import { runInBatches, selectInBatches } from '../../../utils/db'
import { providerOf } from '../../../utils/providers'
import { getAppSecret } from '../../../utils/self-hosted'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const id = Number(event.context.params?.id)
  if (!Number.isInteger(id) || id <= 0) return reqFail('id required')

  const db = await useDb(event)
  const now = Math.floor(Date.now() / 1000)

  /* ---- 校验归属 ---- */
  const row = await getFirst(
    db.select().from(data_source_auth).where(and(
      eq(data_source_auth.id, id),
      eq(data_source_auth.project_id, user.project_id),
      eq(data_source_auth.union_id, user.union_id),
    )).limit(1),
  )
  if (!row) return reqFail('not_found')

  /* ---- 撤销凭证先解密到当前请求内存，随后立即清空 D1 ---- */
  let revokeToken = ''
  if (row.scope !== 'api_key') {
    const secret = getAppSecret(event)
    if (secret) {
      revokeToken = await decrypt(row.refresh_token_enc || '', secret)
        || await decrypt(row.access_token_enc || '', secret)
        || ''
    }
  }

  /* ---- 1. 找出该 auth 涉及的活跃挂载 + project_keys ---- */
  const dsRows = await db.select({
    project_key: project_data_source.project_key,
  })
    .from(project_data_source)
    .where(and(
      eq(project_data_source.project_id, user.project_id),
      eq(project_data_source.union_id, user.union_id),
      eq(project_data_source.auth_id, id),
      eq(project_data_source.status, RecordStatus.ACTIVE),
    ))
  const affectedKeys = [...new Set(dsRows.map((r) => r.project_key).filter(Boolean))]

  /* ---- 2. 软删主授权 ---- */
  await db.update(data_source_auth)
    .set({
      access_token_enc: '',
      refresh_token_enc: '',
      token_expires_at: 0,
      status: RecordStatus.DELETED,
      updated_at: now,
    })
    .where(eq(data_source_auth.id, id))

  /* ---- 3. 软删该 auth 下挂载 ---- */
  await db.update(project_data_source)
    .set({ status: 97, updated_at: now })
    .where(and(
      eq(project_data_source.project_id, user.project_id),
      eq(project_data_source.union_id, user.union_id),
      eq(project_data_source.auth_id, id),
    ))

  /* ---- 4. 级联软删项目: 仅孤儿项目 (无任何活跃 ds 剩余) ---- */
  const remainingRows = await selectInBatches(affectedKeys, (keys) => db.select({
    project_key: project_data_source.project_key,
  }).from(project_data_source).where(and(
    eq(project_data_source.project_id, user.project_id),
    eq(project_data_source.union_id, user.union_id),
    inArray(project_data_source.project_key, keys),
    eq(project_data_source.status, RecordStatus.ACTIVE),
  )))
  const remainingKeys = new Set(remainingRows.map((item) => item.project_key))
  const orphanKeys = affectedKeys.filter((key) => !remainingKeys.has(key))
  await runInBatches(orphanKeys, (keys) => db.update(project_list)
    .set({ status: RecordStatus.DELETED, updated_at: now })
    .where(and(
      eq(project_list.project_id, user.project_id),
      eq(project_list.union_id, user.union_id),
      inArray(project_list.project_key, keys),
    )))

  /* ---- 5. 清缓存:
     - 用户级 (ga4:user / gsc:overview:user) → invalidateUserCache 中段 LIKE 覆盖
     - 项目级 (ga4:project / gsc:project: timeseries / dimension)
       受影响项目挨个清, 避免详情页打开还看到旧时序/维度 ---- */
  await invalidateUserCache(db, user.project_id, user.union_id)
  await invalidateProjectCaches(db, user.project_id, affectedKeys)

  /* ---- 外部撤销失败不回滚本地删除，也不记录凭证内容 ---- */
  if (revokeToken) {
    try {
      const provider = providerOf(row.provider)
      if (typeof provider.revoke === 'function') await provider.revoke({ token: revokeToken })
    } catch (err) {
      console.warn('[data-source-delete] provider revoke failed:', err?.message || err)
    }
  }

  return reqSuccess({ deleted_projects: orphanKeys.length }, 'Disconnected')
})
