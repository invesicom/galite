/* ===================================================================
 * 修改管理员登录密码
 * - 校验当前密码，保存新 PBKDF2 哈希
 * - auth_version +1 后重新签发当前会话，其余旧会话立即失效
 * =================================================================== */

import { eq } from 'drizzle-orm'
import { instance_config } from '../../../database/schema'
import { hashPassword, verifyPassword } from '../../../utils/password'
import { issueOwnerSession } from '../../../utils/owner-session'
import {
  INSTANCE_CONFIG_ID,
  MIN_ADMIN_PASSWORD_LENGTH,
  setInstanceConfig,
} from '../../../utils/self-hosted'

export default defineEventHandler(async (event) => {
  requireAuth(event)
  const body = await readBody(event) || {}
  const currentPassword = String(body.current_password || '')
  const nextPassword = String(body.new_password || '')
  const confirmation = String(body.password_confirmation || '')
  const current = event.context.instanceConfig || {}

  if (!await verifyPassword(currentPassword, current.admin_password_hash)) {
    return reqFail('invalid_current_password')
  }
  if (nextPassword.length < MIN_ADMIN_PASSWORD_LENGTH) return reqFail('weak_password')
  if (nextPassword !== confirmation) return reqFail('password_mismatch')

  const patch = {
    admin_password_hash: await hashPassword(nextPassword),
    auth_version: Number(current.auth_version || 1) + 1,
    updated_at: Math.floor(Date.now() / 1000),
  }
  await useDb(event).update(instance_config)
    .set(patch)
    .where(eq(instance_config.id, INSTANCE_CONFIG_ID))

  setInstanceConfig(event, { ...current, ...patch })
  await issueOwnerSession(event)
  return reqSuccess(null, 'password_updated')
})
