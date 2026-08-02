/* ===================================================================
 * Project Search metrics helper
 * =================================================================== */

import { and, eq, inArray } from 'drizzle-orm'
import { project_list, project_data_source, data_source_auth } from '../database/schema'
import { RecordStatus } from './constants'
import { getFirst, selectInBatches } from './db'
import { getJwtSecret, getSiteConfig } from './metrics-helpers'

export async function loadProjectSearchSources(event, db, projectKey, providers) {
  const user = requireAuth(event)
  const jwtSecret = getJwtSecret(event)
  const siteConfig = getSiteConfig(event)
  const providerList = Array.isArray(providers) ? providers.filter(Boolean) : []

  const project = await getFirst(
    db.select().from(project_list)
      .where(and(
        eq(project_list.project_id, user.project_id),
        eq(project_list.union_id, user.union_id),
        eq(project_list.project_key, projectKey),
        eq(project_list.status, RecordStatus.ACTIVE),
      ))
      .limit(1),
  )
  if (!project) throw createError({ statusCode: 404, message: 'project_not_found' })
  if (!providerList.length) return { user, project, sources: [], jwtSecret, siteConfig }

  const dsRows = await db.select().from(project_data_source)
    .where(and(
      eq(project_data_source.project_id, user.project_id),
      eq(project_data_source.union_id, user.union_id),
      eq(project_data_source.project_key, projectKey),
      inArray(project_data_source.provider, providerList),
      eq(project_data_source.status, RecordStatus.ACTIVE),
    ))

  const authIds = [...new Set(dsRows.map((row) => row.auth_id).filter(Boolean))]
  const authRows = await selectInBatches(authIds, (ids) => db.select().from(data_source_auth)
    .where(and(
      inArray(data_source_auth.id, ids),
      eq(data_source_auth.project_id, user.project_id),
      eq(data_source_auth.union_id, user.union_id),
    )))
  const authById = new Map(authRows.map((auth) => [auth.id, auth]))
  const sources = dsRows
    .map((ds) => ({ ds, auth: authById.get(ds.auth_id) }))
    .filter(({ auth }) => auth)

  return { user, project, sources, jwtSecret, siteConfig }
}
