import { and, desc, eq, sql } from 'drizzle-orm'
import { project_list, project_data_source } from '../../../database/schema'
import { RecordStatus } from '../../../utils/constants'

function providerList(raw) {
  return String(raw || '').split(',').map((p) => p.trim()).filter(Boolean)
}

function shapeProject(p, dsCount, providers) {
  const list = Array.isArray(providers) ? providers : []
  const searchProviders = list.filter((p) => ['gsc', 'bing'].includes(p))
  return {
    project_key: p.project_key,
    name: p.name,
    description: p.description || '',
    logo_url: p.logo_url || '',
    site_url: p.site_url || '',
    timezone: p.timezone || '',
    priority: p.priority ?? 0,
    data_source_count: dsCount,
    providers: list,
    search_providers: searchProviders,
    has_site_data: list.includes('ga4'),
    has_search_data: searchProviders.length > 0,
    created_at: p.created_at,
    updated_at: p.updated_at,
  }
}

export default defineEventHandler(async (event) => {
  const user = await guardV1(event)
  const db = await useDb(event)

  const projects = await db.select().from(project_list)
    .where(and(
      eq(project_list.project_id, user.project_id),
      eq(project_list.union_id, user.union_id),
      eq(project_list.status, RecordStatus.ACTIVE),
    ))
    .orderBy(desc(project_list.priority), desc(project_list.id))

  const counts = await db.select({
    project_key: project_data_source.project_key,
    count: sql`count(*)`.as('count'),
    providers: sql`GROUP_CONCAT(DISTINCT ${project_data_source.provider})`.as('providers'),
  })
    .from(project_data_source)
    .where(and(
      eq(project_data_source.project_id, user.project_id),
      eq(project_data_source.union_id, user.union_id),
      eq(project_data_source.status, RecordStatus.ACTIVE),
    ))
    .groupBy(project_data_source.project_key)

  const countMap = new Map(counts.map((r) => [r.project_key, Number(r.count)]))
  const providerMap = new Map(counts.map((r) => [r.project_key, providerList(r.providers)]))

  return reqSuccess({
    list: projects.map((p) => shapeProject(
      p,
      countMap.get(p.project_key) || 0,
      providerMap.get(p.project_key) || [],
    )),
  })
})
