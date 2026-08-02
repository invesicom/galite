/* ===================================================================
 * 项目详情 - 含挂载的数据源 (不返回 token)
 *
 * GET /api/projects/[projectKey]
 *
 * 返回:
 *   project          : 项目主体
 *   data_sources[]   : 挂载行 + auth.status / auth.account_email 透传
 *
 * 跨用户隔离: loadOwnedProject 内置 (project_id + union_id + status=1)
 * =================================================================== */

import { and, asc, eq } from 'drizzle-orm'
import { project_data_source, data_source_auth } from '../../../database/schema'
import { loadOwnedProject } from '../../../utils/project-access'
import { RecordStatus } from '../../../utils/constants'

/* ---- 解析 resource_meta JSON, 异常时返回空对象 ---- */
function parseMeta(raw) {
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

/* ---- 挂载行 -> 响应 (auth 字段来自 data_source_auth 联接) ---- */
function shapeMount(ds) {
  return {
    id: ds.id,
    provider: ds.provider,
    auth_id: ds.auth_id,
    auth_email: ds.auth_email || '',
    auth_status: ds.auth_status ?? 0,
    resource_id: ds.resource_id,
    resource_label: ds.resource_label || '',
    resource_meta: parseMeta(ds.resource_meta),
    realtime_dashboard: ds.realtime_dashboard ?? 1,
    created_at: ds.created_at,
  }
}

export default defineEventHandler(async (event) => {
  const projectKey = getRouterParam(event, 'projectKey')
  const db = await useDb(event)
  const { user, project } = await loadOwnedProject(event, db, projectKey)
  const shapedProject = {
    project_key: project.project_key,
    name: project.name,
    description: project.description || '',
    logo_url: project.logo_url || '',
    site_url: project.site_url || '',
    timezone: project.timezone || '',
    priority: project.priority ?? 0,
    created_at: project.created_at,
    updated_at: project.updated_at,
  }

  /* ---- 挂载列表 + auth 字段透传 (left join, auth 删除时仍能展示历史挂载) ---- */
  const mounts = await db.select({
    id: project_data_source.id,
    provider: project_data_source.provider,
    auth_id: project_data_source.auth_id,
    resource_id: project_data_source.resource_id,
    resource_label: project_data_source.resource_label,
    resource_meta: project_data_source.resource_meta,
    realtime_dashboard: project_data_source.realtime_dashboard,
    created_at: project_data_source.created_at,
    auth_email: data_source_auth.account_email,
    auth_status: data_source_auth.status,
  })
    .from(project_data_source)
    .leftJoin(data_source_auth, eq(project_data_source.auth_id, data_source_auth.id))
    .where(and(
      eq(project_data_source.project_id, user.project_id),
      eq(project_data_source.union_id,   user.union_id),
      eq(project_data_source.project_key, project.project_key),
      eq(project_data_source.status,      RecordStatus.ACTIVE),
    ))
    .orderBy(asc(project_data_source.id))

  return reqSuccess({
    project: shapedProject,
    data_sources: mounts.map(shapeMount),
    access: { locked: false },
  })
})
