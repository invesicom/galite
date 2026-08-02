<template>
  <!-- ============================================================
       WorldMap - 实时地区分布 (白色主题)
       props.data: [{ code: ISO-alpha2, count | activeUsers }]
       props.minuteData: [{ minutesAgo, activeUsers }]
       · 左上角总在线 (+ 可选 periodLabel 灰色后缀); 右上角可选倒计时
       · 左下角逐分钟柱状图 + 国家列表, 共用一张浮层
       · hover 任何地区显示名 (有访客附人数)
       · 数量: 国家填色亮度; 仅 Top3 脉冲环 (无中心点, 按人数大小)
       · 交互(精简): 点击地区→放大居中 / 双击→复位全球 / 右下 +- 按钮缩放
       ============================================================ -->
  <div
    ref="mapEl"
    :class="['relative w-full select-none overflow-hidden', flat ? '' : 'rounded-2xl bg-white ring-1 ring-gray-200']"
    @mousemove="onMove"
    @mouseleave="hoveredCode = null"
    @dblclick="resetView"
  >
    <!-- 左上角: 总在线 (+ periodLabel 灰色小字后缀) -->
    <div class="pointer-events-none absolute left-4 top-3 z-10 flex items-center gap-1.5 rounded-lg bg-white/85 px-2.5 py-1 shadow-sm backdrop-blur-sm">
      <span class="relative flex size-1.5">
        <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span class="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
      </span>
      <span class="text-sm font-semibold text-gray-900">{{ total }}</span>
      <span class="text-xs text-emerald-600">{{ $t('realtime.map.online') }}</span>
      <!-- periodLabel("最近30分钟")收进 info 图标, hover 才显示, 不占视觉 -->
      <span
        v-if="periodLabel"
        v-tooltip="periodLabel"
        class="pointer-events-auto inline-flex cursor-help items-center text-gray-400 hover:text-gray-600"
      >
        <NuxtIcon name="ri:information-line" class="size-3.5" />
      </span>
    </div>

    <!-- 右上角刷新倒计时 (详情页传 countdown; 实时概况页不传) -->
    <div
      v-if="countdown != null"
      class="pointer-events-none absolute right-4 top-3 z-10 rounded-lg bg-white/85 px-2.5 py-1 text-xs text-gray-400 shadow-sm backdrop-blur-sm"
    >
      {{ $t('realtime.toolbar.next_refresh', { n: countdown }) }}
    </div>

    <!-- 右下角缩放控制 (唯一的缩放入口) -->
    <div class="absolute bottom-3 right-3 z-10 flex flex-col gap-1">
      <button
        type="button"
        class="flex size-7 items-center justify-center rounded-md bg-white/90 text-gray-600 shadow-sm ring-1 ring-gray-200 transition hover:bg-gray-50 hover:text-emerald-600"
        @click="zoomBy(1.5)"
      >
        <NuxtIcon name="ri:add-line" class="size-4" />
      </button>
      <button
        type="button"
        :disabled="scale <= 1"
        class="flex size-7 items-center justify-center rounded-md bg-white/90 text-gray-600 shadow-sm ring-1 ring-gray-200 transition hover:bg-gray-50 hover:text-emerald-600 disabled:opacity-40"
        @click="zoomBy(1 / 1.5)"
      >
        <NuxtIcon name="ri:subtract-line" class="size-4" />
      </button>
    </div>

    <!-- 左下角: 逐分钟柱状图 + 国家流量列表 (仅 PC md+ 显示)
         点击国家 → 放大居中; 放大态整块渐隐, 双击地图复位后渐显 -->
    <div
      v-if="minuteBars.length || countryList.length"
      :class="[
        'absolute bottom-6 left-6 z-10 hidden w-48 overflow-hidden bg-white/90 shadow-sm backdrop-blur-sm transition-opacity duration-300 md:block xl:w-52',
        showPanel ? 'opacity-100' : 'pointer-events-none opacity-0',
      ]"
      @dblclick.stop
    >
      <!-- Google Realtime 同语义: 最早一分钟在左, 当前分钟在右 -->
      <div
        v-if="minuteBars.length"
        :class="['px-3 py-2', countryList.length ? 'border-b border-gray-100' : '']"
      >
        <div
          class="flex h-9 items-end gap-px xl:h-10"
          role="img"
          :aria-label="$t('realtime.active_users')"
        >
          <span
            v-for="item in minuteBars"
            :key="item.minutesAgo"
            v-tooltip="`${item.minutesAgo}m · ${fmtN(item.count)}`"
            class="flex h-full min-w-0 flex-1 items-end"
          >
            <span
              class="block w-full bg-primary transition-[height] duration-300"
              :style="{ height: `${minuteBarHeight(item.count)}%` }"
            />
          </span>
        </div>
      </div>

      <div v-if="countryList.length" class="relative">
        <div
          ref="listScrollRef"
          class="h-28 overflow-y-auto py-1 [scrollbar-width:none] lg:h-40 xl:h-[212px] [&::-webkit-scrollbar]:hidden"
          @scroll="updateScrollHint"
        >
          <button
            v-for="item in countryList"
            :key="item.code"
            type="button"
            class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-gray-50"
            @click="onCountryClick(item.code)"
          >
            <CountryFlag :code="item.code" :size="14" />
            <span class="min-w-0 flex-1 truncate text-gray-700">{{ item.name }}</span>
            <span class="shrink-0 font-medium tabular-nums text-gray-900">{{ fmtN(item.count) }}</span>
          </button>
        </div>
        <!-- 底部半行渐变: 可滚动提示 (下方还有内容时显示, 滚到底自动隐) -->
        <div
          v-show="hasMoreBelow"
          class="pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-linear-to-t from-white to-transparent"
        />
      </div>
    </div>

    <svg
      viewBox="0 0 1000 460"
      class="block h-auto w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <g
        :transform="`translate(${tx} ${ty}) scale(${scale})`"
        class="transition-transform duration-300 ease-out"
      >
        <!-- 国家底图 + 填色 (点击放大居中, 全员手指态) -->
        <path
          v-for="(c, code) in WORLD_COUNTRIES"
          :key="code"
          :d="c.d"
          :fill="fillFor(code)"
          stroke="#b1bac8"
          stroke-width="0.6"
          vector-effect="non-scaling-stroke"
          class="cursor-pointer"
          @mouseenter="hoveredCode = code"
          @mouseleave="hoveredCode = null"
          @click="onCountryClick(code)"
        />
        <!-- 聚焦地区高亮 (放大态): 在所有国家之上叠一层深色描边 + 微填充, 一眼看出选中哪个 -->
        <path
          v-if="focusedCode && !showPanel && WORLD_COUNTRIES[focusedCode]"
          :d="WORLD_COUNTRIES[focusedCode].d"
          fill="rgba(16,185,129,0.18)"
          stroke="#047857"
          stroke-width="1.8"
          stroke-linejoin="round"
          vector-effect="non-scaling-stroke"
          class="pointer-events-none"
        />
      </g>
    </svg>

    <!-- hover tooltip: 跟随鼠标; 任何地区显示名, 有访客附人数 -->
    <div
      v-if="hoveredCode"
      class="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-gray-900/90 px-2 py-1 text-xs font-medium text-white shadow-lg"
      :style="{ left: tooltipPos.x + 'px', top: (tooltipPos.y - 10) + 'px' }"
    >
      {{ hoveredName }}<template v-if="tooltipCount > 0"> · {{ tooltipCount }} {{ $t('realtime.map.online') }}</template>
    </div>

    <!-- 空态: 没有任何地区有实时访客 -->
    <div
      v-if="total <= 0"
      class="pointer-events-none absolute inset-0 flex items-center justify-center"
    >
      <span class="rounded-full bg-gray-100 px-4 py-1.5 text-xs text-gray-400">
        {{ $t('realtime.map.empty') }}
      </span>
    </div>
  </div>
</template>

<script setup>
/* ============================================================
   WorldMap - 展示 + 精简缩放 (白色主题)
   - 几何来自 ~/utils/world-map (Natural Earth 110m, equirectangular)
   - 缩放/平移用 <g transform>: scale + translate, 坐标系 = viewBox(1000×460)
   - 交互: 点击地区放大居中 / 双击复位 / +- 按钮缩放 (无滚轮、无拖动)
   ============================================================ */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { WORLD_COUNTRIES } from '~/utils/world-map'
import CountryFlag from './CountryFlag.vue'

const props = defineProps({
  /* [{ code: 'US', count: 12 }, ...] — code 为 ISO 3166-1 alpha-2 */
  data: { type: Array, default: () => [] },
  /* [{ minutesAgo: 29, activeUsers: 12 }, ..., { minutesAgo: 0, activeUsers: 8 }] */
  minuteData: { type: Array, default: () => [] },
  /* 左上角总数后缀 (如"最近30分钟", 灰色小字); 空则不显示 */
  periodLabel: { type: String, default: '' },
  /* 右上角刷新倒计时秒数; null 则不显示 */
  countdown: { type: Number, default: null },
  /* flat: 去自身圆角/边框/底色, 融入父级大卡片 (详情页用) */
  flat: { type: Boolean, default: false },
})

const VB_W = 1000
const VB_H = 460
const MAX_SCALE = 8

const { ensureLoaded, nameOf } = useCountryNames()
onMounted(() => { ensureLoaded(); nextTick(updateScrollHint) })

/* ---- code(大写) → count 映射 (容错: count 或 activeUsers 都认) ---- */
const countMap = computed(() => {
  const m = {}
  for (const r of props.data || []) {
    const code = String(r?.code || '').toUpperCase()
    const n = Number(r?.count ?? r?.activeUsers)
    if (code && n > 0) m[code] = (m[code] || 0) + n
  }
  return m
})

const maxCount = computed(() => Math.max(1, ...Object.values(countMap.value)))
const total = computed(() => Object.values(countMap.value).reduce((a, b) => a + b, 0))

/* ---- 左下角国家列表: 有访客的地区按人数降序 (PC 端展示) ---- */
const countryList = computed(() =>
  Object.entries(countMap.value)
    .map(([code, count]) => ({ code, count, name: nameOf(code) || code }))
    .sort((a, b) => b.count - a.count),
)
function fmtN(n) { return Number(n || 0).toLocaleString() }

/* ---- 分钟柱状图: 同 minutesAgo 合并, 从最早一分钟排到当前分钟 ---- */
const minuteBars = computed(() => {
  const points = new Map()
  for (const row of props.minuteData || []) {
    const rawMinute = String(row?.minutesAgo ?? '').trim()
    if (!/^\d+$/.test(rawMinute)) continue
    const minute = Number(rawMinute)
    const count = Number(row?.activeUsers ?? row?.count) || 0
    points.set(minute, (points.get(minute) || 0) + count)
  }
  return Array.from(points, ([minutesAgo, count]) => ({ minutesAgo, count }))
    .sort((a, b) => b.minutesAgo - a.minutesAgo)
})
const minuteMax = computed(() => Math.max(1, ...minuteBars.value.map((item) => item.count)))
function minuteBarHeight(count) {
  const value = Number(count) || 0
  return value > 0 ? Math.max(6, value / minuteMax.value * 100) : 2
}

/* ---- 列表"可滚动提示": 底部渐变仅在下方还有内容时显示, 滚到底自动隐 ---- */
const listScrollRef = ref(null)
const hasMoreBelow = ref(false)
function updateScrollHint() {
  const el = listScrollRef.value
  hasMoreBelow.value = !!el && (el.scrollHeight - el.scrollTop - el.clientHeight > 2)
}
watch(countryList, () => nextTick(updateScrollHint))

/* ---- 填色: sqrt 平滑亮度, 无数据走浅灰 ---- */
function fillFor(code) {
  const c = countMap.value[code] || 0
  if (c <= 0) return '#e8edf4'
  const r = Math.sqrt(c / maxCount.value)
  return `rgba(16,185,129,${(0.3 + 0.6 * r).toFixed(3)})`
}

/* ---- hover tooltip ---- */
const hoveredCode = ref(null)
const hoveredName = computed(() => (hoveredCode.value ? nameOf(hoveredCode.value) : ''))
const tooltipCount = computed(() => (hoveredCode.value ? (countMap.value[hoveredCode.value] || 0) : 0))
const tooltipPos = ref({ x: 0, y: 0 })
const mapEl = ref(null)
function onMove(e) {
  if (!mapEl.value) return
  const rect = mapEl.value.getBoundingClientRect()
  tooltipPos.value = { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

/* ============================================================
   缩放: <g transform="translate(tx ty) scale(scale)">
   仅三种入口 — 点击地区放大居中 / 双击复位 / +- 按钮
   ============================================================ */
const scale = ref(1)
const tx = ref(0)
const ty = ref(0)

/* 左下浮层可见性: 仅全球视图(scale=1)显示; 放大某地区后渐隐, 双击复位再渐显 */
const showPanel = computed(() => scale.value <= 1)

/* 当前聚焦地区 (点击放大的那个国家): 放大态下叠高亮描边, 复位清空 */
const focusedCode = ref(null)

/* 平移边界: scale=1 锁 0; 放大后不露白边 */
function clampPan() {
  tx.value = Math.min(0, Math.max(VB_W * (1 - scale.value), tx.value))
  ty.value = Math.min(0, Math.max(VB_H * (1 - scale.value), ty.value))
}

/* 以 (ox, oy)(viewBox 坐标) 为锚点缩放, 锚点位置不动 */
function applyZoom(factor, ox, oy) {
  const newK = Math.min(MAX_SCALE, Math.max(1, scale.value * factor))
  if (newK === scale.value) return
  tx.value = ox - (ox - tx.value) / scale.value * newK
  ty.value = oy - (oy - ty.value) / scale.value * newK
  scale.value = newK
  clampPan()
}

/* 按钮缩放: 以地图中心为锚点 */
function zoomBy(factor) { applyZoom(factor, VB_W / 2, VB_H / 2) }

/* 点击地区: 放大并把该地区质心移到地图中心 */
function onCountryClick(code) {
  const geo = WORLD_COUNTRIES[code]
  if (!geo) return
  focusedCode.value = code
  const targetScale = Math.max(scale.value, 3.5)
  scale.value = targetScale
  tx.value = VB_W / 2 - geo.cx * targetScale
  ty.value = VB_H / 2 - geo.cy * targetScale
  clampPan()
}

/* 双击: 复位全球 */
function resetView() { scale.value = 1; tx.value = 0; ty.value = 0; focusedCode.value = null }
</script>
