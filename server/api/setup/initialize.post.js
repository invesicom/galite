/* ===================================================================
 * 首次初始化
 * - 仅 instance_config 不存在时可执行
 * - 管理员密码只保存 PBKDF2 哈希，成功后直接签发登录会话
 * =================================================================== */

import { instance_config } from '../../database/schema'
import { hashPassword } from '../../utils/password'
import { issueOwnerSession } from '../../utils/owner-session'
import {
  getAppSecret,
  INSTANCE_CONFIG_ID,
  isInstanceInitialized,
  MIN_ADMIN_PASSWORD_LENGTH,
  setInstanceConfig,
} from '../../utils/self-hosted'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default defineEventHandler(async (event) => {
  await enforceBucketRateLimit(event, { scope: 'instance-setup', subject: 'owner', limit: 10 })

  if (isInstanceInitialized(event.context.instanceConfig)) return reqFail('already_initialized')
  if (getAppSecret(event).length < 32) return reqFail('app_secret_missing')

  const body = await readBody(event) || {}
  const email = String(body.email || '').trim().toLowerCase().slice(0, 254)
  const password = String(body.password || '')
  const confirmation = String(body.password_confirmation || '')

  if (!EMAIL_PATTERN.test(email)) return reqFail('invalid_email')
  if (password.length < MIN_ADMIN_PASSWORD_LENGTH) return reqFail('weak_password')
  if (password !== confirmation) return reqFail('password_mismatch')

  const now = Math.floor(Date.now() / 1000)
  const config = {
    id: INSTANCE_CONFIG_ID,
    admin_email: email,
    admin_password_hash: await hashPassword(password),
    auth_version: 1,
    google_client_id: '',
    google_client_secret_enc: '',
    custom_origin: '',
    created_at: now,
    updated_at: now,
  }

  try {
    await useDb(event).insert(instance_config).values(config)
  } catch (error) {
    if (/unique|constraint/i.test(String(error?.message || ''))) return reqFail('already_initialized')
    throw error
  }

  setInstanceConfig(event, config)
  return reqSuccess(await issueOwnerSession(event), 'initialized')
})
