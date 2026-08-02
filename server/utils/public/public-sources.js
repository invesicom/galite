/* ===================================================================
 * 公开数据源元信息
 *
 * 职责:
 *   - 只暴露公开卡片布局需要的 provider 名称.
 *   - 不返回 auth/resource/token 等任何私有数据.
 * =================================================================== */

import { and, eq } from 'drizzle-orm'
import { project_data_source } from '../../database/schema'
import { DataSourceProvider, RecordStatus } from '../constants'

const PROVIDER_ORDER = [
  DataSourceProvider.GA4,
  DataSourceProvider.GSC,
  DataSourceProvider.BING,
]

const PUBLIC_CARD_PROVIDERS = new Set(PROVIDER_ORDER)

export async function loadPublicProjectProviderMap(db, profile) {
  return (await loadPublicSourceMeta(db, profile)).providersByProject
}

export async function loadPublicVerifiedSources(db, profile) {
  return (await loadPublicSourceMeta(db, profile)).verifiedSources
}

export async function loadPublicSourceMeta(db, profile) {
  const rows = await db.select({
    project_key: project_data_source.project_key,
    provider: project_data_source.provider,
  })
    .from(project_data_source)
    .where(and(
      eq(project_data_source.project_id, profile.project_id),
      eq(project_data_source.union_id, profile.union_id),
      eq(project_data_source.status, RecordStatus.ACTIVE),
    ))

  const map = new Map()
  for (const row of rows) {
    if (!row.project_key || !PUBLIC_CARD_PROVIDERS.has(row.provider)) continue
    const set = map.get(row.project_key) || new Set()
    set.add(row.provider)
    map.set(row.project_key, set)
  }

  const ordered = new Map()
  for (const [projectKey, providers] of map.entries()) {
    ordered.set(projectKey, [...providers].sort((a, b) =>
      PROVIDER_ORDER.indexOf(a) - PROVIDER_ORDER.indexOf(b),
    ))
  }
  const providers = new Set(rows.map((row) => row.provider).filter(Boolean))
  return {
    providersByProject: ordered,
    verifiedSources: PROVIDER_ORDER.filter((provider) => providers.has(provider)),
  }
}
