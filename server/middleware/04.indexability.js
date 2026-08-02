/* ===================================================================
 * 搜索引擎收录闸门
 * - 配置自定义域名后，它是唯一允许收录的主机
 * - 未配置时直接使用当前 workers.dev / 请求 Host；localhost 始终 noindex
 * - HTTP 头覆盖错误页与显式 index meta，作为最终安全边界
 * =================================================================== */

import { getPublicSiteOrigin } from '../utils/self-hosted'

function normalizeHostname(host) {
  const value = String(host || '').split(',')[0].trim().toLowerCase()
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    return end > 0 ? value.slice(1, end) : value
  }
  return value.replace(/:\d+$/, '')
}

function isPrivateDashboardPath(pathname) {
  const segments = String(pathname || '').split('/').filter(Boolean)
  const first = segments[0] || ''
  const second = segments[1] || ''
  const privateRoots = new Set(['projects', 'integrations', 'realtime'])
  return privateRoots.has(first)
    || (/^[a-z]{2}(?:-[a-z]{2})?$/i.test(first) && privateRoots.has(second))
}

export default defineEventHandler((event) => {
  let indexableHost = ''
  try {
    indexableHost = normalizeHostname(new URL(getPublicSiteOrigin(event)).hostname)
  } catch {
    indexableHost = ''
  }
  const requestHost = normalizeHostname(getHeader(event, 'host'))
  const nonPublicHosts = new Set(['localhost', '127.0.0.1', '::1'])
  const isIndexableHost = Boolean(indexableHost)
    && requestHost === indexableHost
    && !nonPublicHosts.has(indexableHost)

  event.context.isIndexableHost = isIndexableHost

  if (!isIndexableHost || isPrivateDashboardPath(getRequestURL(event).pathname)) {
    setResponseHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
  }
})
