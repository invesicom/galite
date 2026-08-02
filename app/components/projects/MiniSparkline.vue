<script setup>
/* ============================================================
   MiniSparkline - 卡片级迷你折线
   --
   设计意图:
     - 纯 SVG, 0 依赖, viewBox 100×32 适应任意卡片宽度
     - 仅展示趋势形状, 不带刻度 / hover / tooltip — 信息密度服从卡片节奏
     - 折线 + 半透明填充区域 (主题色), 与品牌融合不喧宾夺主
   --
   props.points: number[]
     ≥ 2 个点 → 绘制 polyline + area
     ≤ 1 个 / 全 0 / 缺失 → 灰色细线兜底 (空态视觉不突兀)
   props.loading: 骨架灰条 (跟数字卡 skeleton 视觉同款)
   ============================================================ */

import { computed } from 'vue'

const props = defineProps({
  /* 单线模式 (旧用法): 单 series + 半透明 fill, 颜色 = 主题色 */
  points:  { type: Array,   default: () => [] },
  /* 多线模式 (新用法): series = [{ points: number[], color: string }, ...]
     - 每条线渲染独立 polyline, 无 fill (适合 GSC 卡 clicks+impressions 双线对照)
     - 共享 y 轴归一化 (基于全部点 min/max), 让两条线能直观对比走势
     - 传了 series 即覆盖 points (互斥) */
  series:  { type: Array,   default: () => [] },
  loading: { type: Boolean, default: false },
  height:  { type: Number,  default: 32 },     /* SVG 实际渲染高度 (px) */
})

/* ---- viewBox 内部坐标系 (与外部 px 解耦, SVG 自动缩放) ---- */
const VB_WIDTH  = 100
const VB_HEIGHT = 32
/* 上下各留 2px 内边距, 让最高/最低点不贴边 */
const PAD_Y = 2

/* ---- 模式判定: 优先 series (多线), 否则降级 points (单线 + fill) ---- */
const isMulti = computed(() => Array.isArray(props.series) && props.series.length > 0)

/* ---- 单线: cleaned 数字数组 ---- */
const cleaned = computed(() => {
  const arr = Array.isArray(props.points) ? props.points : []
  return arr.map((n) => Number(n) || 0)
})

/* ---- 多线: 每条 series 归一为 { color, pts: number[] } ---- */
const multiSeries = computed(() => {
  if (!isMulti.value) return []
  return props.series
    .filter((s) => s && Array.isArray(s.points))
    .map((s) => ({
      color: String(s.color || 'currentColor'),
      pts: s.points.map((n) => Number(n) || 0),
    }))
    .filter((s) => s.pts.length >= 2)
})

const hasData = computed(() => {
  if (isMulti.value) {
    return multiSeries.value.some((s) => s.pts.some((n) => n > 0))
  }
  return cleaned.value.length >= 2 && cleaned.value.some((n) => n > 0)
})

/* ---- 共享 y 轴归一化: 多线模式取所有 series 的全局 min/max,
        让两条线放在同一坐标系直观对比 (clicks 通常远小于 impressions,
        共享 y 轴会让 clicks 线贴近底部 — 这是真实关系的诚实表达) ---- */
const yScale = computed(() => {
  let all
  if (isMulti.value) {
    all = multiSeries.value.flatMap((s) => s.pts)
  } else {
    all = cleaned.value
  }
  if (!all.length) return { min: 0, max: 1 }
  const max = Math.max(...all)
  const min = Math.min(...all)
  return { min, max: max === min ? max + 1 : max }
})

/* ---- 数组 → SVG 坐标点 [x, y][] ---- */
function projectPoints(pts) {
  if (!pts || pts.length < 2) return []
  const { min, max } = yScale.value
  const range = max - min || 1
  const dx = VB_WIDTH / (pts.length - 1)
  return pts.map((v, i) => {
    const x = i * dx
    const y = VB_HEIGHT - PAD_Y - ((v - min) / range) * (VB_HEIGHT - PAD_Y * 2)
    return [x.toFixed(2), y.toFixed(2)]
  })
}

/* ---- 单线模式 ---- */
const projected = computed(() => projectPoints(cleaned.value))
const polylinePoints = computed(() =>
  projected.value.map(([x, y]) => `${x},${y}`).join(' '),
)
const areaPath = computed(() => {
  const pts = projected.value
  if (!pts.length) return ''
  const head = `M ${pts[0][0]},${pts[0][1]}`
  const mid  = pts.slice(1).map(([x, y]) => `L ${x},${y}`).join(' ')
  const tail = `L ${VB_WIDTH},${VB_HEIGHT} L 0,${VB_HEIGHT} Z`
  return `${head} ${mid} ${tail}`
})

/* ---- 多线模式 ---- */
const multiPolylines = computed(() =>
  multiSeries.value.map((s) => ({
    color: s.color,
    points: projectPoints(s.pts).map(([x, y]) => `${x},${y}`).join(' '),
  })),
)
</script>

<template>
  <!-- 骨架: 与数字卡 skeleton 同款灰条, 高度按 prop -->
  <div
    v-if="loading"
    class="w-full animate-pulse rounded bg-gray-100"
    :style="{ height: height + 'px' }"
  />

  <!-- 多线模式: N 条 polyline 无 fill, 各自颜色 (GSC 双线对照用)
       preserveAspectRatio=none 让 viewBox 横向拉伸跟随卡片宽度 -->
  <svg
    v-else-if="isMulti && hasData"
    :width="'100%'"
    :height="height"
    :viewBox="`0 0 ${VB_WIDTH} ${VB_HEIGHT}`"
    preserveAspectRatio="none"
    class="block overflow-visible"
  >
    <polyline
      v-for="(line, idx) in multiPolylines"
      :key="idx"
      :points="line.points"
      fill="none"
      :stroke="line.color"
      stroke-width="1.4"
      stroke-linejoin="round"
      stroke-linecap="round"
      vector-effect="non-scaling-stroke"
    />
  </svg>

  <!-- 单线模式: 主题色 polyline + 8% 透明填充 -->
  <svg
    v-else-if="hasData"
    :width="'100%'"
    :height="height"
    :viewBox="`0 0 ${VB_WIDTH} ${VB_HEIGHT}`"
    preserveAspectRatio="none"
    class="block overflow-visible"
  >
    <path
      :d="areaPath"
      fill="var(--color-primary)"
      fill-opacity="0.08"
    />
    <polyline
      :points="polylinePoints"
      fill="none"
      stroke="var(--color-primary)"
      stroke-width="1.4"
      stroke-linejoin="round"
      stroke-linecap="round"
      vector-effect="non-scaling-stroke"
    />
  </svg>

  <!-- 空态: 灰色中线 (避免卡片此处空白突兀) -->
  <svg
    v-else
    :width="'100%'"
    :height="height"
    :viewBox="`0 0 ${VB_WIDTH} ${VB_HEIGHT}`"
    preserveAspectRatio="none"
    class="block"
  >
    <line
      :x1="0" :x2="VB_WIDTH"
      :y1="VB_HEIGHT / 2" :y2="VB_HEIGHT / 2"
      stroke="#e5e7eb"
      stroke-width="1"
      vector-effect="non-scaling-stroke"
    />
  </svg>
</template>
