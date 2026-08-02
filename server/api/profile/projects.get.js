/* ===================================================================
 * GET /api/profile/projects
 *
 * 返回当前用户项目及公开展示设置; 顺手补齐缺失 public_project_key.
 * =================================================================== */

import {
  ensurePublicProfile,
  ensurePublicProjectSetting,
  ensurePublicProjectSettingsForUser,
} from '../../utils/public/public-access'
import { loadOwnedProject } from '../../utils/project-access'

function shape(project, setting, slug) {
  return {
    project_key: project.project_key,
    name: project.name,
    site_url: project.site_url || '',
    logo_url: project.logo_url || '',
    public_project_key: setting.public_project_key,
    visibility_mode: setting.visibility_mode,
    anonymous_label: setting.anonymous_label || '',
    public_title: setting.public_title || '',
    public_description: setting.public_description || '',
    priority: setting.priority || 0,
    has_password: !!setting.password_hash,
    public_url: `/@${slug}/${setting.public_project_key}`,
  }
}

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const db = await useDb(event)
  const { profile } = await ensurePublicProfile(db, user)
  const projectKey = String(getQuery(event)?.project_key || '').trim()

  if (projectKey) {
    const { project } = await loadOwnedProject(event, db, projectKey)
    const setting = await ensurePublicProjectSetting(db, user, project.project_key)
    const row = shape(project, setting, profile.slug)
    return reqSuccess({ row, list: [row] })
  }

  const { projects, settings } = await ensurePublicProjectSettingsForUser(db, user)
  const settingMap = new Map(settings.map((s) => [s.project_key, s]))

  return reqSuccess({
    list: projects.map((project) => shape(project, settingMap.get(project.project_key), profile.slug)),
  })
})
