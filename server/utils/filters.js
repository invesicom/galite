/* ===================================================================
 * Filter 工具层 (后端)
 *
 * 用户在站点详情页添加的"维度过滤条件" (如 Country=Germany, Browser
 * contains chrome), 影响 summary / timeseries / dimension 等所有数据查询.
 * --
 * 数据模型 (单条 filter):
 *   { dim, match, value }
 *     dim:    sessionSource | pagePath | eventName | country | browser
 *             operatingSystem | deviceCategory | sessionDefaultChannelGroup
 *     match:  exact | not_equals | contains | not_contains
 *             starts_with | not_starts_with | ends_with | not_ends_with
 *     value:  string (用户输入的匹配值)
 *     --
 *     not_* 系列走 GA4 notExpression 包装实现"排除"语义
 * --
 * URL 形态 (跟前端 utils/filters.js 对齐):
 *   ?f=country:exact:US&f=browser:contains:chrome
 *   - 每条 filter 一个 ?f= 参数 (Nuxt useRoute().query.f 自动多值数组)
 *   - 字段间用 ":" 分隔
 *   - value 可能含 ":" (如 URL path), split 后 rest 用 join 回填
 *   - 整体 URL-decoded 由框架处理, helper 内不再 decode
 * =================================================================== */

/* ---- 维度白名单 (URL parse 一级闸门, 与前端 utils/filters.js 对齐)
        踩坑记录: 早期只列 GA4 维度, searchQuery (GSC-only) 在前端能加但
                 URL 到后端 parseFilterString 直接 return null 被丢, 导致 GSC
                 filter "看似生效实则没传", GSC dimension API 返全量 top 关键词.
        修复后: 这层只做格式合法性, 各下游 builder (GA4/GSC) 用自己的维度白名单
                二级守卫挑能消费的 ---- */
export const FILTER_DIMS = new Set([
  'sessionSource',
  'pagePath',
  'eventName',
  'country',
  'browser',
  'operatingSystem',
  'deviceCategory',
  'sessionDefaultChannelGroup',
  'searchQuery',   /* GSC-only — buildDimensionFilter(GA4) 必须 skip 此 dim */
  'searchProvider', /* UI-only — 前端转成 search API 的 sp 参数, 数据 filter 必须 skip */
])

/* ---- GA4 二级闸门: 标识哪些 dim GA4 实际能消费
        作用: 双源项目共享同一份 filters URL, GA4 视图遇到 searchQuery 这种
              GSC-only 维度时必须跳过, 否则 GA4 API 会因 fieldName 不存在报错 */
const GA4_CONSUMABLE_DIMS = new Set([
  'sessionSource',
  'pagePath',
  'eventName',
  'country',
  'browser',
  'operatingSystem',
  'deviceCategory',
  'sessionDefaultChannelGroup',
])

export const FILTER_MATCH = new Set([
  'exact',       'not_equals',
  'contains',    'not_contains',
  'starts_with', 'not_starts_with',
  'ends_with',   'not_ends_with',
])

export const FILTER_LIMIT = 5
export const FILTER_VALUE_LIMIT = 200

/* ---- 前端 dim 别名 -> GA4 实际字段名 (跟 DIMENSION_CONFIG 同款) ---- */
const DIM_ALIAS_GA4 = {
  country: 'countryId',
}

/* ---- match 操作符 → GA4 stringFilter matchType + 是否取反 ----
   一表两用消除分支: 8 个操作符直接查到 matchType + negate flag,
   buildDimensionFilter 据此决定是否用 notExpression 包装. */
const MATCH_TO_GA4 = {
  exact:           { matchType: 'EXACT',       negate: false },
  not_equals:      { matchType: 'EXACT',       negate: true  },
  contains:        { matchType: 'CONTAINS',    negate: false },
  not_contains:    { matchType: 'CONTAINS',    negate: true  },
  starts_with:     { matchType: 'BEGINS_WITH', negate: false },
  not_starts_with: { matchType: 'BEGINS_WITH', negate: true  },
  ends_with:       { matchType: 'ENDS_WITH',   negate: false },
  not_ends_with:   { matchType: 'ENDS_WITH',   negate: true  },
}

/* ---- 解析单条 filter 字符串 ----
   "country:exact:US" -> { dim, match, value }
   非法 (字段缺失 / 不在白名单) 返 null */
function parseFilterString(raw) {
  if (!raw) return null
  const parts = String(raw).split(':')
  if (parts.length < 3) return null
  const [dim, match, ...rest] = parts
  if (!FILTER_DIMS.has(dim))   return null
  if (!FILTER_MATCH.has(match)) return null
  const value = rest.join(':').trim().slice(0, FILTER_VALUE_LIMIT)
  if (!value) return null
  return { dim, match, value }
}

/* ---- 从 Nuxt query 解析 filters 数组 ----
   兼容 query.f 是 string / string[] / undefined 三种形态 */
export function parseFiltersFromQuery(query) {
  const raw = query?.f
  if (!raw) return []
  const arr = Array.isArray(raw) ? raw : [raw]
  return arr.slice(0, FILTER_LIMIT).map(parseFilterString).filter(Boolean)
}

/* ---- 把 filters 拼成 GA4 dimensionFilter ----
   单条 正向:  { filter: {...} }
   单条 排除:  { notExpression: { filter: {...} } }
   多条:       { andGroup: { expressions: [...] } }
   空:         undefined (调用方 spread 时跳过) */
export function buildDimensionFilter(filters) {
  if (!Array.isArray(filters) || filters.length === 0) return undefined
  /* 二级守卫: 只把 GA4 能消费的维度传下去, 跳过 searchQuery 等 GSC-only 维度
     避免 GA4 API 因未知 fieldName 报错 */
  const ga4Filters = filters.filter((f) => GA4_CONSUMABLE_DIMS.has(f?.dim))
  if (!ga4Filters.length) return undefined
  const expressions = ga4Filters.map((f) => {
    const cfg = MATCH_TO_GA4[f.match] || MATCH_TO_GA4.exact
    const baseExpr = {
      filter: {
        fieldName: DIM_ALIAS_GA4[f.dim] || f.dim,
        stringFilter: {
          value: f.value,
          matchType: cfg.matchType,
          caseSensitive: false,
        },
      },
    }
    /* not_* 系列用 notExpression 包装基础 filter 取反 */
    return cfg.negate ? { notExpression: baseExpr } : baseExpr
  })
  if (expressions.length === 1) return expressions[0]
  return { andGroup: { expressions } }
}

/* ---- 提取 GSC 可消费的 query filters (legacy, 仅兼容老调用)
        新代码用 mapGa4FiltersToGsc, 这个未来可删 ---- */
export function extractGscQueryFilters(filters) {
  if (!Array.isArray(filters)) return []
  return filters
    .filter((f) => f.dim === 'searchQuery')
    .map((f) => ({ dim: 'query', match: f.match, value: f.value }))
}

/* ===================================================================
 *  mapGa4FiltersToGsc - 把 GA4 维度筛选转成 GSC 形态
 *
 *  GA4 与 GSC 同概念维度的形态差异:
 *    countryId         alpha-2 (US/DE/CN)         ↔ country  alpha-3 (USA/DEU/CHN)
 *    pagePath          相对路径 (/about)          ↔ page     完整 URL (https://example.com/about)
 *    deviceCategory    小写 (desktop/mobile/...)  ↔ device   大写 (DESKTOP/MOBILE/TABLET)
 *    searchQuery       别名                       ↔ query    GSC 原名
 *
 *  其他 GA4 维度 (sessionSource / eventName / browser / operatingSystem /
 *  sessionDefaultChannelGroup) 在 GSC 没有对应概念, 直接 skip — 不报错,
 *  让 GSC 视为"该筛选 no-op", 不影响 GSC 查询结果.
 *
 *  入参:
 *    filters: [{ dim, match, value }, ...]  (前端筛选条件)
 *    project: { site_url, ... }  (反推 GSC page 完整 URL 用)
 *  返回:
 *    [{ dim, match, value }, ...] (GSC 维度名 + 值已转换)
 * =================================================================== */

import { alpha2ToAlpha3 } from './country-code-map'

export function mapGa4FiltersToGsc(filters, project) {
  if (!Array.isArray(filters) || !filters.length) return []
  /* siteUrl 去末尾 / 让 pagePath 拼接干净: example.com/ + /about → example.com/about
     (而不是 example.com//about) */
  const siteUrl = String(project?.site_url || '').replace(/\/$/, '')
  const out = []
  for (const f of filters) {
    if (!f?.value) continue
    if (f.dim === 'country') {
      /* alpha-2 → alpha-3; 已是 alpha-3 / 未识别 / 特殊值原样传 (容错) */
      out.push({ dim: 'country', match: f.match, value: alpha2ToAlpha3(f.value) })
    } else if (f.dim === 'pagePath') {
      /* GA4 pagePath 是相对路径 /about, GSC page 要完整 URL
         若值已是完整 URL (http*) 直接用; 否则用项目 site_url 拼前缀 */
      const path = String(f.value)
      const value = /^https?:\/\//i.test(path) ? path : (siteUrl + path)
      out.push({ dim: 'page', match: f.match, value })
    } else if (f.dim === 'deviceCategory') {
      out.push({ dim: 'device', match: f.match, value: String(f.value).toUpperCase() })
    } else if (f.dim === 'searchQuery') {
      out.push({ dim: 'query', match: f.match, value: String(f.value) })
    }
    /* 其他维度 GSC 无对应 → skip (不报错, 让 GSC 区视为该筛选无影响) */
  }
  return out
}

/* ---- cache key fragment ----
   filters 影响 GA4 返回, 必须进 cache key 防"加了 filter 仍命中旧 cache"
   排序后再拼, 让 [{a},{b}] 和 [{b},{a}] 产生同一 key (业务上 AND 满足交换律) */
export function filterCacheKey(filters) {
  if (!Array.isArray(filters) || filters.length === 0) return ''
  const dataFilters = filters.filter((f) => f?.dim !== 'searchProvider')
  if (!dataFilters.length) return ''
  const sorted = dataFilters
    .map((f) => `${f.dim}=${f.match}=${f.value}`)
    .sort()
    .join(',')
  return ':f:' + sorted
}
