export const DEFAULT_PROJECT_ICON_URL = '/images/icon/site-default.svg'

export function resolveProjectIcon(project) {
  const logoUrl = String(project?.logo_url || '').trim()
  if (logoUrl) return logoUrl
  return String(project?.site_url || '').trim() ? DEFAULT_PROJECT_ICON_URL : ''
}
