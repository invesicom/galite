/* ===================================================================
 * 单管理员会话解析
 * =================================================================== */

import { getAppSecret, isInstanceInitialized, ownerIdentity } from '../utils/self-hosted'

export default defineEventHandler(async (event) => {
  event.context.user = null

  const authHeader = String(getHeader(event, 'authorization') || '')
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  const token = bearer || getCookie(event, 'ct_token') || ''
  const secret = getAppSecret(event)
  if (!token || !secret || !(await verifyJwt(token, secret))) return

  const payload = decodeJwt(token)?.payload
  if (payload?.role !== 'owner') return
  const instanceConfig = event.context.instanceConfig
  if (!isInstanceInitialized(instanceConfig)) return
  if (Number(payload.auth_version || 0) !== Number(instanceConfig.auth_version || 1)) return
  event.context.user = ownerIdentity(event, payload)
})
