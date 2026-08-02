<template>
  <!-- ============================================================
       TimeseriesChart - SVG paths + HTML overlay text
       --
       踩坑笔记:
         旧版整张 SVG (含 axis text) 用 preserveAspectRatio="none" 撑满
         宽容器 (e.g. 1900×224 vs viewBox 200×80) 时, SVG 把字形也按
         非等比拉伸 → 字符被横向拉宽变形 ("3K"/"02-10" 看着像扁体).
         修复: text 全搬到 HTML 浮层, SVG 只画 path/line/circle. stroke
         统一加 vector-effect="non-scaling-stroke" 让线宽不随拉伸变化.
       --
       多 series 用不同色 (primary + accent + 推导色)
       ============================================================ -->
  <div class="relative">
    <!-- ============ Header: 仅标题 (指标切换由上方 SummaryCards 的 checkbox 驱动) ============ -->
    <div class="flex items-center gap-2 pb-3">
      <h3 class="text-base font-semibold text-gray-900">
        {{ $t('projects.detail.timeseries') }}
      </h3>
    </div>

    <!-- ============ 主图区 (3 态切换, 高度恒 h-56) ============ -->
    <div v-if="loading" class="h-56 w-full animate-pulse rounded-lg bg-gray-100" />

    <div
      v-else-if="!hasData"
      class="flex h-56 items-center justify-center rounded-lg border border-dashed border-gray-200 text-sm text-gray-400"
    >
      {{ $t('metrics.no_data') }}
    </div>

    <!-- ============ 图表本体 ============ -->
    <div v-else class="relative">
      <!-- flex-col 总容器: 主图 (flex-1) + x 标签行 (固定 20px), 总高 h-56 -->
      <div class="flex h-56 flex-col">
        <!-- ============ 主图行: y 标签列 + svg + hover overlay ============ -->
        <div class="relative flex min-h-0 flex-1">
          <!-- y 轴标签列 (40px 宽, 与下方 x 标签行 ml-10 对齐) -->
          <div class="relative w-10 shrink-0">
            <div
              v-for="(v, i) in yLabels"
              :key="i"
              class="absolute right-1.5 -translate-y-1/2 whitespace-nowrap text-xs leading-none text-gray-400 tabular-nums"
              :style="{ top: `${(i / (yLabels.length - 1)) * 100}%` }"
            >
              {{ formatTick(v) }}
            </div>
          </div>

          <!-- 主图区: svg + hover 圆点 (HTML) + tooltip (HTML)
               pointer 事件兼容鼠标 + 触摸: 移动端 tap → pointermove 显示 hover,
               松手 / 离开 chart → pointerleave 自动清, 不会留"幽灵 tooltip" -->
          <div
            class="relative flex-1 touch-pan-y"
            @pointermove="onMove"
            @pointerleave="hover = -1"
            @pointercancel="hover = -1"
          >
            <svg
              :viewBox="`0 0 ${VB_W} ${VB_H}`"
              class="block size-full overflow-visible"
              preserveAspectRatio="none"
            >
              <!-- 网格线 (4 条: 顶/三分之一/三分之二/底)
                   stroke 用 gray-100 (#f3f4f6) 而非 gray-200, 浅一档让背景退后, 突出折线 -->
              <g stroke="#f3f4f6" vector-effect="non-scaling-stroke">
                <line
                  v-for="i in 4"
                  :key="i"
                  :x1="0"
                  :x2="VB_W"
                  :y1="((i - 1) * VB_H / 3).toFixed(3)"
                  :y2="((i - 1) * VB_H / 3).toFixed(3)"
                  stroke-width="1"
                />
              </g>

              <!-- 折线 + 区域 (颜色优先 series.color, 兜底 palette 由 idx 推) -->
              <g v-for="(s, idx) in series" :key="s.label">
                <path
                  :d="areaPaths[idx]"
                  :fill="lineColor(s, idx)"
                  fill-opacity="0.08"
                />
                <path
                  :d="linePaths[idx]"
                  fill="none"
                  :stroke="lineColor(s, idx)"
                  stroke-width="2"
                  stroke-linejoin="round"
                  stroke-linecap="round"
                  vector-effect="non-scaling-stroke"
                />
              </g>

              <!-- hover 竖虚线 (HTML 圆点见下方, SVG 圆会被拉成椭圆) -->
              <line
                v-if="hover >= 0"
                :x1="xAt(hover)"
                :x2="xAt(hover)"
                y1="0"
                :y2="VB_H"
                stroke="#9ca3af"
                stroke-width="1"
                stroke-dasharray="3 3"
                vector-effect="non-scaling-stroke"
              />
            </svg>

            <!-- hover 圆点 (HTML 圆, 用百分比绝对定位, 避免 SVG circle 拉成椭圆) -->
            <template v-if="hover >= 0">
              <div
                v-for="(s, idx) in series"
                :key="s.label"
                class="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
                :style="{
                  left: `${hoverXPct}%`,
                  top: `${hoverYPct(s.data[hover])}%`,
                  background: lineColor(s, idx),
                }"
              />
            </template>

            <!-- Tooltip -->
            <div
              v-if="hover >= 0"
              :class="[
                'pointer-events-none absolute -top-2 z-10 rounded-md bg-gray-900 px-2 py-1.5 text-xs text-white shadow-lg',
                tooltipXClass,
              ]"
              :style="{ left: hoverXPct + '%' }"
            >
              <div class="whitespace-nowrap font-medium">{{ data.labels[hover] }}</div>
              <div
                v-for="(s, idx) in tooltipSeries"
                :key="s.label"
                class="mt-0.5 flex items-center gap-1.5 whitespace-nowrap"
              >
                <span class="size-2 rounded-full" :style="{ background: lineColor(s, idx) }" />
                <span class="text-gray-300">{{ s.label }}:</span>
                <span class="font-mono">{{ formatValue(s.data[hover], s) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- ============ X 轴标签行 (固定 16px + mt-1 = 20px) ============ -->
        <div class="relative ml-10 mt-1 h-4">
          <div
            v-for="(label, i) in xLabels"
            :key="i"
            class="absolute top-0 -translate-x-1/2 whitespace-nowrap text-xs leading-none text-gray-400 tabular-nums"
            :style="{ left: `${xLabelPct(label.idx)}%` }"
          >
            {{ label.text }}
          </div>
        </div>
      </div>

    </div>

    <!-- ============ 图例 (3 态共用容器, 永远占位) ============
         h-4 + mt-3 锁定 28px 高度: 不管 loading / 有数据 / 空数据,
         也不管 1 条还是多条线, 图表整体高度都是 h-56 + 28 = 252px 恒定
         loading 时显骨架块 (按 skeletonLegendCount), 真实数据 v-for series,
         空数据时容器存在但内部为空 (h-4 仍占位) -->
    <div class="mt-3 flex h-4 flex-wrap gap-3 text-xs text-gray-500">
      <template v-if="loading">
        <div
          v-for="i in Math.max(1, skeletonLegendCount)"
          :key="i"
          class="h-4 w-20 animate-pulse rounded bg-gray-100"
        />
      </template>
      <template v-else>
        <div v-for="(s, idx) in series" :key="s.label" class="flex items-center gap-1.5">
          <span class="size-2.5 rounded-full" :style="{ background: lineColor(s, idx) }" />
          <span>{{ s.label }}</span>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
/* ============================================================
   TimeseriesChart - SVG paths + HTML overlay text
   ----------------------------------------------------------------
   分层:
     SVG (preserveAspectRatio="none" + non-scaling-stroke):
       - 网格线 (1px)
       - area path / line path (line=2px)
       - hover 竖虚线 (1px dashed)
     HTML (绝对定位, 百分比):
       - y 轴标签 (左 40px 列, top=i/3*100%)
       - x 轴标签 (下方 16px 行, left=idx/(n-1)*100%)
       - hover 圆点 (border-white shadow, size-2.5)
       - tooltip
   坐标系:
     - viewBox 200×80, 内边无 padding (PAD_X=PAD_Y=0)
     - 折线/网格从边到边. stroke 用 non-scaling-stroke 保持像素宽度
   ============================================================ */

import { computed, ref } from 'vue'
import { metricColor } from '~/utils/metric-colors'

const props = defineProps({
  /* data: { period, granularity, labels: [], series: [{ label, data: [], metric?, color? }] }
     series[].color 优先于 palette(idx) 兜底, 通常由调用方按 METRIC_COLORS 注入 */
  data:    { type: Object,  default: () => null },
  loading: { type: Boolean, default: false },
  /* 父组件预期的 series 数 (通常 = selectedMetrics.length), 给骨架预留 legend 占位.
     首次加载 data 还没到时, prevSeriesCount=0 无法推断, 此 prop 兜底, 确保
     "骨架 ↔ 真实数据" 切换时图表整体高度严格等高 (含 legend 区) */
  expectedSeriesCount: { type: Number, default: 0 },
})

/* ---- viewBox (无 padding, 文字搬出 SVG 后不需要预留刻度位) ---- */
const VB_W = 200
const VB_H = 80

/* ---- 派生 series (空数据保护) ---- */
const series = computed(() => {
  const arr = props.data?.series || []
  return arr.filter((s) => Array.isArray(s.data) && s.data.length > 0)
})

const tooltipSeries = computed(() => {
  const arr = props.data?.tooltipSeries || []
  if (!arr.length) return series.value
  return arr.filter((s) => Array.isArray(s.data) && s.data.length > 0)
})

const hasData = computed(() => series.value.length > 0 && (props.data?.labels?.length || 0) > 0)

/* ---- skeleton 用: 复用 data.series 数量推断图例 (周期切换时 data 保留旧值) ---- */
const prevSeriesCount = computed(() => (props.data?.series?.length || 0))

/* ---- skeleton 图例占位数 (expectedSeriesCount 优先于 prevSeriesCount) ----
   首次加载时 data 还没到, prevSeriesCount=0; expectedSeriesCount 来自父级
   selectedMetrics.length, 此刻就是准的, 让骨架立刻预留正确 legend 空间 */
const skeletonLegendCount = computed(() =>
  props.expectedSeriesCount > 0 ? props.expectedSeriesCount : prevSeriesCount.value,
)

/* ============================================================
   y 轴刻度: nice-number 算法
   --
   原理:
     - 找数据最大值 rawMax
     - 把 rawMax/3 作为初步步长, 上浮到 {1, 2, 5} × 10^n 中最近的"好看数"
     - max = step × 3, 保证 4 个标签 (max, 2*step, step, 0) 都是整数
   收益:
     - 杜绝 "26.4, 17.6, 8.8, 0" 这类奇怪标签
     - 数据 max=24 -> ticks 30/20/10/0
     - 数据 max=99 -> ticks 150/100/50/0
   ============================================================ */
function niceScale(rawMax, intervalCount = 3) {
  if (rawMax <= 0) return { max: intervalCount, step: 1 }
  const rawStep = rawMax / intervalCount
  const exp = Math.floor(Math.log10(rawStep))
  const base = Math.pow(10, exp)
  const ratio = rawStep / base
  let niceRatio
  if (ratio <= 1)      niceRatio = 1
  else if (ratio <= 2) niceRatio = 2
  else if (ratio <= 5) niceRatio = 5
  else                 niceRatio = 10
  const step = niceRatio * base
  return { max: step * intervalCount, step }
}

const yScale = computed(() => {
  let rawMax = 0
  for (const s of series.value) for (const v of s.data) if (v > rawMax) rawMax = v
  return niceScale(rawMax, 3)
})

const yMax = computed(() => yScale.value.max)

/* ---- y 轴标签 (4 档, 由 niceScale 推导) ---- */
const yLabels = computed(() => {
  const { max, step } = yScale.value
  return [max, max - step, max - 2 * step, 0]
})

/* ---- x 轴标签 (最多 6 个, 稀疏化) ---- */
const xLabels = computed(() => {
  const labels = props.data?.labels || []
  if (labels.length === 0) return []
  const desired = Math.min(6, labels.length)
  const step = (labels.length - 1) / (desired - 1 || 1)
  const out = []
  for (let i = 0; i < desired; i++) {
    const idx = Math.round(i * step)
    out.push({ idx, text: shortLabel(labels[idx]) })
  }
  return out
})

function shortLabel(s) {
  if (!s) return ''
  /* "2026-05-01" -> "05-01"; 否则原样 */
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.slice(5)
  return s
}

/* ---- 总数据点数 (用于 x 轴百分比) ---- */
const pointCount = computed(() => Math.max((props.data?.labels?.length || 1) - 1, 1))

/* ---- viewBox 坐标 (SVG 用) ---- */
function xAt(i) {
  return (i / pointCount.value) * VB_W
}

function yAt(v) {
  const ratio = (Number(v) || 0) / yMax.value
  return VB_H - ratio * VB_H
}

/* ---- HTML 百分比 (overlay 用) ---- */
const hoverXPct = computed(() => (hover.value / pointCount.value) * 100)
const tooltipXClass = computed(() => {
  const pct = hoverXPct.value
  if (pct < 18) return 'translate-x-0'
  if (pct > 82) return '-translate-x-full'
  return '-translate-x-1/2'
})

function hoverYPct(v) {
  const ratio = (Number(v) || 0) / yMax.value
  return (1 - ratio) * 100
}

function xLabelPct(idx) {
  return (idx / pointCount.value) * 100
}

/* ---- 路径生成 ---- */
const linePaths = computed(() =>
  series.value.map((s) =>
    s.data.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(2)} ${yAt(v).toFixed(2)}`).join(' '),
  ),
)

const areaPaths = computed(() =>
  series.value.map((s) => {
    const n = s.data.length
    if (n === 0) return ''
    const top = s.data
      .map((v, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(2)} ${yAt(v).toFixed(2)}`)
      .join(' ')
    const baseY = VB_H.toFixed(2)
    return `${top} L ${xAt(n - 1).toFixed(2)} ${baseY} L ${xAt(0).toFixed(2)} ${baseY} Z`
  }),
)

/* ---- 调色板: primary / accent / 派生 hue (兜底, 当 series.color/metric 缺失时) ---- */
function palette(i) {
  const colors = ['var(--color-primary)', '#10b981', '#f59e0b', '#06b6d4', 'var(--color-accent)', '#ef4444']
  return colors[i % colors.length]
}

/* ---- 颜色解析: series.color > METRIC_COLORS[series.metric] > palette(idx) ---- */
function lineColor(s, idx) {
  if (s?.color) return s.color
  if (s?.metric) return metricColor(s.metric)
  return palette(idx)
}

/* ---- hover 状态 ---- */
const hover = ref(-1)

function onMove(ev) {
  const rect = ev.currentTarget.getBoundingClientRect()
  const ratio = (ev.clientX - rect.left) / rect.width
  const idx = Math.round(Math.max(0, Math.min(1, ratio)) * pointCount.value)
  hover.value = idx
}

/* ---- 数值格式化 ---- */
function formatValue(v, seriesItem = {}) {
  const n = Number(v) || 0
  if (seriesItem.metric === 'ctr') return (n * 100).toFixed(2) + '%'
  if (seriesItem.metric === 'position') return n > 0 ? n.toFixed(1) : '-'
  return n.toLocaleString()
}

function formatTick(v) {
  const n = Number(v) || 0
  /* 删除整数后缀的多余 .0: 1.0K -> 1K, 2.5K 保留 */
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
  return Math.round(n).toString()
}
</script>
