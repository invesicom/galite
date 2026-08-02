import { ownerIdentity } from '../../utils/self-hosted'

export default defineEventHandler((event) => {
  requireAuth(event)
  return { success: true, data: ownerIdentity(event) }
})
