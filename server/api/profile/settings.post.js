/* ===================================================================
 * POST /api/profile/settings
 *
 * 后端强校验:
 *   - social_links 只收白名单平台 URL.
 *   - 启用主页时确保所有现有项目都有 public_project_key.
 * =================================================================== */

import { and, eq, ne } from 'drizzle-orm'
import { public_profile } from '../../database/schema'
import {
  PublicStatus,
  assertProfileMode,
  ensurePublicProfile,
  ensurePublicProjectSettingsForUser,
  isReservedPublicSlug,
  normalizePublicSlug,
} from '../../utils/public/public-access'
import { shapePublicProfile } from '../../utils/public/public-dto'
import { getFirst } from '../../utils/db'

const SOCIAL_HOSTS = {
  x: ['x.com', 'twitter.com'],
  threads: ['threads.net'],
  instagram: ['instagram.com'],
  facebook: ['facebook.com', 'fb.com'],
  youtube: ['youtube.com', 'youtu.be'],
  tiktok: ['tiktok.com', 'douyin.com'],
  xiaohongshu: ['xiaohongshu.com', 'xhslink.com'],
  bilibili: ['bilibili.com', 'b23.tv'],
}

function safeUrl(raw, { optional = true } = {}) {
  const value = String(raw || '').trim()
  if (!value) return optional ? '' : null
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    return url.toString()
  } catch {
    return null
  }
}

function cleanSocialLinks(input) {
  const out = {}
  const raw = input && typeof input === 'object' ? input : {}
  for (const [key, hosts] of Object.entries(SOCIAL_HOSTS)) {
    const value = safeUrl(raw[key])
    if (!value) continue
    const host = new URL(value).hostname.replace(/^www\./, '').toLowerCase()
    if (!hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
      throw new Error(`invalid_${key}_url`)
    }
    out[key] = value
  }
  return out
}

async function assertSlugAvailable(db, projectId, unionId, slug) {
  const exists = await getFirst(
    db.select({ id: public_profile.id })
      .from(public_profile)
      .where(and(
        eq(public_profile.project_id, projectId),
        eq(public_profile.slug, slug),
        ne(public_profile.union_id, unionId),
      ))
      .limit(1),
  )
  if (exists) throw new Error('slug_taken')
}

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const body = await readBody(event)
  const db = await useDb(event)
  const { profile, userRow } = await ensurePublicProfile(db, user)

  let slug = profile.slug
  const requestedSlug = body?.slug !== undefined ? normalizePublicSlug(body.slug) : slug
  if (body?.slug !== undefined && requestedSlug !== slug) {
    if (requestedSlug.length < 3) return reqFail('invalid_slug')
    if (isReservedPublicSlug(requestedSlug)) return reqFail('reserved_slug')
    await assertSlugAvailable(db, user.project_id, user.union_id, requestedSlug)
    slug = requestedSlug
  }

  let websiteUrl = profile.website_url || ''
  if (body?.website_url !== undefined) {
    websiteUrl = safeUrl(body.website_url)
    if (websiteUrl === null) return reqFail('invalid_website_url')
  }

  let visibilityMode
  try {
    visibilityMode = assertProfileMode(body?.visibility_mode || profile.visibility_mode)
  } catch (err) {
    return reqFail(err.message)
  }

  let socialLinks
  try {
    socialLinks = cleanSocialLinks(body?.social_links || {})
  } catch (err) {
    return reqFail(err.message)
  }

  const showBranding = body?.show_branding !== undefined
    ? Boolean(body.show_branding)
    : Number(profile.show_branding ?? 1) !== 0

  const enabled = body?.enabled !== undefined
    ? Boolean(body.enabled)
    : Number(body?.status || profile.status) === PublicStatus.ACTIVE
  const now = Math.floor(Date.now() / 1000)
  const patch = {
    slug,
    slug_source: slug === profile.slug ? profile.slug_source : 'custom',
    display_name: String(body?.display_name ?? profile.display_name ?? '').trim().slice(0, 255),
    avatar_url: '',
    bio: String(body?.bio ?? profile.bio ?? '').trim().slice(0, 2000),
    visibility_mode: visibilityMode,
    social_links: JSON.stringify(socialLinks),
    website_url: websiteUrl || '',
    theme_key: 'default',
    status: enabled ? PublicStatus.ACTIVE : PublicStatus.DISABLED,
    updated_at: now,
  }
  patch.show_branding = showBranding ? 1 : 0

  await db.update(public_profile).set(patch)
    .where(and(
      eq(public_profile.project_id, user.project_id),
      eq(public_profile.union_id, user.union_id),
    ))

  if (enabled) await ensurePublicProjectSettingsForUser(db, user)

  const next = { ...profile, ...patch }
  return reqSuccess({
    profile: {
      ...shapePublicProfile(next, userRow),
      slug_source: next.slug_source,
      status: next.status,
      theme_key: next.theme_key,
    },
    public_url: `/@${next.slug}`,
  }, 'saved')
})
