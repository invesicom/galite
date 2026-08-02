/* ===================================================================
 * 公开访问闸门
 *
 * 职责:
 *   - slug 规范化与唯一性
 *   - 公共主页 / 公开项目设置的默认创建
 *   - 可见性唯一解析函数
 *
 * 原则:
 *   公开世界只认 public DTO, 不把内部 project row 直接抛出去.
 * =================================================================== */

import { and, asc, desc, eq, ne } from 'drizzle-orm'
import {
  public_profile,
  public_project_setting,
  project_list,
} from '../../database/schema'
import { RecordStatus } from '../constants'
import { getFirst } from '../db'
import { generateUnionCode } from '../ids'

export const PublicProfileMode = {
  PUBLIC: 'public',
  SEMI_PUBLIC: 'semi_public',
  HIDDEN: 'hidden',
}

export const PublicProjectMode = {
  INHERIT: 'inherit',
  HIDDEN: 'hidden',
  PUBLIC: 'public',
  SEMI_PUBLIC: 'semi_public',
  PASSWORD: 'password',
}

export const PublicStatus = {
  ACTIVE: 1,
  DISABLED: 97,
}

const RESERVED_SLUGS = new Set([
  'admin', 'api', 'app', 'dashboard', 'login', 'logout',
  'projects', 'realtime', 'integrations', 'widgets', 'widget', 'public',
  'settings', 'account', 'support', 'help',
])

const PROFILE_MODES = new Set(Object.values(PublicProfileMode))
const PROJECT_MODES = new Set(Object.values(PublicProjectMode))

export const publicProfileColumns = {
  id: public_profile.id,
  project_id: public_profile.project_id,
  union_id: public_profile.union_id,
  slug: public_profile.slug,
  slug_source: public_profile.slug_source,
  display_name: public_profile.display_name,
  avatar_url: public_profile.avatar_url,
  bio: public_profile.bio,
  visibility_mode: public_profile.visibility_mode,
  show_branding: public_profile.show_branding,
  social_links: public_profile.social_links,
  website_url: public_profile.website_url,
  theme_key: public_profile.theme_key,
  status: public_profile.status,
  created_at: public_profile.created_at,
  updated_at: public_profile.updated_at,
}

export async function withPublicProfileBranding(_db, profile) {
  if (!profile) return profile
  return { ...profile, show_branding: Number(profile.show_branding ?? 1) }
}

export function resolvePublicMode(profileMode, projectMode, hasPasswordAccess) {
  if (projectMode === PublicProjectMode.HIDDEN) return PublicProjectMode.HIDDEN
  if (projectMode === PublicProjectMode.PUBLIC) return PublicProjectMode.PUBLIC
  if (projectMode === PublicProjectMode.SEMI_PUBLIC) return PublicProjectMode.SEMI_PUBLIC
  if (projectMode === PublicProjectMode.PASSWORD) {
    return hasPasswordAccess ? PublicProjectMode.PUBLIC : PublicProjectMode.PASSWORD
  }
  if (profileMode === PublicProfileMode.HIDDEN) return PublicProjectMode.HIDDEN
  return profileMode === PublicProfileMode.PUBLIC
    ? PublicProjectMode.PUBLIC
    : PublicProjectMode.SEMI_PUBLIC
}

export function normalizePublicSlug(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[._\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32)
}

export function isReservedPublicSlug(slug) {
  return RESERVED_SLUGS.has(String(slug || '').toLowerCase())
}

export function assertProfileMode(mode) {
  const value = String(mode || PublicProfileMode.SEMI_PUBLIC)
  if (!PROFILE_MODES.has(value)) throw new Error('invalid_visibility_mode')
  return value
}

export function assertProjectMode(mode) {
  const value = String(mode || PublicProjectMode.INHERIT)
  if (!PROJECT_MODES.has(value)) throw new Error('invalid_visibility_mode')
  return value
}

export function defaultPublicSlug(userRow) {
  const emailPrefix = String(userRow?.email || '').split('@')[0]
  const base = normalizePublicSlug(emailPrefix)
  if (base.length >= 3 && !isReservedPublicSlug(base)) return base
  return normalizePublicSlug(`u-${userRow?.union_code || userRow?.union_id || generateUnionCode(6)}`)
}

export async function loadUserProfileRow(_db, user) {
  return {
    ...user,
    nickname: user?.nickname || String(user?.email || '').split('@')[0] || 'Owner',
    photo_url: '',
    union_code: 'owner',
  }
}

export async function generateUniquePublicSlug(db, projectId, base, excludeUnionId = '') {
  const normalized = normalizePublicSlug(base)
  const root = normalized.length >= 3 && !isReservedPublicSlug(normalized)
    ? normalized
    : `u-${generateUnionCode(8)}`

  for (let i = 1; i < 200; i++) {
    const slug = i === 1 ? root : `${root}-${i}`
    const conditions = [
      eq(public_profile.project_id, projectId),
      eq(public_profile.slug, slug),
    ]
    if (excludeUnionId) conditions.push(ne(public_profile.union_id, excludeUnionId))
    const exists = await getFirst(db.select({ id: public_profile.id }).from(public_profile).where(and(...conditions)).limit(1))
    if (!exists && !isReservedPublicSlug(slug)) return slug
  }
  return `u-${generateUnionCode(12)}`
}

export async function ensurePublicProfile(db, user) {
  const userRow = await loadUserProfileRow(db, user)
  const existing = await getFirst(
    db.select(publicProfileColumns).from(public_profile)
      .where(and(
        eq(public_profile.project_id, user.project_id),
        eq(public_profile.union_id, user.union_id),
      ))
      .limit(1),
  )
  if (existing) return { profile: await withPublicProfileBranding(db, existing), userRow }

  const now = Math.floor(Date.now() / 1000)
  const slug = await generateUniquePublicSlug(db, user.project_id, defaultPublicSlug(userRow || user), user.union_id)
  const values = {
    project_id: user.project_id,
    union_id: user.union_id,
    slug,
    slug_source: 'email',
    display_name: '',
    avatar_url: '',
    bio: '',
    visibility_mode: PublicProfileMode.SEMI_PUBLIC,
    social_links: '{}',
    website_url: '',
    theme_key: 'default',
    status: PublicStatus.DISABLED,
    created_at: now,
    updated_at: now,
  }
  values.show_branding = 1
  await db.insert(public_profile).values(values)

  const profile = await getFirst(
    db.select(publicProfileColumns).from(public_profile)
      .where(and(
        eq(public_profile.project_id, user.project_id),
        eq(public_profile.union_id, user.union_id),
      ))
      .limit(1),
  )
  return { profile: await withPublicProfileBranding(db, profile), userRow }
}

export async function generateUniquePublicProjectKey(db, projectId) {
  for (let i = 0; i < 20; i++) {
    const key = `site_${generateUnionCode(8)}`
    const exists = await getFirst(
      db.select({ id: public_project_setting.id })
        .from(public_project_setting)
        .where(and(
          eq(public_project_setting.project_id, projectId),
          eq(public_project_setting.public_project_key, key),
        ))
        .limit(1),
    )
    if (!exists) return key
  }
  return `site_${generateUnionCode(12)}`
}

export async function ensurePublicProjectSetting(db, user, projectKey, index = 0) {
  const existing = await getFirst(
    db.select().from(public_project_setting)
      .where(and(
        eq(public_project_setting.project_id, user.project_id),
        eq(public_project_setting.project_key, projectKey),
      ))
      .limit(1),
  )
  if (existing) return existing

  const now = Math.floor(Date.now() / 1000)
  const key = await generateUniquePublicProjectKey(db, user.project_id)
  await db.insert(public_project_setting).values({
    project_id: user.project_id,
    union_id: user.union_id,
    project_key: projectKey,
    public_project_key: key,
    visibility_mode: PublicProjectMode.INHERIT,
    password_hash: '',
    anonymous_label: `Site #${index + 1}`,
    public_title: '',
    public_description: '',
    priority: 0,
    created_at: now,
    updated_at: now,
  })

  return await getFirst(
    db.select().from(public_project_setting)
      .where(and(
        eq(public_project_setting.project_id, user.project_id),
        eq(public_project_setting.project_key, projectKey),
      ))
      .limit(1),
  )
}

export async function ensurePublicProjectSettingsForUser(db, user) {
  const projects = await db.select()
    .from(project_list)
    .where(and(
      eq(project_list.project_id, user.project_id),
      eq(project_list.union_id, user.union_id),
      eq(project_list.status, RecordStatus.ACTIVE),
    ))
    .orderBy(desc(project_list.priority), desc(project_list.id))

  const existing = await db.select().from(public_project_setting)
    .where(and(
      eq(public_project_setting.project_id, user.project_id),
      eq(public_project_setting.union_id, user.union_id),
    ))
  const existingKeys = new Set(existing.map((row) => row.project_key))
  const publicKeys = new Set(existing.map((row) => row.public_project_key))
  const now = Math.floor(Date.now() / 1000)
  const missing = []

  for (let index = 0; index < projects.length; index++) {
    const projectKey = projects[index].project_key
    if (existingKeys.has(projectKey)) continue
    let publicProjectKey = ''
    for (let attempt = 0; attempt < 20 && !publicProjectKey; attempt++) {
      const candidate = `site_${generateUnionCode(8)}`
      if (!publicKeys.has(candidate)) publicProjectKey = candidate
    }
    if (!publicProjectKey) publicProjectKey = `site_${generateUnionCode(12)}`
    publicKeys.add(publicProjectKey)
    missing.push({
      project_id: user.project_id,
      union_id: user.union_id,
      project_key: projectKey,
      public_project_key: publicProjectKey,
      visibility_mode: PublicProjectMode.INHERIT,
      password_hash: '',
      anonymous_label: `Site #${index + 1}`,
      public_title: '',
      public_description: '',
      priority: 0,
      created_at: now,
      updated_at: now,
    })
  }

  /* 每行 12 个绑定参数，6 行一批给 D1 的 100 参数上限留足余量。 */
  for (let offset = 0; offset < missing.length; offset += 6) {
    await db.insert(public_project_setting)
      .values(missing.slice(offset, offset + 6))
      .onConflictDoNothing()
  }

  const settings = missing.length
    ? await db.select().from(public_project_setting).where(and(
        eq(public_project_setting.project_id, user.project_id),
        eq(public_project_setting.union_id, user.union_id),
      ))
    : existing
  return { projects, settings }
}

export async function loadEnabledPublicProfileBySlug(db, siteId, slug) {
  if (!siteId) throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  const normalized = normalizePublicSlug(slug)
  if (!normalized) throw createError({ statusCode: 404, statusMessage: 'Not Found' })

  const profile = await getFirst(
    db.select(publicProfileColumns)
      .from(public_profile)
      .where(and(
        eq(public_profile.project_id, siteId),
        eq(public_profile.slug, normalized),
        eq(public_profile.status, PublicStatus.ACTIVE),
      ))
      .limit(1),
  )
  if (!profile) throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  return {
    profile: await withPublicProfileBranding(db, profile),
    user: {
      nickname: profile.display_name || 'Owner',
      photo_url: '',
      email: '',
    },
  }
}

export async function listProfilePublicProjects(db, profile) {
  const rows = await db.select({
    project: project_list,
    setting: public_project_setting,
  })
    .from(project_list)
    .leftJoin(public_project_setting, and(
      eq(public_project_setting.project_id, project_list.project_id),
      eq(public_project_setting.project_key, project_list.project_key),
    ))
    .where(and(
      eq(project_list.project_id, profile.project_id),
      eq(project_list.union_id, profile.union_id),
      eq(project_list.status, RecordStatus.ACTIVE),
    ))
    .orderBy(asc(public_project_setting.priority), desc(project_list.priority), desc(project_list.id))

  return rows.filter((r) => r.project)
}

export async function loadPublicProjectByRoute(db, siteId, slug, publicProjectKey, options = {}) {
  const { profile, user } = await loadEnabledPublicProfileBySlug(db, siteId, slug)
  const setting = await getFirst(
    db.select().from(public_project_setting)
      .where(and(
        eq(public_project_setting.project_id, profile.project_id),
        eq(public_project_setting.union_id, profile.union_id),
        eq(public_project_setting.public_project_key, String(publicProjectKey || '')),
      ))
      .limit(1),
  )
  if (!setting) throw createError({ statusCode: 404, statusMessage: 'Not Found' })

  const includeRows = options.includeRows !== false
  const [project, rows] = await Promise.all([
    getFirst(
      db.select().from(project_list)
        .where(and(
          eq(project_list.project_id, profile.project_id),
          eq(project_list.union_id, profile.union_id),
          eq(project_list.project_key, setting.project_key),
          eq(project_list.status, RecordStatus.ACTIVE),
        ))
        .limit(1),
    ),
    includeRows ? listProfilePublicProjects(db, profile) : Promise.resolve([]),
  ])
  if (!project) throw createError({ statusCode: 404, statusMessage: 'Not Found' })

  const index = Math.max(0, rows.findIndex((row) => row.project?.project_key === project.project_key))
  return { profile, user, setting, project, rows, index }
}
