/* ===================================================================
 * 保存 Google OAuth Client
 * - Client ID 明文存 D1，Client Secret 使用 APP_SECRET 加密
 * - Client ID 或 Secret 真正变化时，已有 Google 连接统一要求重新授权
 * =================================================================== */

import { eq, inArray } from 'drizzle-orm'
import { data_source_auth, instance_config } from '../../../database/schema'
import { encrypt } from '../../../utils/crypto'
import { getAppSecret, INSTANCE_CONFIG_ID, setInstanceConfig } from '../../../utils/self-hosted'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const body = await readBody(event) || {}
  const clientId = String(body.client_id || '').trim().slice(0, 512)
  const clientSecret = String(body.client_secret || '').trim().slice(0, 2048)
  const current = event.context.instanceConfig || {}

  if (!clientId) return reqFail('google_client_id_required')
  if (!clientSecret && !current.google_client_secret_enc) {
    return reqFail('google_client_secret_required')
  }

  const appSecret = getAppSecret(event)
  if (appSecret.length < 32) return reqFail('app_secret_missing')

  const secretEnc = clientSecret
    ? await encrypt(clientSecret, appSecret, 'google-client-secret')
    : current.google_client_secret_enc
  const now = Math.floor(Date.now() / 1000)
  const patch = {
    google_client_id: clientId,
    google_client_secret_enc: secretEnc,
    updated_at: now,
  }
  const credentialsChanged = clientId !== String(current.google_client_id || '')
    || Boolean(clientSecret)
  const db = useDb(event)

  await db.update(instance_config)
    .set(patch)
    .where(eq(instance_config.id, INSTANCE_CONFIG_ID))
  if (credentialsChanged) {
    await db.update(data_source_auth)
      .set({ status: 99, updated_at: now })
      .where(inArray(data_source_auth.provider, ['ga4', 'gsc']))
  }

  setInstanceConfig(event, { ...current, ...patch })
  return reqSuccess({ configured: true, reconnect_required: credentialsChanged })
})
