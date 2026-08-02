/* ===================================================================
 * 创建项目
 *
 * POST /api/projects/create
 * Body: { name, description?, site_url?, logo_url?, timezone? }
 *
 * 校验:
 *   - name 1~100 字 (必填)
 *   - project_key 复用 auto-sync 的 pickProjectKey (base62 字母风格), 单一真相源
 * =================================================================== */

import { and, eq } from 'drizzle-orm'
import { project_list } from '../../database/schema'
import { RecordStatus } from '../../utils/constants'
import { pickProjectKey } from '../../utils/auto-sync-projects'

/* ---- 校验 + 归一化输入 ---- */
function normalizeInput(body) {
  const name = String(body?.name || '').trim().slice(0, 100)
  if (!name) return { error: 'name required' }
  return {
    name,
    description: String(body?.description || '').trim(),
    site_url:    String(body?.site_url    || '').trim().slice(0, 500),
    logo_url:    String(body?.logo_url    || '').trim().slice(0, 2048),
    timezone:    String(body?.timezone    || '').trim().slice(0, 64),
  }
}

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const body = await readBody(event)

  const input = normalizeInput(body)
  if (input.error) return reqFail(input.error)

  const db = await useDb(event)

  const projectKey = await pickProjectKey(db, user.project_id)
  if (!projectKey) return reqFail('project_key generation collision')

  const now = Math.floor(Date.now() / 1000)
  await db.insert(project_list).values({
    project_id: user.project_id,
    union_id: user.union_id,
    project_key: projectKey,
    name: input.name,
    description: input.description,
    site_url: input.site_url,
    logo_url: input.logo_url,
    timezone: input.timezone,
    priority: 0,
    status: RecordStatus.ACTIVE,
    created_at: now,
    updated_at: now,
  })

  const row = await getFirst(
    db.select().from(project_list)
      .where(and(
        eq(project_list.project_id, user.project_id),
        eq(project_list.project_key, projectKey),
      ))
      .limit(1),
  )

  return reqSuccess({
    project_key: row.project_key,
    name: row.name,
    description: row.description || '',
    logo_url: row.logo_url || '',
    site_url: row.site_url || '',
    timezone: row.timezone || '',
    priority: row.priority ?? 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  })
})
