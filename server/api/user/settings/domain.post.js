/* ===================================================================
 * 保存可选规范域名
 * - 空值表示自动使用当前请求 Origin（workers.dev 可直接工作）
 * =================================================================== */

import { eq } from 'drizzle-orm'
import { instance_config } from '../../../database/schema'
import {
  getGoogleOauthClientUrls,
  getPublicSiteOrigin,
  INSTANCE_CONFIG_ID,
  normalizeCustomOrigin,
  setInstanceConfig,
} from '../../../utils/self-hosted'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const body = await readBody(event) || {}
  const customOrigin = normalizeCustomOrigin(body.custom_origin)
  const current = event.context.instanceConfig || {}
  const patch = {
    custom_origin: customOrigin,
    updated_at: Math.floor(Date.now() / 1000),
  }

  await useDb(event).update(instance_config)
    .set(patch)
    .where(eq(instance_config.id, INSTANCE_CONFIG_ID))
  setInstanceConfig(event, { ...current, ...patch })

  const effectiveOrigin = getPublicSiteOrigin(event)
  return reqSuccess({
    custom_origin: customOrigin,
    effective_origin: effectiveOrigin,
    ...getGoogleOauthClientUrls(effectiveOrigin),
  })
})
