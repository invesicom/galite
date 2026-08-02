/* ===================================================================
 * 公开项目密码解锁
 *
 * 职责:
 *   - password hash 复用 PBKDF2 工具, 不存明文.
 *   - unlock token 用 HMAC JWT, 只声明 public_project_key + union_id.
 *   - cookie TTL 12 小时, widget 永不读取该 cookie.
 * =================================================================== */

import { decodeJwt, signJwt, verifyJwt } from '../jwt'
import { hashPassword, verifyPassword } from '../password'
import { getAppSecret } from '../self-hosted'

export const PUBLIC_UNLOCK_TTL_SECONDS = 12 * 60 * 60

export async function hashPublicPassword(plaintext) {
  return await hashPassword(plaintext)
}

export async function verifyPublicPassword(plaintext, passwordHash) {
  return await verifyPassword(plaintext, passwordHash)
}

async function passwordHashFingerprint(passwordHash) {
  const raw = new TextEncoder().encode(String(passwordHash || ''))
  const digest = await crypto.subtle.digest('SHA-256', raw)
  return Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function unlockCookieName(publicProjectKey) {
  return `si_pub_${String(publicProjectKey || '').replace(/[^a-zA-Z0-9_-]/g, '')}`
}

export async function signPublicUnlockToken(event, profile, setting) {
  const secret = getAppSecret(event)
  if (!secret) throw new Error('missing_app_secret')
  return await signJwt({
    type: 'public_project_unlock',
    slug: profile.slug,
    union_id: profile.union_id,
    public_project_key: setting.public_project_key,
    password_fp: await passwordHashFingerprint(setting.password_hash),
  }, secret, PUBLIC_UNLOCK_TTL_SECONDS, 'public-unlock')
}

export async function hasPublicPasswordAccess(event, profile, setting) {
  if (!setting?.public_project_key || !setting?.password_hash) return false
  const token = getCookie(event, unlockCookieName(setting.public_project_key)) || ''
  if (!token) return false

  const secret = getAppSecret(event)
  if (!secret || !(await verifyJwt(token, secret, 0, 'public-unlock'))) return false
  const payload = decodeJwt(token)?.payload
  return payload?.type === 'public_project_unlock'
    && payload?.slug === profile.slug
    && payload?.union_id === profile.union_id
    && payload?.public_project_key === setting.public_project_key
    && payload?.password_fp === await passwordHashFingerprint(setting.password_hash)
}

export function setPublicUnlockCookie(event, setting, token) {
  setCookie(event, unlockCookieName(setting.public_project_key), token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: getRequestURL(event).protocol === 'https:',
    path: '/',
    maxAge: PUBLIC_UNLOCK_TTL_SECONDS,
  })
}
