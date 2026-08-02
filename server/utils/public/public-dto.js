/* ===================================================================
 * 公开 DTO 白名单
 *
 * 原则:
 *   semi_public 只声明允许字段, 不做敏感字段黑名单删除.
 *   新字段只有被显式加入白名单才会出现在公开出口.
 * =================================================================== */

import { PublicProjectMode } from './public-access'

const SOCIAL_KEYS = ['x', 'threads', 'instagram', 'facebook', 'youtube', 'tiktok', 'xiaohongshu', 'bilibili']

export function parsePublicJson(raw, fallback = {}) {
  if (!raw) return fallback
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw
    return value && typeof value === 'object' ? value : fallback
  } catch {
    return fallback
  }
}

export function defaultDisplayName(userRow) {
  const nickname = String(userRow?.nickname || '').trim()
  if (nickname) return nickname
  const emailPrefix = String(userRow?.email || '').split('@')[0].trim()
  return emailPrefix || 'Builder'
}

export function shapePublicProfile(profile, userRow) {
  const socialLinks = parsePublicJson(profile.social_links, {})
  const cleanSocial = {}
  for (const key of SOCIAL_KEYS) {
    if (socialLinks[key]) cleanSocial[key] = String(socialLinks[key])
  }

  return {
    slug: profile.slug,
    display_name: profile.display_name || defaultDisplayName(userRow),
    avatar_url: '',
    bio: profile.bio || '',
    visibility_mode: profile.visibility_mode,
    show_branding: Number(profile.show_branding ?? 1) !== 0,
    social_links: cleanSocial,
    website_url: profile.website_url || '',
  }
}

export function shapePublicProjectCard({ project, setting, mode, index }) {
  if (mode === PublicProjectMode.HIDDEN) return null
  const fallbackLabel = setting?.anonymous_label || `Site #${index + 1}`
  if (mode === PublicProjectMode.SEMI_PUBLIC) {
    return {
      public_project_key: setting.public_project_key,
      mode,
      display_name: fallbackLabel,
      locked: false,
    }
  }
  if (mode === PublicProjectMode.PASSWORD) {
    return {
      public_project_key: setting.public_project_key,
      mode,
      display_name: fallbackLabel,
      locked: true,
    }
  }
  return {
    public_project_key: setting.public_project_key,
    mode,
    display_name: setting?.public_title || project.name || 'Untitled site',
    site_url: project.site_url || '',
    logo_url: project.logo_url || '',
    description: setting?.public_description || project.description || '',
    locked: false,
  }
}

export function shapePublicProjectIdentity({ project, setting, mode, index }) {
  const fallbackLabel = setting?.anonymous_label || `Site #${index + 1}`
  const base = {
    public_project_key: setting.public_project_key,
    mode,
  }
  if (mode === PublicProjectMode.HIDDEN) {
    return {
      ...base,
      hidden: true,
      display_name: fallbackLabel,
    }
  }
  if (mode === PublicProjectMode.SEMI_PUBLIC) {
    return { ...base, display_name: fallbackLabel }
  }
  if (mode === PublicProjectMode.PASSWORD) {
    return {
      ...base,
      display_name: fallbackLabel,
      locked: true,
    }
  }
  return {
    ...base,
    display_name: setting?.public_title || project.name || 'Untitled site',
    site_url: project.site_url || '',
    logo_url: project.logo_url || '',
    description: setting?.public_description || project.description || '',
  }
}

export function shapePublicProjectSwitcherItem({ project, setting, mode, index }) {
  const identity = shapePublicProjectIdentity({ project, setting, mode, index })
  return {
    public_project_key: setting.public_project_key,
    mode,
    display_name: identity.display_name,
    site_url: identity.site_url || '',
    logo_url: identity.logo_url || '',
    locked: Boolean(identity.locked),
    hidden: Boolean(identity.hidden),
    anonymous: mode !== PublicProjectMode.PUBLIC,
  }
}

export function shapeSemiPublicTraffic(payload) {
  return {
    summary: payload?.summary || {},
    timeseries: payload?.timeseries || {},
    timeseries_metrics: payload?.timeseries_metrics || {},
  }
}

export function shapeSemiPublicSearch(payload) {
  return {
    summary: payload?.summary || {},
    timeseries: payload?.timeseries || {},
    timeseries_clicks: payload?.timeseries_clicks || payload?.timeseries || {},
    timeseries_impressions: payload?.timeseries_impressions || {},
  }
}

export function shapePublicMetricsDto({ mode, project, traffic, search, realtime, funnels }) {
  if (mode === PublicProjectMode.SEMI_PUBLIC) {
    return {
      mode,
      project,
      traffic: shapeSemiPublicTraffic(traffic),
      search: shapeSemiPublicSearch(search),
    }
  }
  return {
    mode,
    project,
    traffic: traffic || {},
    search: search || {},
    realtime: realtime || null,
    funnels: funnels || null,
  }
}
