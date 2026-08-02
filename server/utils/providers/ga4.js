/* ===================================================================
 * GA4 Data API 客户端 + 多 property 聚合
 *
 * 设计哲学:
 *   - 单进单出: runReport / runRealtimeReport 只负责 fetch + 错误归一,
 *     不关心业务语义.
 *   - 业务语义集中在 aggregateMetrics: 多 property -> 单视图,
 *     用查表替代分支 (RATIO_FIELDS / SUMMABLE_FIELDS).
 *   - period 转换走查表 PERIOD_RANGES, 没有 if/else.
 *
 * 协议:
 *   - 401 -> token_invalid, 上层据此把 data_source_auth.status 置 99
 *   - 403 -> property_permission_denied, 仅当前资源不可用，不污染账号授权
 *   - 429/503 -> throw { statusCode: 503, message: 'rate_limited' }
 *   - 其他 5xx -> throw { statusCode: 502, message: 'ga4_api_error' }
 * =================================================================== */

import { GA4_CORE_METRICS, MetricsPeriod } from '../constants'
import { isCustomPeriod, parseCustomPeriod, shiftPreviousAbsolute, customGranularity } from '../period'

/* ---- period -> GA4 startDate/endDate 查表 ---- */
const PERIOD_RANGES = {
  [MetricsPeriod.TODAY]:         { startDate: 'today',       endDate: 'today' },
  [MetricsPeriod.YESTERDAY]:     { startDate: 'yesterday',   endDate: 'yesterday' },
  [MetricsPeriod.LAST_7_DAYS]:   { startDate: '7daysAgo',    endDate: 'today' },
  [MetricsPeriod.LAST_28_DAYS]:  { startDate: '28daysAgo',   endDate: 'today' },
  [MetricsPeriod.LAST_90_DAYS]:  { startDate: '90daysAgo',   endDate: 'today' },
  [MetricsPeriod.LAST_6_MONTHS]: { startDate: '180daysAgo',  endDate: 'today' },
  [MetricsPeriod.LAST_1_YEAR]:   { startDate: '365daysAgo',  endDate: 'today' },
}

/* ---- 比率字段 (按 sessions 加权平均) ---- */
const RATIO_FIELDS = new Set([
  'bounceRate',
  'averageSessionDuration',
  'userEngagementDuration',
])

/* ---- 上一周期日期: 给 summary 算 delta 用 ---- */
const PREVIOUS_PERIOD_RANGES = {
  [MetricsPeriod.TODAY]:         { startDate: 'yesterday',   endDate: 'yesterday' },
  [MetricsPeriod.YESTERDAY]:     { startDate: '2daysAgo',    endDate: '2daysAgo' },
  [MetricsPeriod.LAST_7_DAYS]:   { startDate: '14daysAgo',   endDate: '8daysAgo' },
  [MetricsPeriod.LAST_28_DAYS]:  { startDate: '56daysAgo',   endDate: '29daysAgo' },
  [MetricsPeriod.LAST_90_DAYS]:  { startDate: '180daysAgo',  endDate: '91daysAgo' },
  [MetricsPeriod.LAST_6_MONTHS]: { startDate: '360daysAgo',  endDate: '181daysAgo' },
  [MetricsPeriod.LAST_1_YEAR]:   { startDate: '730daysAgo',  endDate: '366daysAgo' },
}

/* custom 走绝对日期 (GA4 Data API 接受 YYYY-MM-DD); 固定周期仍用相对日期保留 property 时区语义 */
export function periodToRange(period) {
  if (isCustomPeriod(period)) {
    const custom = parseCustomPeriod(period)
    if (custom) return custom
  }
  return PERIOD_RANGES[period] || PERIOD_RANGES[MetricsPeriod.LAST_7_DAYS]
}

export function previousPeriodRange(period) {
  if (isCustomPeriod(period)) {
    const custom = parseCustomPeriod(period)
    if (custom) return shiftPreviousAbsolute(custom)   /* 按总天数对称前移 */
  }
  return PREVIOUS_PERIOD_RANGES[period] || PREVIOUS_PERIOD_RANGES[MetricsPeriod.LAST_7_DAYS]
}

/* ---- 时序 granularity (today/yesterday/custom 单日 -> hour, 否则 day) ---- */
export function granularityOf(period) {
  if (isCustomPeriod(period)) {
    const custom = parseCustomPeriod(period)
    if (custom) return customGranularity(custom)
  }
  return period === MetricsPeriod.TODAY || period === MetricsPeriod.YESTERDAY
    ? 'hour'
    : 'day'
}

/* ===================================================================
 *  GA4 Data API: runReport
 *
 *  propertyId 形如 "properties/123456" (数据库存的就是这个完整字符串)
 *
 *  !! 关键: metricAggregations: ['TOTAL'] 必须显式传 !!
 *      GA4 默认不返回 `totals` 字段, 不传这一参数 → response.totals 为 undefined
 *      → extractTotals 读 report.totals[0] 全是 undefined → 所有指标永远为 0
 *      (这是 GA Lite 早期 metrics 全 0 的根因)
 * =================================================================== */

export async function runReport({
  accessToken,
  propertyId,
  startDate,
  endDate,
  dateRanges = null,
  metrics,
  dimensions = [],
  orderBys = null,
  limit = 1000,
  dimensionFilter = undefined,
}) {
  const url = `https://analyticsdata.googleapis.com/v1beta/${propertyId}:runReport`
  const ranges = Array.isArray(dateRanges) && dateRanges.length
    ? dateRanges
    : [{ startDate, endDate }]
  const body = {
    dateRanges: ranges.map((range, index) => ({
      ...(range.name ? { name: String(range.name) } : {}),
      startDate: range.startDate,
      endDate: range.endDate,
      ...(range.name ? {} : { name: `range_${index}` }),
    })),
    metrics: (metrics || []).map((name) => ({ name })),
    dimensions: dimensions.map((name) => ({ name })),
    metricAggregations: ['TOTAL'],
    keepEmptyRows: false,
    limit,
  }
  if (orderBys) body.orderBys = orderBys
  if (dimensionFilter) body.dimensionFilter = dimensionFilter

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (res.ok) return res.json()
  await throwGa4Error(res)
}

/* ===================================================================
 *  GA4 Data API: runRealtimeReport
 *
 *  metric 默认 activeUsers, 30 分钟窗口.
 *  !! 维度/指标兼容性: eventName 维度与 activeUsers 在实时接口不兼容,
 *     GA4 对不兼容组合"返回空行而非报错", 故 eventName 必须传 metric='eventCount',
 *     否则 by_event 永远为空 (与历史 dimension 端点 eventName→eventCount 同理).
 * =================================================================== */

export async function runRealtimeReport({ accessToken, propertyId, dimensions = [], limit = 50, minutesAgo = 29, metric = 'activeUsers' }) {
  const url = `https://analyticsdata.googleapis.com/v1beta/${propertyId}:runRealtimeReport`
  const body = {
    metrics: [{ name: metric }],
    dimensions: dimensions.map((name) => ({ name })),
    minuteRanges: [{ name: `last_${minutesAgo}min`, startMinutesAgo: minutesAgo, endMinutesAgo: 0 }],
    metricAggregations: ['TOTAL'],
    limit,
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (res.ok) return res.json()
  await throwGa4Error(res)
}

/* ---- 错误归一: token_invalid / rate_limited / ga4_api_error ---- */
async function throwGa4Error(res) {
  const text = await res.text().catch(() => '')
  if (res.status === 401) {
    throw createError({ statusCode: 401, message: 'token_invalid', data: text })
  }
  if (res.status === 403) {
    throw createError({ statusCode: 403, message: 'ga4_property_permission_denied', data: text })
  }
  if (res.status === 404) {
    throw createError({ statusCode: 404, message: 'ga4_property_not_found', data: text })
  }
  if (res.status === 429 || res.status === 503) {
    throw createError({ statusCode: 503, message: 'rate_limited', data: text })
  }
  throw createError({ statusCode: 502, message: 'ga4_api_error', data: text })
}

/* ===================================================================
 *  报表行解析: GA4 -> { metricName: number, ... }
 *
 *  GA4 响应结构:
 *    metricHeaders: [{ name }, ...]
 *    rows: [{ dimensionValues: [...], metricValues: [{ value }, ...] }]
 *
 *  totals 字段: 整体合计行 (无 dimensionValues), 用于 summary
 * =================================================================== */

export function extractTotals(report, metricNames, options = {}) {
  const headers = (report?.metricHeaders || []).map((h) => h.name)
  const opts = typeof options === 'number' ? { dateRangeIndex: options } : (options || {})
  const rangeIndex = Math.max(0, Number(opts.dateRangeIndex) || 0)

  /* 优先 totals (需 metricAggregations:['TOTAL']),
     缺失则降级 rows[0] (无 dimensions 时 GA4 单行总计, 实时接口尤其常见) */
  const totalsRow = report?.totals?.[rangeIndex]?.metricValues
    || findDateRangeRow(report, opts.dateRangeName, rangeIndex)?.metricValues
    || (rangeIndex === 0 ? report?.rows?.[0]?.metricValues : null)
    || []

  const out = {}
  for (const name of metricNames) {
    const idx = headers.indexOf(name)
    out[name] = idx >= 0 ? Number(totalsRow[idx]?.value || 0) : 0
  }
  return out
}

function findDateRangeRow(report, dateRangeName, dateRangeIndex) {
  const dims = (report?.dimensionHeaders || []).map((h) => h.name)
  const idx = dims.indexOf('dateRange')
  if (idx < 0) return null
  const targets = new Set([
    String(dateRangeIndex),
    `date_range_${dateRangeIndex}`,
    `range_${dateRangeIndex}`,
    dateRangeName ? String(dateRangeName) : '',
  ].filter(Boolean))
  return (report?.rows || []).find((row) =>
    targets.has(String(row?.dimensionValues?.[idx]?.value || '')),
  ) || null
}

export function extractRows(report, metricNames) {
  const headers = (report?.metricHeaders || []).map((h) => h.name)
  const dims = (report?.dimensionHeaders || []).map((h) => h.name)
  return (report?.rows || []).map((row) => {
    const dimValues = (row.dimensionValues || []).map((v) => v.value)
    const metricValues = {}
    for (const name of metricNames) {
      const idx = headers.indexOf(name)
      metricValues[name] = idx >= 0 ? Number(row.metricValues?.[idx]?.value || 0) : 0
    }
    return { dimensions: dims.reduce((acc, dimName, i) => {
      acc[dimName] = dimValues[i]
      return acc
    }, {}), metrics: metricValues }
  })
}

/* ===================================================================
 *  多 property 聚合
 *
 *  输入: [{ totals }, { totals }, ...]   每个 property 的 8 字段汇总
 *  输出: { ...8 字段聚合后 }
 *
 *  规则:
 *    - 可加和字段: 直接求和
 *    - 比率字段:   按 sessions 加权平均 (sum(rate*sessions) / sum(sessions))
 *      理论严谨性: bounceRate 是 (跳出 sessions / 总 sessions) 的比率,
 *                 多 property 合并后总 sessions 是分母, 因此用 sessions 加权
 *                 是数学上正确的还原.
 *
 *  当 sum(sessions) = 0 时, 比率字段返回 0 (避免 NaN).
 * =================================================================== */

export function aggregateMetrics(totalsList) {
  /* ---- 初始化全 0 输出 ---- */
  const result = {}
  for (const name of GA4_CORE_METRICS) result[name] = 0
  if (!totalsList?.length) return result

  /* ---- 第一遍: 累加可加和字段, 累加 ratio*sessions 中间量 ---- */
  let sessionsSum = 0
  const ratioWeighted = {}
  for (const name of RATIO_FIELDS) ratioWeighted[name] = 0

  for (const totals of totalsList) {
    const sessions = Number(totals?.sessions || 0)
    sessionsSum += sessions

    for (const name of GA4_CORE_METRICS) {
      if (RATIO_FIELDS.has(name)) {
        ratioWeighted[name] += Number(totals?.[name] || 0) * sessions
      } else {
        result[name] += Number(totals?.[name] || 0)
      }
    }
  }

  /* ---- 第二遍: 比率字段 = 加权和 / 总 sessions ---- */
  for (const name of RATIO_FIELDS) {
    result[name] = sessionsSum > 0 ? ratioWeighted[name] / sessionsSum : 0
  }

  return result
}

/* ===================================================================
 *  GA4 Data API v1alpha: runFunnelReport
 *
 *  ⚠ alpha 接口: Google 标注未来可能 breaking change, 但标准 GA4 property
 *    可用 (不需要 GA4 360). 失败时由 throwGa4Error 统一归一; 上层捕获
 *    501/404/UNIMPLEMENTED -> 返"漏斗服务暂不可用"提示, 不降级近似计算
 *    (降级双轨会引入两份数据语义, 违反"消除特殊情况"铁律).
 *
 *  step 输入形态 (与 utils/funnel-steps.js 归一化后的形态一致):
 *    { name, kind:'page'|'event', match:'exact|contains|starts_with|ends_with', value }
 *
 *  step 到 GA4 filter 的映射用 2 张查表替代 if/else 链:
 *    STRING_MATCH_TYPE_GA4: 前端 match -> GA4 matchType
 *    FUNNEL_STEP_BUILDERS:  step.kind  -> filterExpression 构造器
 * =================================================================== */

/* ---- 前端 match -> GA4 matchType (page 步用) ---- */
const STRING_MATCH_TYPE_GA4 = {
  exact:       'EXACT',
  contains:    'CONTAINS',
  starts_with: 'BEGINS_WITH',
  ends_with:   'ENDS_WITH',
}

/* ---- step.kind -> GA4 filterExpression 构造器 (查表替代分支) ----
   page:  按统一页面路径 / 屏幕字段做字符串匹配 (跨 web + app)
   event: GA4 funnelEventFilter 只支持事件名精确匹配, 忽略 match 字段
   -- */
const FUNNEL_STEP_BUILDERS = {
  page: (s) => ({
    funnelFieldFilter: {
      fieldName: 'unifiedPagePathScreen',
      stringFilter: {
        value: s.value,
        matchType: STRING_MATCH_TYPE_GA4[s.match] || 'EXACT',
      },
    },
  }),
  event: (s) => ({
    funnelEventFilter: { eventName: s.value },
  }),
}

function buildStepName(step, idx) {
  const n = String(step?.name || '').trim()
  return n || `Step ${idx + 1}`
}

function buildFunnelStep(step, idx) {
  const build = FUNNEL_STEP_BUILDERS[step.kind]
  if (!build) throw createError({ statusCode: 400, message: 'invalid_step_kind' })
  return {
    name: buildStepName(step, idx),
    filterExpression: build(step),
  }
}

/* ---- 主调用: 把 step 列表 + dateRange 拼成 GA4 v1alpha funnel 请求 ----
   dimensionFilter: 顶级过滤, GA4 v1alpha funnelReportRequest 内置字段,
   作用于每个 step 的源事件 (跟普通 runReport 的 dimensionFilter 同语义) */
export async function runFunnelReport({ accessToken, propertyId, startDate, endDate, steps, dimensionFilter = undefined }) {
  const url = `https://analyticsdata.googleapis.com/v1alpha/${propertyId}:runFunnelReport`
  const body = {
    dateRanges: [{ startDate, endDate }],
    funnel: {
      steps: (steps || []).map(buildFunnelStep),
    },
    funnelVisualizationType: 'STANDARD_FUNNEL',
  }
  if (dimensionFilter) body.dimensionFilter = dimensionFilter
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (res.ok) return res.json()
  await throwGa4Error(res)
}

/* ===================================================================
 *  funnel 响应解析: GA4 funnelTable -> 前端友好结构
 *
 *  GA4 v1alpha 响应包含两块: funnelVisualization (可视化用) 与
 *    funnelTable (行级表格). 我们用 funnelTable, 因为它一定带:
 *      dimensions: ['funnelStepName']
 *      metrics:    ['activeUsers', 'funnelStepCompletionRate',
 *                   'funnelStepAbandonmentRate']
 *
 *  GA4 行序与 step 序未必一致 (取决于 funnelVisualizationType), 因此
 *    按 step name 反查映射, 用预期的 steps 顺序输出.
 *
 *  返回口径: 每步给前端"相对第一步的累计转化率 / 相对上一步的流失率",
 *    GA4 自带的 funnelStepCompletionRate 是相对前一步, 与我们口径不同,
 *    保留为 raw_completion_rate 字段不直接用.
 * =================================================================== */
export function extractFunnel(report, expectedSteps) {
  const table = report?.funnelTable || {}
  const dimHeaders     = (table.dimensionHeaders || []).map((h) => h.name)
  const metricHeaders  = (table.metricHeaders || []).map((h) => h.name)
  const stepNameIdx    = dimHeaders.indexOf('funnelStepName')
  const usersIdx       = metricHeaders.indexOf('activeUsers')
  const completionIdx  = metricHeaders.indexOf('funnelStepCompletionRate')

  /* ---- 按 step name 索引 rows (双键: 原值 + 去前缀 "N. ", 兼容 GA4
          有/无前缀两种情形) ---- */
  const byName = new Map()
  for (const row of (table.rows || [])) {
    const raw = row.dimensionValues?.[stepNameIdx]?.value
    if (!raw) continue
    byName.set(raw, row)
    byName.set(raw.replace(/^\d+\.\s*/, ''), row)
  }

  /* ---- 按 expectedSteps 顺序输出 (GA4 行序不可信) ----
     重要: lookupName 是 GA4 请求时给每步起的"派生名" (用户没填时回退到
     "Step N"), 仅用于 byName.get() 反查 row, 不该回写到出参. 前端 label
     渲染逻辑 `step.name || step.value` 期望: 用户填了 name 才显示 name,
     否则显示 value (page_view / /signup 等), 派生 "Step N" 不该污染. */
  const stepsOut = (expectedSteps || []).map((s, i) => {
    const lookupName = buildStepName(s, i)
    const row = byName.get(lookupName) || null
    const users = row && usersIdx >= 0
      ? Math.floor(Number(row.metricValues?.[usersIdx]?.value || 0))
      : 0
    const rawCompletion = row && completionIdx >= 0
      ? Number(row.metricValues?.[completionIdx]?.value || 0)
      : 0
    return {
      index: i,
      name: s.name || '',                /* 只回原始用户输入 (可能空) */
      kind: s.kind,
      match: s.match,
      value: s.value,
      users,
      raw_completion_rate: rawCompletion,
    }
  })

  /* ---- 派生字段: 相对第一步累计转化 + 相对前一步流失 ---- */
  const firstUsers = stepsOut[0]?.users || 0
  for (let i = 0; i < stepsOut.length; i++) {
    const s = stepsOut[i]
    const prev = stepsOut[i - 1]
    s.cumulative_conversion = firstUsers > 0 ? s.users / firstUsers : 0
    s.drop_users = prev ? Math.max(0, prev.users - s.users) : 0
    s.drop_rate  = prev && prev.users > 0 ? s.drop_users / prev.users : 0
  }

  const finalUsers = stepsOut.length ? stepsOut[stepsOut.length - 1].users : 0
  return {
    steps: stepsOut,
    total_users: firstUsers,
    final_users: finalUsers,
    overall_conversion_rate: firstUsers > 0 ? finalUsers / firstUsers : 0,
  }
}
