/* ============================================================
   METRIC_COLORS - 指标 → 图表线条/复选框颜色
   --
   SummaryCards 复选框 + TimeseriesChart 折线 共用同一映射,
   保证"卡片上勾的颜色 = 图表上对应线条颜色", 用户视觉可追踪.
   --
   选色思路: primary 紫色给最常看的 PV, 其余 emerald / amber / cyan
   走色相轮分散, 避免在同图叠加时混淆.
   ============================================================ */

export const METRIC_COLORS = {
  screenPageViews:        'var(--color-primary)', /* PV  - 紫 */
  totalUsers:             '#10b981',              /* UV  - emerald */
  bounceRate:             '#f59e0b',              /* 跳出率 - amber */
  averageSessionDuration: '#06b6d4',              /* 平均时长 - cyan */
  /* ---- GSC 指标 (Google 官方后台同款配色) ---- */
  clicks:                 '#4285f4',              /* 点击 - 蓝 */
  impressions:            '#a142f4',              /* 曝光 - 紫 (双源时 SiteCardGsc 双线用) */
  ctr:                    '#34a853',              /* CTR - 绿 */
  position:               '#ea4335',              /* 排名 - 红 (越小越好, 由 SummaryCards inverted 处理) */
  averagePosition:        '#ea4335',              /* 别名 (overview SiteCard 用 averagePosition) */
}

export function metricColor(metric) {
  return METRIC_COLORS[metric] || '#9ca3af'
}
