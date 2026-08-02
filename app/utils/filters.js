/* ===========================================================
   Filter 工具 (前端)
   --
   职责:
     - 维度白名单 + i18n titleKey (FilterAddModal 下拉选项)
     - URL ↔ filters[] 双向序列化
     - 复用上方 Top Dimensions rows 给 value 输入提供 datalist 候选
   --
   跟后端 server/utils/filters.js 对齐:
     URL 格式: ?f=dim:match:value&f=...
     字段语义: dim / match / value
   =========================================================== */

/* ---- 可筛选的 8 个维度 (跟 [projectKey].vue DIM_CONFIGS 对齐) ---- */
/* sources: 该维度归属哪些数据源
   - ['ga4']         GA4 独有 (sessionSource / eventName / browser / OS / channel)
   - ['gsc']         GSC 独有 (searchQuery / searchAppearance)
   - ['search']      Search 聚合视图独有 (searchProvider)
   - ['ga4', 'gsc']  双源都支持, 后端 mapGa4FiltersToGsc 自动转换形态
                    (country / pagePath→page / deviceCategory→device) */
export const FILTER_DIMS = [
  { key: 'sessionSource',              titleKey: 'projects.dim.traffic_sources', sources: ['ga4'] },
  { key: 'pagePath',                   titleKey: 'projects.dim.top_pages',       sources: ['ga4', 'gsc', 'search'] },
  { key: 'eventName',                  titleKey: 'projects.dim.events',          sources: ['ga4'] },
  { key: 'country',                    titleKey: 'projects.dim.countries',       sources: ['ga4', 'gsc', 'search'] },
  { key: 'browser',                    titleKey: 'projects.dim.browsers',        sources: ['ga4'] },
  { key: 'operatingSystem',            titleKey: 'projects.dim.os',              sources: ['ga4'] },
  { key: 'deviceCategory',             titleKey: 'projects.dim.devices',         sources: ['ga4', 'gsc', 'search'] },
  { key: 'sessionDefaultChannelGroup', titleKey: 'projects.dim.channels',        sources: ['ga4'] },
  { key: 'searchQuery',                titleKey: 'projects.dim.search_queries',  sources: ['gsc', 'search'] },
  { key: 'searchProvider',             titleKey: 'projects.dim.search_provider', sources: ['search'] },
]

/* 按当前数据源过滤可见维度 (FilterAddDropdown 用) */
export function filterDimsByDataSource(dataSource, options = {}) {
  const ds = dataSource || 'ga4'
  const searchProviders = Array.isArray(options.searchProviders) ? options.searchProviders : []
  return FILTER_DIMS.filter((d) => {
    if (d.key === 'searchProvider' && searchProviders.length <= 1) return false
    return (d.sources || ['ga4']).includes(ds)
  })
}

const VALID_DIMS  = new Set(FILTER_DIMS.map((d) => d.key))
const VALID_MATCH = new Set([
  'exact',       'not_equals',
  'contains',    'not_contains',
  'starts_with', 'not_starts_with',
  'ends_with',   'not_ends_with',
])

export const FILTER_LIMIT = 5
export const FILTER_VALUE_LIMIT = 200

/* ---- 单条序列化: filter → "dim:match:value" ---- */
function serializeOne(f) {
  return `${f.dim}:${f.match}:${f.value}`
}

/* ---- 单条反序列化: "dim:match:value" → filter | null ----
   value 可能含 ":" (URL 路径), 用 ...rest + join 兼容 */
function deserializeOne(s) {
  if (!s) return null
  const parts = String(s).split(':')
  if (parts.length < 3) return null
  const [dim, match, ...rest] = parts
  if (!VALID_DIMS.has(dim))   return null
  if (!VALID_MATCH.has(match)) return null
  const value = rest.join(':').trim().slice(0, FILTER_VALUE_LIMIT)
  if (!value) return null
  return { dim, match, value }
}

/* ---- 从 route.query 解析 filters ----
   query.f 可能是 undefined / string / string[] (Nuxt useRoute 多值 query) */
export function parseFiltersFromQuery(query) {
  const raw = query?.f
  if (!raw) return []
  const arr = Array.isArray(raw) ? raw : [raw]
  return arr.slice(0, FILTER_LIMIT).map(deserializeOne).filter(Boolean)
}

/* ---- filters → URL query 片段 ----
   返回 { f: [...] } 或 { f: undefined } (router.replace 时 spread 进现有 query) */
export function filtersToQuery(filters) {
  if (!Array.isArray(filters) || filters.length === 0) return { f: undefined }
  return { f: filters.slice(0, FILTER_LIMIT).map((filter) => ({
    ...filter,
    value: String(filter.value || '').slice(0, FILTER_VALUE_LIMIT),
  })).map(serializeOne) }
}

/* ---- 找维度 i18n titleKey (FilterBar chip 显示用) ---- */
export function dimTitleKey(dim) {
  const found = FILTER_DIMS.find((d) => d.key === dim)
  return found ? found.titleKey : ''
}

/* ---- 找 match 操作符 i18n key (FilterAddModal dropdown 选项标签) ----
   exact 用 "is", 其他保持原 key. 形态: "等于" / "包含" / "以...开头" / ... */
export function matchOpKey(match) {
  return match === 'exact' ? 'filters.op.is' : `filters.op.${match}`
}

/* ---- 找 match 模板 i18n key (FilterChip 文案, 含 {value} 占位符) ----
   形态: "以 {value} 开头" / "starts with {value}" — 各语言句法自然.
   chip 用 <i18n-t :keypath="..."> 插入 value, 让"以"与"开头"夹住 value 中文最顺. */
export function matchOpTplKey(match) {
  return match === 'exact' ? 'filters.op.tpl.is' : `filters.op.tpl.${match}`
}
