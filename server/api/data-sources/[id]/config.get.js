/* ===================================================================
 * 读取某个授权的可编辑配置
 *
 *  GET /api/data-sources/{id}/config
 *
 *  仅返回当前登录用户自己的配置。Bing 采用 API Key 集成，编辑时需要
 *  回显原始 Key，因此这里按需解密 access_token_enc；列表接口仍不返回
 *  任何明文密钥，减少不必要的暴露面。
 * =================================================================== */

import { and, eq, sql } from 'drizzle-orm'
import { data_source_auth } from '../../../database/schema'
import { DataSourceProvider } from '../../../utils/constants'
import { decrypt } from '../../../utils/crypto'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const id = Number(event.context.params?.id)
  if (!Number.isInteger(id) || id <= 0) return reqFail('id required')

  const db = await useDb(event)
  const authRow = await getFirst(
    db.select().from(data_source_auth).where(and(
      eq(data_source_auth.id, id),
      eq(data_source_auth.project_id, user.project_id),
      eq(data_source_auth.union_id, user.union_id),
      sql`${data_source_auth.status} <> 97`,
    )).limit(1),
  )
  if (!authRow) return reqFail('not_found')
  if (authRow.provider !== DataSourceProvider.BING) return reqFail('unsupported_provider_config')

  const jwtSecret = getAppSecret(event)
  if (!jwtSecret) return reqFail('app_secret_missing')

  const apiKey = await decrypt(authRow.access_token_enc || '', jwtSecret)
  if (!apiKey) return reqFail('decrypt_failed')

  return reqSuccess({
    id: authRow.id,
    provider: authRow.provider,
    account_name: authRow.account_name || '',
    account_email: authRow.account_email || '',
    api_key: apiKey,
    status: authRow.status,
  })
})
