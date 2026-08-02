/* ===================================================================
 * 自定义日期 period 格式契约 (前端单一真相源)
 *
 *   custom_YYYY-MM-DD_YYYY-MM-DD  (单日 = 起止相同)
 *
 * 与后端 server/utils/period.js 对齐: 下划线分隔, URL-safe + cache-safe,
 * 全链路免 encodeURIComponent. PeriodSwitcher / 详情页 / 日期弹窗共用此处,
 * 避免格式正则散落三处.
 * =================================================================== */

export const CUSTOM_PERIOD_RE = /^custom_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/

export function isCustomPeriod(period) {
  return typeof period === 'string' && period.startsWith('custom_')
}

export function buildCustomPeriod(start, end) {
  return `custom_${start}_${end}`
}

/* custom_START_END → { start, end }; 非 custom / 不合法返 null */
export function parseCustomPeriod(period) {
  const m = CUSTOM_PERIOD_RE.exec(String(period || ''))
  if (!m) return null
  return { start: m[1], end: m[2] }
}
