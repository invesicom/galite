/* ===================================================================
 * v1 · 项目详情 (开放 API)
 *
 * GET /api/v1/projects/[projectKey]
 *
 * 复用闸门: loadOwnedProject 内部调 requireAuth(event), 而 requireApiKey
 *   已写入 event.context.user, 与 JWT 路径同形, 透传无差异 — 这就是
 *   保持 API Key、MCP OAuth 与 owner session 的 user 形态一致.
 *
 * 安全:
 *   - access_token / refresh_token 永不暴露 (data_sources 仅含 auth_email + auth_status)
 * =================================================================== */

import { and, asc, eq } from 'drizzle-orm'
import { project_data_source, data_source_auth } from '../../../../database/schema'
import { loadOwnedProject } from '../../../../utils/project-access'
import { RecordStatus } from '../../../../utils/constants'

function parseMeta(raw) {
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

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
  /* ---- sk- 鉴权 + 限流 ---- */
  await guardV1(event)

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
