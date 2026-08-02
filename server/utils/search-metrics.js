/* ===================================================================
 * Search metrics 聚合工具
 *
 *  规则:
 *    clicks / impressions 直接相加
 *    ctr = clicks / impressions
 *    position = Σ(position * impressions) / Σ(impressions), 但 position=0
 *               表示 provider 没有返回排名, 不参与加权
 * =================================================================== */

export const SEARCH_PROVIDERS = ['gsc', 'bing']

export function isSearchProvider(provider) {
  return SEARCH_PROVIDERS.includes(String(provider || ''))
}

export function resolveSearchProviders(provider = 'all') {
  const p = String(provider || 'all').trim()
  if (p === 'all' || p === 'search') return [...SEARCH_PROVIDERS]
  return isSearchProvider(p) ? [p] : []
}

export function mergeSearchMetrics(items) {
  const list = Array.isArray(items) ? items : []
  let clicks = 0
  let impressions = 0
  let posWeighted = 0
  let posImpressions = 0
  for (const item of list) {
    const imp = Number(item?.impressions) || 0
    const pos = Number(item?.position) || 0
    clicks += Number(item?.clicks) || 0
    impressions += imp
    if (imp > 0 && pos > 0) {
      posWeighted += pos * imp
      posImpressions += imp
    }
  }
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: posImpressions > 0 ? posWeighted / posImpressions : 0,
  }
}

export function pickSearchOutput(metrics) {
  return {
    clicks: Number(metrics?.clicks) || 0,
    impressions: Number(metrics?.impressions) || 0,
    ctr: Number(metrics?.ctr) || 0,
    position: Number(metrics?.position) || 0,
  }
}

export function mergeProviderMap(providerMap) {
  const out = {}
  for (const [provider, list] of Object.entries(providerMap || {})) {
    out[provider] = pickSearchOutput(mergeSearchMetrics(list))
  }
  return out
}

export function mergeSearchRows(rowsByProvider, limit = 50) {
  const merged = new Map()
  for (const [provider, rows] of Object.entries(rowsByProvider || {})) {
    for (const row of (Array.isArray(rows) ? rows : [])) {
      const value = String(row?.value || '').trim()
      if (!value) continue
      const imp = Number(row.impressions) || 0
      const clicks = Number(row.clicks) || 0
      const position = Number(row.position) || 0
      const acc = merged.get(value) || {
        value,
        clicks: 0,
        impressions: 0,
        _pos_w: 0,
        _pos_i: 0,
        providers: {},
      }
      acc.clicks += clicks
      acc.impressions += imp
      if (imp > 0 && position > 0) {
        acc._pos_w += position * imp
        acc._pos_i += imp
      }
      acc.providers[provider] = pickSearchOutput(row)
      merged.set(value, acc)
    }
  }

  return Array.from(merged.values())
    .map((row) => ({
      value: row.value,
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.impressions > 0 ? row.clicks / row.impressions : 0,
      position: row._pos_i > 0 ? row._pos_w / row._pos_i : 0,
      providers: row.providers,
    }))
    .sort((a, b) => (b.impressions || 0) - (a.impressions || 0))
    .slice(0, limit)
}
