/* ===================================================================
 * GET /api/public/profile/{slug}/projects
 *
 * 公开主页项目卡片 DTO. 客户端 lazy 拉取, 不阻塞身份首屏.
 * =================================================================== */

import {
  loadEnabledPublicProfileBySlug,
  listProfilePublicProjects,
  resolvePublicMode,
} from '../../../../utils/public/public-access'
import { shapePublicProjectCard } from '../../../../utils/public/public-dto'
import { loadPublicSourceMeta } from '../../../../utils/public/public-sources'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  const db = await useDb(event)
  const siteId = event.context.siteId || ''
  const { profile } = await loadEnabledPublicProfileBySlug(db, siteId, slug)
  const [rows, sourceMeta] = await Promise.all([
    listProfilePublicProjects(db, profile),
    loadPublicSourceMeta(db, profile),
  ])

  const projects = []
  for (let i = 0; i < rows.length; i++) {
    const { project, setting } = rows[i]
    if (!setting?.public_project_key) continue
    const mode = resolvePublicMode(profile.visibility_mode, setting.visibility_mode, false)
    const card = shapePublicProjectCard({ project, setting, mode, index: i })
    if (!card) continue
    projects.push({
      ...card,
      providers: card.locked ? [] : (sourceMeta.providersByProject.get(project.project_key) || []),
    })
  }

  return reqSuccess({
    projects,
    summary: {
      projects_count: rows.length,
      public_projects_count: projects.length,
      verified_sources: sourceMeta.verifiedSources,
    },
  })
})
