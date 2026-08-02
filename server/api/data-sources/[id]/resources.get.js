/* ===================================================================
 * 拉某个授权下的可挂载资源
 *
 *  GET /api/data-sources/{id}/resources
 *
 *  GA4: 列所有 accounts 下的 properties (统一摊平, account_name 进 meta)
 *  其他 provider: 走 providerOf -> 抛 501
 *
 *  错误降级:
 *    token 失效 (401) -> status=99；403 仅表示当前资源/权限不可用
 *    前端拿 401 时引导 re-consent
 * =================================================================== */

import { and, eq } from 'drizzle-orm'
import { data_source_auth } from '../../../database/schema'
import { providerOf } from '../../../utils/providers'
import { getProviderCredential } from '../../../utils/data-source-token'

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const id = Number(event.context.params?.id)
  if (!Number.isInteger(id) || id <= 0) return reqFail('id required')

  const db = await useDb(event)

  /* ---- 锁定授权行 + 越权校验 ---- */
  const authRow = await getFirst(
    db.select().from(data_source_auth).where(and(
      eq(data_source_auth.id, id),
      eq(data_source_auth.project_id, user.project_id),
      eq(data_source_auth.union_id, user.union_id),
    )).limit(1),
  )
  if (!authRow || authRow.status === 97) return reqFail('not_found')

  const provider = providerOf(authRow.provider)

  /* ---- 取 provider 明文凭证: OAuth access_token 或 API Key ---- */
  const jwtSecret = getAppSecret(event)
  const credential = await getProviderCredential(db, authRow, jwtSecret, event.context.siteConfig)

  /* ---- 拉 provider 资源, 失效时降级 status=99 ---- */
  let resources
  try {
    resources = await provider.listProperties({ accessToken: credential, apiKey: credential })
  } catch (e) {
    if (e?.statusCode === 401) {
      const now = Math.floor(Date.now() / 1000)
      await db.update(data_source_auth)
        .set({ status: 99, updated_at: now })
        .where(eq(data_source_auth.id, id))
      throw createError({ statusCode: 401, message: 'reauth_required' })
    }
    throw e
  }

  return reqSuccess({
    provider: authRow.provider,
    account_email: authRow.account_email || '',
    resources: resources || [],
  })
})
