/* ===================================================================
 * GET /api/public/profile/{slug}/projects/{publicProjectKey}
 * =================================================================== */

import {
  loadPublicProjectByRoute,
  resolvePublicMode,
} from '../../../../../../utils/public/public-access'
import {
  shapePublicProfile,
  shapePublicProjectIdentity,
} from '../../../../../../utils/public/public-dto'
import { hasPublicPasswordAccess } from '../../../../../../utils/public/public-password'
import { loadPublicSourceMeta } from '../../../../../../utils/public/public-sources'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  const publicProjectKey = getRouterParam(event, 'publicProjectKey')
  const db = await useDb(event)
  const siteId = event.context.siteId || ''
  const ctx = await loadPublicProjectByRoute(db, siteId, slug, publicProjectKey, { includeRows: false })
  const [hasAccess, sourceMeta] = await Promise.all([
    hasPublicPasswordAccess(event, ctx.profile, ctx.setting),
    loadPublicSourceMeta(db, ctx.profile),
  ])
  const mode = resolvePublicMode(ctx.profile.visibility_mode, ctx.setting.visibility_mode, hasAccess)

  return reqSuccess({
    profile: shapePublicProfile(ctx.profile, ctx.user),
    summary: { verified_sources: sourceMeta.verifiedSources },
    mode,
    project: shapePublicProjectIdentity({ project: ctx.project, setting: ctx.setting, mode, index: ctx.index }),
  })
})
