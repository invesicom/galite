/* ===================================================================
 * Nitro Scheduled Task — 清理过期指标缓存与短期限流桶
 * =================================================================== */

import { createDbFromEnv } from '../utils/db'
import { purgeExpiredMetricsCache } from '../utils/metrics-cache'
import { purgeExpiredRateLimitBuckets } from '../utils/rate-limit'

export default defineTask({
  meta: {
    name: 'clean-metrics-cache',
    description: 'Delete expired metrics cache and short-lived rate-limit buckets',
  },
  async run(ctx) {
    const env = ctx?.context?.cloudflare?.env
      ?? ctx?.cloudflare?.env
      ?? (typeof globalThis !== 'undefined' ? globalThis.__env__ : undefined)
      ?? {}

    try {
      const db = await createDbFromEnv(env)
      const metricsDeleted = await purgeExpiredMetricsCache(db)
      const rateLimitsDeleted = await purgeExpiredRateLimitBuckets(db)
      return { result: 'ok', metricsDeleted, rateLimitsDeleted }
    } catch (err) {
      console.error('[tasks/clean-metrics-cache] failed:', err?.message || err)
      return { result: 'error', error: err?.message || String(err) }
    }
  },
})
