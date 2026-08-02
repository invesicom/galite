/* ===================================================================
 * D1 单管理员登录
 *
 * 邮箱与密码哈希来自 instance_config；失败响应恒定，避免泄露账号是否匹配。
 * =================================================================== */

import {
  getAdminEmail,
  getAppSecret,
  isInstanceInitialized,
} from '../../utils/self-hosted'
import { verifyPassword } from '../../utils/password'
import { issueOwnerSession } from '../../utils/owner-session'

export default defineEventHandler(async (event) => {
  await enforceBucketRateLimit(event, { scope: 'admin-login', subject: 'owner', limit: 10 })

  const body = await readBody(event) || {}
  const email = String(body.email || '').trim().toLowerCase()
  const password = String(body.password || '')
  const instanceConfig = event.context.instanceConfig
  const expectedEmail = getAdminEmail(event)
  const secret = getAppSecret(event)

  if (!isInstanceInitialized(instanceConfig) || secret.length < 32) {
    return reqFail('configuration_error')
  }

  const passwordMatches = await verifyPassword(password, instanceConfig.admin_password_hash)
  if (email !== expectedEmail || !passwordMatches) return reqFail('invalid_credentials')

  const owner = await issueOwnerSession(event)
  return reqSuccess(owner, 'login success')
})
