/* ===================================================================
 * GET /api/public/profile/{slug}
 *
 * 公开主页身份 DTO. SSR 只等身份、SEO、404 和骨架数量.
 * =================================================================== */

import {
  loadEnabledPublicProfileBySlug,
  listProfilePublicProjects,
  resolvePublicMode,
} from '../../../../utils/public/public-access'
import { shapePublicProfile } from '../../../../utils/public/public-dto'
import { loadPublicSourceMeta } from '../../../../utils/public/public-sources'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  const db = await useDb(event)
  const siteId = event.context.siteId || ''
  const { profile, user } = await loadEnabledPublicProfileBySlug(db, siteId, slug)
  const [rows, sourceMeta] = await Promise.all([
    listProfilePublicProjects(db, profile),
    loadPublicSourceMeta(db, profile),
  ])

  let publicProjectsCount = 0
  for (let i = 0; i < rows.length; i++) {
    const { setting } = rows[i]
    if (!setting?.public_project_key) continue
    const mode = resolvePublicMode(profile.visibility_mode, setting.visibility_mode, false)
    if (mode !== 'hidden') publicProjectsCount += 1
  }

  return reqSuccess({
    profile: shapePublicProfile(profile, user),
    summary: {
      projects_count: rows.length,
      public_projects_count: publicProjectsCount,
      verified_sources: sourceMeta.verifiedSources,
    },
  })
})
