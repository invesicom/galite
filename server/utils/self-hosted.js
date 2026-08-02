/* ===================================================================
 * 单实例身份与运行时配置
 *
 * 所有 owner / site 作用域只在此处定义。管理员、Google OAuth 与可选域名
 * 来自 D1 固定配置行；Worker 环境只保留应用主密钥等运行时基础配置。
 * =================================================================== */

import { eq } from 'drizzle-orm'
import { instance_config } from '../database/schema'
import { getAmbientEnv, getFirst, useDb } from './db'

export const SELF_HOSTED_SITE_ID = 'self-hosted'
export const SELF_HOSTED_OWNER_ID = 'owner'
export const INSTANCE_CONFIG_ID = 1
export const MIN_ADMIN_PASSWORD_LENGTH = 8
export const PRODUCT_LOGO_PATH = '/images/brand/ga-lite-logo.png'
export const PRODUCT_OG_IMAGE_PATH = '/images/brand/ga-lite-og.jpg'

export function runtimeEnv(event) {
  return event?.context?.cloudflare?.env || getAmbientEnv() || {}
}

export function getAppSecret(event) {
  return String(runtimeEnv(event).APP_SECRET || useRuntimeConfig().appSecret || '')
}

export function getAdminEmail(event) {
  return String(event?.context?.instanceConfig?.admin_email || '').trim().toLowerCase()
}

export async function loadInstanceConfig(event) {
  if (Object.prototype.hasOwnProperty.call(event.context, 'instanceConfig')) {
    return event.context.instanceConfig
  }
  const db = useDb(event)
  const row = await getFirst(
    db.select().from(instance_config).where(eq(instance_config.id, INSTANCE_CONFIG_ID)).limit(1),
  )
  event.context.instanceConfig = row || null
  return event.context.instanceConfig
}

export function setInstanceConfig(event, config) {
  event.context.instanceConfig = config || null
  return event.context.instanceConfig
}

export function isInstanceInitialized(config) {
  return Boolean(config?.admin_email && config?.admin_password_hash)
}

export function normalizeCustomOrigin(value) {
  const configured = String(value || '').trim()
  if (!configured) return ''

  try {
    const url = new URL(configured)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('unsupported protocol')
    const localHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
    if (url.protocol !== 'https:' && !localHosts.has(url.hostname)) throw new Error('https required')
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('origin only')
    }
    return url.origin
  } catch {
    throw createError({ statusCode: 400, message: 'custom_origin_invalid' })
  }
}

export function getPublicSiteOrigin(event) {
  const configured = String(event?.context?.instanceConfig?.custom_origin || '').trim()
  return configured ? normalizeCustomOrigin(configured) : getRequestURL(event).origin
}

export function getGoogleOauthClientUrls(origin) {
  return {
    google_javascript_origins: [origin],
    google_redirect_uris: [
      `${origin}/api/data-sources/callback/ga4`,
      `${origin}/api/data-sources/callback/gsc`,
    ],
  }
}

export function ownerIdentity(event, claims = {}) {
  const email = getAdminEmail(event) || String(claims.email || '').trim().toLowerCase()
  return {
    ...claims,
    email,
    nickname: 'Admin',
    photo_url: '',
    union_code: 'owner',
    union_id: SELF_HOSTED_OWNER_ID,
    project_id: SELF_HOSTED_SITE_ID,
    role: 'owner',
  }
}

export function googleOauthConfig(event) {
  const unchanged = event?.context?.siteConfig?.unchanged || {}
  const client_id = String(unchanged.google_client_id || '').trim()
  const client_secret = String(unchanged.google_client_secret || '').trim()
  if (!client_id || !client_secret) {
    throw createError({ statusCode: 409, message: 'google_oauth_config_missing' })
  }
  return { client_id, client_secret }
}
