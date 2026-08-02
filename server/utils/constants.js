/* ===================================================================
 * 共享常量 - 枚举与业务状态码
 * =================================================================== */

/* ---- 数据源类型 ---- */
export const DataSourceProvider = {
  GA4: 'ga4',          // Google Analytics 4
  GSC: 'gsc',          // Google Search Console
  BING: 'bing',        // Bing Webmaster Tools
}

export const DATA_SOURCE_PROVIDERS = Object.values(DataSourceProvider)

/* ---- 通用状态 ---- */
export const RecordStatus = {
  ACTIVE: 1,     // 有效
  DELETED: 97,   // 软删
  BANNED: 98,    // 封禁
}

/* ---- 指标查询周期 ---- */
export const MetricsPeriod = {
  TODAY: 'today',
  YESTERDAY: 'yesterday',
  LAST_7_DAYS:   '7days',
  LAST_28_DAYS:  '28days',
  LAST_90_DAYS:  '90days',
  LAST_6_MONTHS: '6months',   /* 详情页扩展 (~180 天) */
  LAST_1_YEAR:   '1year',     /* 详情页扩展 (~365 天) */
}

export const METRICS_PERIODS = Object.values(MetricsPeriod)

/* ---- 实时窗口 (对应 GA4 minuteRanges.startMinutesAgo) ---- */
export const RealtimePeriod = {
  LAST_30_MIN: '30min',
  LAST_5_MIN:  '5min',
  LAST_1_MIN:  '1min',
}
export const REALTIME_PERIODS = Object.values(RealtimePeriod)
export const REALTIME_PERIOD_TO_MINUTES = {
  '30min': 29,
  '5min':  5,
  '1min':  1,
}

/* ---- GA4 核心指标字段 (与 Data API 对齐) ---- */
export const GA4_CORE_METRICS = [
  'screenPageViews',           // 页面浏览量
  'totalUsers',                // 总用户数
  'activeUsers',               // 活跃用户数
  'newUsers',                  // 新用户数
  'sessions',                  // 会话数
  'bounceRate',                // 跳出率
  'averageSessionDuration',    // 平均会话时长
  'userEngagementDuration',    // 用户互动时长
]

/* ---- 缓存 TTL (毫秒) ---- */
export const SITE_CONFIG_TTL = 5 * 60 * 1000
export const METRICS_CACHE_TTL_MS = 60 * 1000     // 历史指标 1 分钟
export const REALTIME_CACHE_TTL_MS = 25 * 1000    // 实时指标 25 秒, 对齐 30s 轮询
