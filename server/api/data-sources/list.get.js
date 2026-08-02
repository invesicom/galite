/* ===================================================================
 * 列出当前用户的数据源授权
 *
 *  GET /api/data-sources/list
 *  query: ?provider=ga4 (可选, 不传 = 全部启用 provider)
 *
 *  响应不返回任何 token 字段。
 *  mounted_count = 该授权当前活跃挂载到 project_data_source 的条数.
 * =================================================================== */

import { and, asc, eq, sql } from 'drizzle-orm'
import { data_source_auth, project_data_source } from '../../database/schema'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const db = await useDb(event)

  /* ---- 过滤 provider (可选) ---- */
  const providerFilter = String(getQuery(event)?.provider || '').trim()
  const conds = [
    eq(data_source_auth.project_id, user.project_id),
    eq(data_source_auth.union_id, user.union_id),
  ]
  /* 隐藏软删 (status=97); 99 失效仍要露出, 让前端提示重新授权 */
  conds.push(sql`${data_source_auth.status} <> 97`)
  if (providerFilter) conds.push(eq(data_source_auth.provider, providerFilter))

  const rows = await db.select({
    id: data_source_auth.id,
    provider: data_source_auth.provider,
    account_email: data_source_auth.account_email,
    account_name: data_source_auth.account_name,
    account_avatar: data_source_auth.account_avatar,
    scope: data_source_auth.scope,
    status: data_source_auth.status,
    token_expires_at: data_source_auth.token_expires_at,
    created_at: data_source_auth.created_at,
  })
    .from(data_source_auth)
    .where(and(...conds))
    .orderBy(asc(data_source_auth.id))

  if (rows.length === 0) return reqSuccess([])

  /* ---- 一次聚合查询拿活跃挂载数, 避免 N+1 ---- */
  const authIds = rows.map((r) => r.id)
  const counts = await db.select({
    auth_id: project_data_source.auth_id,
    cnt: sql`count(*)`.as('cnt'),
  })
    .from(project_data_source)
    .where(and(
      eq(project_data_source.project_id, user.project_id),
      eq(project_data_source.union_id, user.union_id),
      eq(project_data_source.status, 1),
      sql`${project_data_source.auth_id} in (${sql.join(authIds, sql`, `)})`,
    ))
    .groupBy(project_data_source.auth_id)

  const countMap = new Map(counts.map((c) => [Number(c.auth_id), Number(c.cnt) || 0]))
  const result = rows.map((r) => ({ ...r, mounted_count: countMap.get(r.id) || 0 }))

  return reqSuccess(result)
})
