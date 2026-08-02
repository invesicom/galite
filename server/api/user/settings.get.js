/* ===================================================================
 * 单实例设置摘要
 * - 不返回密码哈希、Google Client Secret 密文或明文
 * =================================================================== */

import {
  getGoogleOauthClientUrls,
  getPublicSiteOrigin,
} from '../../utils/self-hosted'

export default defineEventHandler((event) => {
  requireAuth(event)
  const config = event.context.instanceConfig || {}
  const effectiveOrigin = getPublicSiteOrigin(event)
  const googleConfigured = Boolean(
    event.context.siteConfig?.unchanged?.google_oauth_configured,
  )

  return reqSuccess({
    admin_email: String(config.admin_email || ''),
    google_client_id: String(config.google_client_id || ''),
    google_client_secret_configured: Boolean(config.google_client_secret_enc),
    google_oauth_configured: googleConfigured,
    custom_origin: String(config.custom_origin || ''),
    effective_origin: effectiveOrigin,
    ...getGoogleOauthClientUrls(effectiveOrigin),
  })
})
