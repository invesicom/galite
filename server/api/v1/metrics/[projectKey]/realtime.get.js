/* ===================================================================
 * v1 · GET /api/v1/metrics/{projectKey}/realtime
 *
 * 与内部 /api/metrics/{projectKey}/realtime 字段一字不差
 * 唯一差异: sk- 鉴权 + 60req/min 限流
 *
 * 缓存 TTL = REALTIME_CACHE_TTL_MS (25s)
 * =================================================================== */

import { getAccessToken } from '../../../../utils/data-source-token'
import { loadProjectAndSources, markAuthInvalid } from '../../../../utils/metrics-helpers'
import { loadCachedProjectRealtime } from '../../../../utils/realtime-metrics'

export default defineEventHandler(async (event) => {
  await guardV1(event)

  const projectKey = getRouterParam(event, 'projectKey')
  const db = await useDb(event)
  const { project, sources, jwtSecret, siteConfig } = await loadProjectAndSources(event, db, projectKey)

  const payload = await loadCachedProjectRealtime(event, {
    db,
    projectId: project.project_id,
    projectKey,
    sources,
    logPrefix: '[v1/metrics/realtime]',
    accessTokenForSource: ({ auth }) => getAccessToken(db, auth, jwtSecret, siteConfig),
    onAuthInvalid: (authId) => markAuthInvalid(db, authId),
  })
  setHeader(event, 'Server-Timing', `cache;desc=${payload.cache_state || 'miss'}`)
  return reqSuccess(payload)
})
