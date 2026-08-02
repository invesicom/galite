/* ===================================================================
 * GET /api/profile/settings
 *
 * 返回当前用户公共主页配置; 不存在则创建默认 slug + disabled profile.
 * =================================================================== */

import {
  ensurePublicProfile,
} from '../../utils/public/public-access'
import { shapePublicProfile } from '../../utils/public/public-dto'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const db = await useDb(event)
  const { profile, userRow } = await ensurePublicProfile(db, user)

  return reqSuccess({
    profile: {
      ...shapePublicProfile(profile, userRow),
      slug_source: profile.slug_source,
      status: profile.status,
      theme_key: profile.theme_key || 'default',
    },
    public_url: `/@${profile.slug}`,
  })
})
