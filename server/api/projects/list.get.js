/* ===================================================================
 * 项目列表 - 当前用户的全部 status=1 项目
 *
 * GET /api/projects/list
 * Query: keyword (可选, 暂不参与过滤; status 强制 1)
 *
 * 排序: priority DESC, id DESC
 * 附加: 每个项目挂载的有效 data_source 数、provider 与原平台链接 (一次批量查询)
 * =================================================================== */

import { and, desc, eq } from 'drizzle-orm'
import { project_list, project_data_source } from '../../database/schema'
import { DataSourceProvider, RecordStatus } from '../../utils/constants'

const ANALYTICS_HOME = 'https://analytics.google.com/analytics/web/'
const SOURCE_ORDER = {
  [DataSourceProvider.GA4]: 0,
  [DataSourceProvider.GSC]: 1,
  [DataSourceProvider.BING]: 2,
}

function parseMeta(raw) {
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

function numericResourceId(value, prefix) {
  const raw = String(value || '').trim()
  const id = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw
  return /^\d+$/.test(id) ? id : ''
}

const SOURCE_LINK_BUILDERS = {
  [DataSourceProvider.GA4]: (mount, meta) => {
    const accountId = numericResourceId(meta.account_id, 'accounts/')
    const propertyId = numericResourceId(mount.resource_id, 'properties/')
    const direct = !!(accountId && propertyId)
    return {
      url: direct
        ? `${ANALYTICS_HOME}#/a${accountId}p${propertyId}/reports/intelligenthome`
        : ANALYTICS_HOME,
      fallback: !direct,
    }
  },
  [DataSourceProvider.GSC]: (mount) => ({
    url: `https://search.google.com/search-console?resource_id=${encodeURIComponent(mount.resource_id)}`,
    fallback: false,
  }),
  [DataSourceProvider.BING]: (mount) => ({
    url: `https://www.bing.com/webmasters/home?siteUrl=${encodeURIComponent(mount.resource_id)}`,
    fallback: false,
  }),
}

function buildSourceLink(mount) {
  const build = SOURCE_LINK_BUILDERS[mount.provider]
  if (!build) return null
  return {
    provider: mount.provider,
    resource_label: mount.resource_label || mount.resource_id,
    ...build(mount, parseMeta(mount.resource_meta)),
  }
}

function groupMounts(rows) {
  const grouped = new Map()
  for (const row of rows) {
    const mounts = grouped.get(row.project_key) || []
    mounts.push(row)
    grouped.set(row.project_key, mounts)
  }
  return grouped
}

/* ---- 项目记录 -> 响应字段映射 (统一出参) ---- */
function shapeProject(p, mounts) {
  const providers = Array.from(new Set(mounts.map((row) => row.provider)))
  const sourceLinks = mounts
    .map(buildSourceLink)
    .filter(Boolean)
    .sort((a, b) => (
      (SOURCE_ORDER[a.provider] ?? 99) - (SOURCE_ORDER[b.provider] ?? 99)
      || a.resource_label.localeCompare(b.resource_label)
    ))
  return {
    project_key: p.project_key,
    name: p.name,
    description: p.description || '',
    logo_url: p.logo_url || '',
    site_url: p.site_url || '',
    timezone: p.timezone || '',
    priority: p.priority ?? 0,
    data_source_count: mounts.length,
    /* providers: 挂载的数据源 provider 数组 (去重), 让前端能精准判 GSC-only / GA4-only / 双源
       空数组 = 没挂任何数据源, 卡片菜单可据此隐藏 install/编辑等不适用项 */
    providers,
    /* 后端统一生成原平台外链，卡片只负责展示 */
    source_links: sourceLinks,
    created_at: p.created_at,
    updated_at: p.updated_at,
  }
}

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const db = await useDb(event)

  /* ---- 项目主体 ---- */
  const projects = await db.select().from(project_list)
    .where(and(
      eq(project_list.project_id, user.project_id),
      eq(project_list.union_id, user.union_id),
      eq(project_list.status, RecordStatus.ACTIVE),
    ))
    .orderBy(desc(project_list.priority), desc(project_list.id))

  /* ---- 一次取回轻量挂载信息，同时派生 count / providers / source_links，避免 N+1 ---- */
  const mounts = await db.select({
    project_key: project_data_source.project_key,
    provider: project_data_source.provider,
    resource_id: project_data_source.resource_id,
    resource_label: project_data_source.resource_label,
    resource_meta: project_data_source.resource_meta,
  })
    .from(project_data_source)
    .where(and(
      eq(project_data_source.project_id, user.project_id),
      eq(project_data_source.union_id, user.union_id),
      eq(project_data_source.status, RecordStatus.ACTIVE),
    ))
  const mountsByProject = groupMounts(mounts)
  return reqSuccess({
    list: projects.map((p) => shapeProject(
      p,
      mountsByProject.get(p.project_key) || [],
    )),
  })
})
