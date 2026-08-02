/* ===================================================================
 * 开源版固定站点配置
 *
 * 产品外观来自固定默认值/Worker vars；管理员、Google OAuth 与可选域名来自
 * D1 单实例配置。Google Client Secret 只存在内部层，绝不进入 SSR payload。
 * =================================================================== */

import { decrypt } from '../utils/crypto'
import {
  getAppSecret,
  getPublicSiteOrigin,
  isInstanceInitialized,
  loadInstanceConfig,
  PRODUCT_LOGO_PATH,
  PRODUCT_OG_IMAGE_PATH,
  SELF_HOSTED_SITE_ID,
  runtimeEnv,
} from '../utils/self-hosted'

const SUPPORTED_LANGS = [
  'en', 'zh-cn', 'zh-tw', 'ja', 'ko', 'es', 'fr', 'de', 'pt-pt', 'ru',
  'ar', 'hi', 'tr', 'vi', 'th', 'id', 'bn', 'fa', 'ur', 'pl', 'nl', 'uk',
  'it', 'cs', 'uz',
]

async function buildConfig(event) {
  const env = runtimeEnv(event)
  const instanceConfig = await loadInstanceConfig(event)
  const siteName = String(env.SITE_NAME || 'GA Lite').trim()
  const siteDescription = String(env.SITE_DESCRIPTION || 'Private analytics for your sites').trim()
  const siteUrl = getPublicSiteOrigin(event)
  const clientId = String(instanceConfig?.google_client_id || '').trim()
  const secretEnc = String(instanceConfig?.google_client_secret_enc || '')
  const clientSecret = secretEnc
    ? await decrypt(secretEnc, getAppSecret(event), 'google-client-secret') || ''
    : ''

  return {
    unchanged: {
      site_name: siteName,
      site_description: siteDescription,
      site_url: siteUrl,
      logo: {
        logo_32: PRODUCT_LOGO_PATH,
        logo_64: PRODUCT_LOGO_PATH,
        logo_128: PRODUCT_LOGO_PATH,
        logo_192: PRODUCT_LOGO_PATH,
        logo_512: PRODUCT_LOGO_PATH,
      },
      theme_colors: {
        primary: '#2563eb',
        primary_text: '#ffffff',
        secondary: '#0f172a',
        secondary_text: '#ffffff',
        accent: '#7c3aed',
        accent_text: '#ffffff',
      },
      default_lang: String(env.DEFAULT_LOCALE || 'en').toLowerCase(),
      supported_langs: SUPPORTED_LANGS,
      setup_required: !isInstanceInitialized(instanceConfig),
      google_oauth_configured: Boolean(clientId && clientSecret),
      google_client_id: clientId,
      google_client_secret: clientSecret,
      og_config: {
        image: new URL(PRODUCT_OG_IMAGE_PATH, siteUrl).href,
      },
    },
    translated: {},
  }
}

function publicConfig(config) {
  const unchanged = { ...config.unchanged }
  delete unchanged.google_client_id
  delete unchanged.google_client_secret
  return { unchanged, translated: config.translated }
}

export default defineEventHandler(async (event) => {
  const host = String(getHeader(event, 'host') || '')
  event.context.normalizedDomain = host.replace(/\./g, '')
  event.context.siteId = SELF_HOSTED_SITE_ID
  event.context.siteConfig = await buildConfig(event)
  event.context.siteConfigPublic = publicConfig(event.context.siteConfig)
})
