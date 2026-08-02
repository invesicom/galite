<template>
  <!-- ============================================================
       SummaryCards - 4 个核心指标卡 (4 列, 对齐 ga-lite)
       --
       字段: visitors / page_views / bounce_rate / avg_session_duration
       loading 时每张卡显示 animate-pulse 骨架块
       delta% 对比上一周期 (vs previous_metrics)
       --
       新增: 每张卡右上角 checkbox, 勾选驱动下方 TimeseriesChart
            显示对应折线. checkbox 颜色 = 折线颜色 (METRIC_COLORS),
            视觉上"卡片勾的颜色"=="图表线条颜色", 用户可一眼追踪.
            至少保留 1 个勾选, 防止图表空空如也.
       ============================================================ -->
  <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
    <div
      v-for="m in cards"
      :key="m.key"
      class="rounded-xl border border-gray-200 bg-white p-4"
    >
      <!-- ============ header: 图标 + 标签 + checkbox (h-5 锁高, 跟下方 delta 同行高) ============ -->
      <div class="flex h-5 items-center justify-between gap-2">
        <div class="flex min-w-0 items-center gap-1.5 text-sm font-medium leading-5 text-gray-500">
          <NuxtIcon :name="m.icon" class="size-4 shrink-0" />
          <span class="truncate">{{ m.label }}</span>
        </div>
        <!-- checkbox: 勾选时填 METRIC_COLORS, 不勾时灰描边 -->
        <button
          type="button"
          :class="[
            'flex size-4 shrink-0 items-center justify-center rounded transition-colors',
            isSelected(m.key)
              ? 'border-0'
              : 'border border-gray-300 bg-white hover:border-gray-400',
            isLastSelected(m.key) ? 'cursor-not-allowed' : 'cursor-pointer',
          ]"
          :style="isSelected(m.key) ? { background: metricColor(m.key) } : {}"
          :aria-pressed="isSelected(m.key)"
          :aria-label="m.label"
          @click="toggle(m.key)"
        >
          <NuxtIcon v-if="isSelected(m.key)" name="ri:check-line" class="size-3 text-white" />
        </button>
      </div>

      <!-- 加载骨架屏 (高度对齐: 主数字 text-3xl leading-9 = h-9, 副文本 text-sm leading-5 = h-5) -->
      <template v-if="loading">
        <div class="mt-2 h-9 w-2/3 animate-pulse rounded bg-gray-200" />
        <div class="mt-1 h-5 w-1/2 animate-pulse rounded bg-gray-100" />
      </template>

      <!-- 实际数据 -->
      <template v-else>
        <div class="mt-2 text-3xl font-semibold leading-9 text-gray-900 tabular-nums">
          {{ m.display }}
        </div>
        <!-- delta 数字 (hover 自身显示"对比上一周期" tooltip)
             文字说明 / 图标都去掉, 极简 — 卡片底部仅剩 delta% 一个数字.
             桌面端 hover 数字弹 tooltip 解释口径; 移动端没 hover,
             但移动用户也不会追问"对比哪个周期", 产品语义已足够明确. -->
        <div class="mt-1 flex h-5 items-center text-sm leading-5">
          <span
            v-tooltip.bottom="$t('metrics.previous_period')"
            :class="[
              'cursor-help',
              m.delta === null ? 'text-gray-400' :
              m.delta > 0 ? 'text-emerald-600' :
              m.delta < 0 ? 'text-red-500' : 'text-gray-400',
            ]"
          >
            <template v-if="m.delta === null || m.delta === 0">—</template>
            <template v-else>
              {{ m.delta > 0 ? '+' : '' }}{{ m.delta.toFixed(1) }}%
            </template>
          </span>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
/* ============================================================
   SummaryCards（4 张核心指标卡）
   props.metrics:          { totalUsers, screenPageViews, bounceRate, averageSessionDuration }
   props.previousMetrics:  同结构, 算 delta
   props.loading:          骨架屏开关
   props.selectedMetrics:  当前勾选的指标列表 (用于图表叠加)
   emits:
     update:selectedMetrics — 勾选变更, 父级 v-model 同步
   ============================================================ */

import { computed } from 'vue'
import { metricColor } from '~/utils/metric-colors'

const props = defineProps({
  metrics:         { type: Object,  default: () => ({}) },
  previousMetrics: { type: Object,  default: () => ({}) },
  loading:         { type: Boolean, default: false },
  selectedMetrics: { type: Array,   default: () => [] },
})

const emit = defineEmits(['update:selectedMetrics'])

const { t } = useI18n()

/* ---- 4 指标 (与 ga-lite 卡片对齐) ---- */
const FIELDS = [
  { key: 'totalUsers',             icon: 'ri:user-line',  format: 'int' },
  { key: 'screenPageViews',        icon: 'ri:eye-line',   format: 'int' },
  { key: 'bounceRate',             icon: 'ri:arrow-go-back-line', format: 'rate' },
  { key: 'averageSessionDuration', icon: 'ri:time-line',  format: 'duration' },
]

function formatInt(v) {
  const n = Number(v) || 0
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 10_000)    return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
  return n.toLocaleString()
}
function formatRate(v) {
  return ((Number(v) || 0) * 100).toFixed(1) + '%'
}
function formatDuration(v) {
  const n = Number(v) || 0
  if (n < 60) return Math.round(n) + 's'
  const m = Math.floor(n / 60)
  const s = Math.round(n % 60)
  return `${m}m ${s}s`
}
function format(value, kind) {
  if (kind === 'rate')     return formatRate(value)
  if (kind === 'duration') return formatDuration(value)
  return formatInt(value)
}

/* ---- delta 计算: (curr - prev) / prev * 100 ---- */
function calcDelta(curr, prev) {
  const a = Number(curr) || 0
  const b = Number(prev) || 0
  if (b === 0) return null
  return ((a - b) / b) * 100
}

const cards = computed(() =>
  FIELDS.map((f) => {
    const value = props.metrics?.[f.key] ?? 0
    const prev  = props.previousMetrics?.[f.key]
    return {
      key:     f.key,
      icon:    f.icon,
      label:   t(`metrics.card.${labelKey(f.key)}`),
      display: format(value, f.format),
      delta:   prev === undefined || prev === null ? null : calcDelta(value, prev),
    }
  }),
)

/* ---- field key → i18n label key ---- */
function labelKey(fieldKey) {
  if (fieldKey === 'totalUsers')             return 'visitors'
  if (fieldKey === 'screenPageViews')        return 'page_views'
  if (fieldKey === 'bounceRate')             return 'bounce_rate'
  if (fieldKey === 'averageSessionDuration') return 'engagement'
  return fieldKey
}

/* ============================================================
   checkbox 状态 + 切换
   --
   规则: 至少保留 1 个勾选 (防图表空态), 取消最后一个被禁用
   ============================================================ */
function isSelected(key) {
  return props.selectedMetrics.includes(key)
}

function isLastSelected(key) {
  return props.selectedMetrics.length === 1 && props.selectedMetrics[0] === key
}

function toggle(key) {
  if (isLastSelected(key)) return /* 不允许取消最后一个 */
  const next = isSelected(key)
    ? props.selectedMetrics.filter((k) => k !== key)
    : [...props.selectedMetrics, key]
  emit('update:selectedMetrics', next)
}
</script>
