/* ===================================================================
 * POST /api/profile/projects/{projectKey}/public-settings
 *
 * 项目公开展示配置独立保存在 public_project_setting 中。
 * =================================================================== */

import { and, eq } from 'drizzle-orm'
import { public_project_setting } from '../../../../database/schema'
import {
  PublicProjectMode,
  assertProjectMode,
  ensurePublicProjectSetting,
} from '../../../../utils/public/public-access'
import { hashPublicPassword } from '../../../../utils/public/public-password'
import { loadOwnedProject } from '../../../../utils/project-access'

function sliceText(value, max) {
  return String(value ?? '').trim().slice(0, max)
}

export default defineEventHandler(async (event) => {
  const projectKey = getRouterParam(event, 'projectKey')
  const body = await readBody(event)
  const db = await useDb(event)
  const { user, project } = await loadOwnedProject(event, db, projectKey)
  const setting = await ensurePublicProjectSetting(db, user, project.project_key)

  let visibilityMode
  try {
    visibilityMode = assertProjectMode(body?.visibility_mode || setting.visibility_mode)
  } catch (err) {
    return reqFail(err.message)
  }

  let passwordHash = setting.password_hash || ''
  if (visibilityMode === PublicProjectMode.PASSWORD) {
    const password = String(body?.password || '').trim()
    if (password) {
      try {
        passwordHash = await hashPublicPassword(password)
      } catch {
        return reqFail('weak_password')
      }
    }
    if (!passwordHash) return reqFail('password_required')
  }

  const now = Math.floor(Date.now() / 1000)
  const patch = {
    visibility_mode: visibilityMode,
    password_hash: passwordHash,
    anonymous_label: sliceText(body?.anonymous_label ?? setting.anonymous_label, 100),
    public_title: sliceText(body?.public_title ?? setting.public_title, 255),
    public_description: sliceText(body?.public_description ?? setting.public_description, 2000),
    priority: Number.isFinite(Number(body?.priority)) ? Number(body.priority) : (setting.priority || 0),
    updated_at: now,
  }

  await db.update(public_project_setting).set(patch)
    .where(and(
      eq(public_project_setting.project_id, user.project_id),
      eq(public_project_setting.project_key, project.project_key),
    ))

  return reqSuccess({
    project_key: project.project_key,
    public_project_key: setting.public_project_key,
    visibility_mode: patch.visibility_mode,
    anonymous_label: patch.anonymous_label,
    public_title: patch.public_title,
    public_description: patch.public_description,
    priority: patch.priority,
    updated_at: patch.updated_at,
    has_password: !!passwordHash,
  }, 'saved')
})
