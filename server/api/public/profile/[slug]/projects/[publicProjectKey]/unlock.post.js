/* ===================================================================
 * POST /api/public/profile/{slug}/projects/{publicProjectKey}/unlock
 * =================================================================== */

import {
  PublicProjectMode,
  loadPublicProjectByRoute,
} from '../../../../../../utils/public/public-access'
import {
  setPublicUnlockCookie,
  signPublicUnlockToken,
  verifyPublicPassword,
} from '../../../../../../utils/public/public-password'
import { enforceBucketRateLimit } from '../../../../../../utils/rate-limit'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  const publicProjectKey = getRouterParam(event, 'publicProjectKey')
  const body = await readBody(event)
  const db = await useDb(event)
  const siteId = event.context.siteId || ''
  const ctx = await loadPublicProjectByRoute(db, siteId, slug, publicProjectKey, { includeRows: false })

  if (ctx.setting.visibility_mode !== PublicProjectMode.PASSWORD || !ctx.setting.password_hash) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }

  await enforceBucketRateLimit(event, {
    scope: 'public_unlock',
    subject: publicProjectKey,
    limit: 5,
  })

  const ok = await verifyPublicPassword(String(body?.password || ''), ctx.setting.password_hash)
  if (!ok) return reqFail('invalid_password')

  const token = await signPublicUnlockToken(event, ctx.profile, ctx.setting)
  setPublicUnlockCookie(event, ctx.setting, token)
  return reqSuccess({ unlocked: true }, 'unlocked')
})
