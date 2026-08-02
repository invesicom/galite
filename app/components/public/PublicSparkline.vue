<template>
  <div v-if="loading" class="mt-4 h-40 w-full animate-pulse rounded bg-gray-100" />
  <div
    v-else
    ref="chartRef"
    class="relative h-44 w-full touch-pan-y"
    @pointermove="onPointerMove"
    @pointerleave="hoverIndex = -1"
    @pointercancel="hoverIndex = -1"
  >
    <svg viewBox="0 0 640 180" class="h-full w-full" role="img" :aria-label="title">
      <line x1="0" y1="150" x2="640" y2="150" stroke="#e5e7eb" stroke-width="1" />
      <polyline
        v-if="points"
        :points="points"
        fill="none"
        :stroke="color"
        stroke-width="3"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <template v-if="hoverPoint">
        <line
          :x1="hoverPoint.x"
          :x2="hoverPoint.x"
          y1="24"
          y2="150"
          stroke="#9ca3af"
          stroke-width="1"
          stroke-dasharray="3 3"
        />
        <circle
          :cx="hoverPoint.x"
          :cy="hoverPoint.y"
          r="5"
          :fill="color"
          stroke="#fff"
          stroke-width="3"
        />
      </template>
      <text v-else-if="!points" x="320" y="92" text-anchor="middle" class="fill-gray-400 text-xs">
        No data
      </text>
    </svg>

    <div
      v-if="hoverPoint"
      :class="[
        'pointer-events-none absolute z-10 -translate-y-full rounded-md bg-gray-900 px-2 py-1.5 text-xs text-white shadow-lg',
        hoverPoint.x > 560 ? '-translate-x-full' : '-translate-x-1/2',
      ]"
      :style="{ left: `${hoverPoint.x / 640 * 100}%`, top: `${Math.max(18, hoverPoint.y - 8) / 180 * 100}%` }"
    >
      <div class="whitespace-nowrap font-medium">{{ hoverPoint.label }}</div>
      <div class="mt-0.5 whitespace-nowrap font-mono">{{ formatNumber(hoverPoint.value) }}</div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  title: { type: String, default: 'Trend' },
  data: { type: Object, default: () => ({}) },
  color: { type: String, default: 'var(--color-primary)' },
  loading: { type: Boolean, default: false },
})

const chartRef = ref(null)
const hoverIndex = ref(-1)

const values = computed(() => {
  const series = props.data?.series?.[0]?.data
  return Array.isArray(series) ? series.map((x) => Number(x) || 0) : []
})

const labels = computed(() => {
  const raw = props.data?.labels
  if (Array.isArray(raw) && raw.length === values.value.length) return raw
  return values.value.map((_, index) => `#${index + 1}`)
})

const plottedPoints = computed(() => {
  const arr = values.value
  if (!arr.length) return []
  const max = Math.max(...arr, 1)
  const step = arr.length > 1 ? 620 / (arr.length - 1) : 0
  return arr.map((value, index) => ({
    index,
    value,
    label: labels.value[index] || `#${index + 1}`,
    x: 10 + step * index,
    y: 150 - (value / max) * 120,
  }))
})

const points = computed(() =>
  plottedPoints.value.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' '),
)

const hoverPoint = computed(() =>
  hoverIndex.value >= 0 ? plottedPoints.value[hoverIndex.value] || null : null,
)

function onPointerMove(event) {
  const pointsCount = plottedPoints.value.length
  const el = chartRef.value
  if (!el || !pointsCount) return

  const rect = el.getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
  hoverIndex.value = Math.round(ratio * (pointsCount - 1))
}

function formatNumber(value) {
  const n = Number(value) || 0
  return Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n)
}
</script>
