/* ===================================================================
 * GET /api/metrics/{projectKey}/realtime
 *
 * 输出:
 *   active_users_30min:  全部 property 求和
 *   by_minute: 最近 30 分钟逐分钟活跃用户, 最早一分钟在前, 缺失分钟补 0
 *   by_country / by_page / by_device / by_city: 同 value 行求和, 按 activeUsers 降序
 *   by_event: 按 eventCount 降序 (eventName 与 activeUsers 在实时接口不兼容会返空, 必须用 eventCount)
 *   注: 实时 API 无 source/medium(来源)维度, 页面用 unifiedScreenName(非 pagePath)
 *
 * 缓存 key = ga4:project:{projectKey}:realtime
 * TTL    = REALTIME_CACHE_TTL_MS / 1000 = 25s
 * =================================================================== */

import { useDb } from '../../../utils/db'
import { getAccessToken } from '../../../utils/data-source-token'
import { loadProjectAndSources, markAuthInvalid } from '../../../utils/metrics-helpers'
import { loadCachedProjectRealtime } from '../../../utils/realtime-metrics'

export default defineEventHandler(async (event) => {
  const projectKey = getRouterParam(event, 'projectKey')
  const db = await useDb(event)
  const { project, sources, jwtSecret, siteConfig } = await loadProjectAndSources(event, db, projectKey)

  const payload = await loadCachedProjectRealtime(event, {
    db,
    projectId: project.project_id,
    projectKey,
    sources,
    logPrefix: '[metrics/realtime]',
    accessTokenForSource: ({ auth }) => getAccessToken(db, auth, jwtSecret, siteConfig),
    onAuthInvalid: (authId) => markAuthInvalid(db, authId),
  })
  setHeader(event, 'Server-Timing', `cache;desc=${payload.cache_state || 'miss'}`)
  return reqSuccess(payload)
})
