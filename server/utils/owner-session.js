/* ===================================================================
 * 单管理员会话签发
 * - 登录、首次初始化、修改密码共用同一条签发路径
 * - auth_version 变化后，所有旧会话自然失效
 * =================================================================== */

import { signJwt } from './jwt'
import { setLoginCookie } from './login-cookie'
import { getAppSecret, ownerIdentity } from './self-hosted'

const SESSION_TTL_SECONDS = 20 * 24 * 60 * 60

export async function issueOwnerSession(event) {
  const secret = getAppSecret(event)
  if (secret.length < 32) {
    throw createError({ statusCode: 500, message: 'app_secret_missing' })
  }

  const owner = ownerIdentity(event)
  const token = await signJwt({
    email: owner.email,
    union_id: owner.union_id,
    project_id: owner.project_id,
    role: owner.role,
    auth_version: Number(event.context.instanceConfig?.auth_version || 1),
  }, secret, SESSION_TTL_SECONDS)

  setLoginCookie(event, token)
  return owner
}
