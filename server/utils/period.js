/* ===================================================================
 * 自定义日期周期 - period 解析 / 校验 / 上一周期推算
 *
 * 设计哲学:
 *   - 固定周期 (today/7days/28days/...) 仍由各 provider 的查表处理,
 *     此模块只负责 "custom_START_END" 这一种动态形态 + 统一校验.
 *   - custom 格式用下划线分隔 (custom_2024-01-01_2024-01-31):
 *       URL-safe (无需 encodeURIComponent) + cache-key-safe
 *       (冒号是 buildCacheKey 的分隔符, 用下划线避免污染 key 结构),
 *       全链路免编码 — 这是"让特殊情况消失"的关键.
 *   - 单日 = 起止相同 (custom_D_D), 不设第二种格式, 消除分支.
 *
 * GA4 与 GSC 共用此处的 custom 解析:
 *   - 固定周期下 GA4 返相对日期 ('7daysAgo')、GSC 返绝对日期, 各自保持原样;
 *   - custom 一律返绝对 ISO 日期 (GA4 Data API 同时接受绝对日期, runReport 无需改).
 * =================================================================== */

import { METRICS_PERIODS } from './constants'

const CUSTOM_PREFIX = 'custom_'
/* custom_YYYY-MM-DD_YYYY-MM-DD (单日则两段相同) */
const CUSTOM_RE = /^custom_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/
const FLOOR_DATE = '2010-01-01'   /* 早于此一律视为非法 — GA4/GSC 都不可能有此数据 */

/* ---- ISO 日期真实性 (拦截 2024-02-31 / 2024-13-01 这类格式合法但不存在的日期) ---- */
function isRealIsoDate(s) {
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/* ---- 服务端 today(UTC) + 缓冲天数 → ISO, 给 ceiling 校验用 ---- */
function todayPlusBufferIso(days) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/* ---- 是否 custom 形态 (仅前缀判断, 不保证合法) ---- */
export function isCustomPeriod(period) {
  return typeof period === 'string' && period.startsWith(CUSTOM_PREFIX)
}

/* ---- custom_START_END → { startDate, endDate } (绝对 ISO); 任一不合法返 null ----
   ISO 串字典序比较即等价日期比较, 无需 Date 运算 */
export function parseCustomPeriod(period) {
  const m = CUSTOM_RE.exec(String(period || ''))
  if (!m) return null
  const [, startDate, endDate] = m
  if (!isRealIsoDate(startDate) || !isRealIsoDate(endDate)) return null
  if (startDate > endDate) return null
  if (startDate < FLOOR_DATE) return null
  if (endDate > todayPlusBufferIso(2)) return null   /* 未来日期 (留 2 天时区缓冲) */
  return { startDate, endDate }
}

/* ---- 统一 period 校验: 固定 7 值 ∪ 合法 custom — 取代 16 端点各写的白名单 ---- */
export function isValidPeriod(period) {
  return METRICS_PERIODS.includes(period) || parseCustomPeriod(period) != null
}

/* ---- 任意绝对区间 → 等长上一周期 (按总天数对称前移)
        GA4/GSC custom 环比共用此算法, 取代原本分散的两处重复实现.
        用 UTC 方法, 不受运行时区影响 (Cloudflare Workers 跑 UTC). ---- */
export function shiftPreviousAbsolute({ startDate, endDate }) {
  const toIso = (d) => d.toISOString().slice(0, 10)
  const start = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  const days = Math.round((end - start) / 86400000) + 1
  const prevEnd = new Date(start); prevEnd.setUTCDate(prevEnd.getUTCDate() - 1)
  const prevStart = new Date(prevEnd); prevStart.setUTCDate(prevStart.getUTCDate() - days + 1)
  return { startDate: toIso(prevStart), endDate: toIso(prevEnd) }
}

/* ---- custom 区间时序粒度: 单日按小时(24点), 多日按天 — 与 GA4 today/yesterday 口径一致 ---- */
export function customGranularity({ startDate, endDate }) {
  return startDate === endDate ? 'hour' : 'day'
}
