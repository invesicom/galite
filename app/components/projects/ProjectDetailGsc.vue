<script setup>
/* ============================================================
   ProjectDetailGsc - GSC 数据源详情页主体
   --
   结构 (与 GA4 详情页主体对称):
     SummaryCards × 4 (clicks / impressions / ctr / position)
       checkbox 驱动 TimeseriesChart 折线叠加
     TimeseriesChart
     BarList × 1 全屏 (Search Queries)
     BarList × 4 网格 (Page / Country / Device / Search Appearance)
     无漏斗 (GSC 无此概念)
   --
   props 共享父级 toolbar 状态:
     projectKey  当前项目 key (computed/ref/string 均可, 内部 unref)
     period      当前周期 (父级 v-model period)
     filters     当前筛选数组 (父级共享, mapGa4FiltersToGsc 在后端转 GSC 形态)
     project     项目元信息 (logo / site_url 等)
   --
   核心: 自管 summary/timeseries/dimsMap, 父级仅决定 dataSource 切换
   ============================================================ */

import { computed, onMounted, ref, unref, watch } from 'vue'
import TimeseriesChart from '~/components/metrics/TimeseriesChart.vue'
import BarList from '~/components/metrics/BarList.vue'
import DimensionDetailModal from '~/components/metrics/DimensionDetailModal.vue'
import CountryFlag from '~/components/metrics/CountryFlag.vue'
import { localizeDimensionValue } from '~/utils/dimension-i18n'
import { metricColor } from '~/utils/metric-colors'
import { withMinLoading } from '~/utils/min-loading'
import { alpha3ToAlpha2 } from '~/utils/country-code-map'

const props = defineProps({
  projectKey: { type: [String, Object], required: true },   /* ref/computed/string */
  period:     { type: String, default: '7days' },
  filters:    { type: Array,  default: () => [] },
  project:    { type: Object, default: null },
})

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const api = useApi()
const countryNames = useCountryNames()
onMounted(() => countryNames.ensureLoaded())

/* ============================================================
   4 核心指标 (clicks / impressions / ctr / position)
     inverted=true 让 position 的 delta 颜色反转 (排名下降=好事=绿)
     format: int / rate (CTR ×100%) / decimal (position 保留 1 位)
   ============================================================ */
const FIELDS = [
  { key: 'clicks',      labelKey: 'metrics.card.clicks',      format: 'int',     icon: 'ri:cursor-line' },
  { key: 'impressions', labelKey: 'metrics.card.impressions', format: 'int',     icon: 'ri:eye-2-line' },
  { key: 'ctr',         labelKey: 'metrics.card.ctr',         format: 'rate',    icon: 'ri:percent-line' },
  { key: 'position',    labelKey: 'metrics.card.position',    format: 'decimal', icon: 'ri:bar-chart-2-line', inverted: true },
]

function formatInt(v) {
  const n = Number(v) || 0
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 10_000)    return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
  return n.toLocaleString()
}
function formatRate(v) {
  return ((Number(v) || 0) * 100).toFixed(2) + '%'
}
function formatDecimal(v) {
  const n = Number(v) || 0
  if (n === 0) return '—'
  return n.toFixed(1)
}
function format(value, kind) {
  if (kind === 'rate')    return formatRate(value)
  if (kind === 'decimal') return formatDecimal(value)
  return formatInt(value)
}

function calcDelta(curr, prev) {
  const a = Number(curr) || 0
  const b = Number(prev) || 0
  if (b === 0) return null
  return ((a - b) / b) * 100
}

/* ============================================================
   状态: summary / timeseries / dimsMap (5 个 GSC 维度) / loading
   ============================================================ */
const summary = ref(null)
const timeseries = ref(null)
const dimsMap = ref({})

const loading = ref({
  summary: false,
  timeseries: false,
  dimension: false,
})

const cards = computed(() =>
  FIELDS.map((f) => {
    const value = summary.value?.metrics?.[f.key] ?? 0
    const prev  = summary.value?.previous_metrics?.[f.key]
    return {
      key:      f.key,
      icon:     f.icon,
      label:    t(f.labelKey),
      display:  format(value, f.format),
      delta:    prev === undefined || prev === null ? null : calcDelta(value, prev),
      inverted: !!f.inverted,
    }
  }),
)

/* ============================================================
   selectedMetrics: checkbox 多选驱动 TimeseriesChart
   默认勾 clicks + impressions (跟 GSC 后台默认一致)
   持久 localStorage (与 GA4 视图独立, key 不同)
   ============================================================ */
const LS_KEY = 'galite:detail-gsc:metrics'
const ALL_METRICS = ['clicks', 'impressions', 'ctr', 'position']
const DEFAULT_METRICS = ['clicks', 'impressions']

function loadSelectedMetrics() {
  if (typeof window === 'undefined') return DEFAULT_METRICS
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return DEFAULT_METRICS
    const arr = JSON.parse(raw)
    const cleaned = Array.isArray(arr) ? arr.filter((m) => ALL_METRICS.includes(m)) : []
    return cleaned.length ? cleaned : DEFAULT_METRICS
  } catch { return DEFAULT_METRICS }
}

const selectedMetrics = ref(DEFAULT_METRICS)

function isSelected(key) { return selectedMetrics.value.includes(key) }
function isLastSelected(key) { return selectedMetrics.value.length === 1 && selectedMetrics.value[0] === key }
function toggleMetric(key) {
  if (isLastSelected(key)) return
  selectedMetrics.value = isSelected(key)
    ? selectedMetrics.value.filter((k) => k !== key)
    : [...selectedMetrics.value, key]
}

watch(selectedMetrics, (v) => {
  if (typeof window !== 'undefined') localStorage.setItem(LS_KEY, JSON.stringify(v))
  fetchTimeseries()
}, { deep: true })

/* ============================================================
   5 维度配置: Search Queries 占全屏, 其他 4 张普通卡
     apiDim 是后端 dimension query 接受的值
   ============================================================ */
/* titleKey 用 GA4 同款简洁名 (不加 "Search/搜索" 后缀),
   GSC 视图本身就是搜索数据上下文, 标题已隐含语义 — 加后缀冗余 */
const FULL_DIM = {
  key:    'query',
  apiDim: 'query',
  titleKey: 'projects.dim.search_queries',
  count:  'impressions',
}
const SUB_DIMS = [
  { key: 'page',             apiDim: 'page',             titleKey: 'projects.dim.top_pages',         count: 'impressions' },
  { key: 'country',          apiDim: 'country',          titleKey: 'projects.dim.countries',         count: 'impressions' },
  { key: 'device',           apiDim: 'device',           titleKey: 'projects.dim.devices',           count: 'impressions' },
  { key: 'searchAppearance', apiDim: 'searchAppearance', titleKey: 'projects.dim.search_appearance', count: 'impressions' },
]
const ALL_DIMS = [FULL_DIM, ...SUB_DIMS]

/* ============================================================
   filters 序列化为 URL 片段 (?f=dim:match:value, 多个并列)
   ============================================================ */
function filtersToUrlPart() {
  if (!props.filters?.length) return ''
  return props.filters.map((f) =>
    `&f=${encodeURIComponent(`${f.dim}:${f.match}:${f.value}`)}`,
  ).join('')
}

/* ============================================================
   fetchSummary: GSC summary (4 指标 + previous)
   ============================================================ */
async function fetchSummary() {
  const pk = unref(props.projectKey)
  if (!pk) return
  return withMinLoading((v) => { loading.value.summary = v }, async () => {
    const url = `/api/metrics/${pk}/gsc/summary?period=${props.period}${filtersToUrlPart()}`
    const res = await api.get(url).catch(() => null)
    if (res?.code === 200) summary.value = res.data
    else summary.value = null
  })
}

/* ============================================================
   fetchTimeseries: selectedMetrics 每个 metric 并发拉一次
     与 [projectKey].vue 的 GA4 fetchTimeseriesMulti 同款逻辑
     合并成单一 timeseries.value 给 TimeseriesChart 渲染多线
   ============================================================ */
async function fetchTimeseries() {
  const pk = unref(props.projectKey)
  if (!pk || !selectedMetrics.value.length) return
  return withMinLoading((v) => { loading.value.timeseries = v }, async () => {
    const metrics = [...selectedMetrics.value]
    const fParts = filtersToUrlPart()
    const results = await Promise.all(
      metrics.map((m) =>
        api.get(`/api/metrics/${pk}/gsc/timeseries?period=${props.period}&metric=${m}${fParts}`)
          .catch(() => null),
      ),
    )
    const baseLabels = results.find((r) => r?.code === 200)?.data?.labels || []
    if (!baseLabels.length) {
      timeseries.value = null
      return
    }
    const series = metrics.map((m, idx) => {
      const res = results[idx]
      const sources = (res?.code === 200 ? res.data?.series : null) || []
      /* GSC timeseries 字段是 points (与 GA4 data 不同) */
      const data = baseLabels.map((_, i) =>
        sources.reduce((sum, s) => sum + (Number(s.points?.[i]) || 0), 0),
      )
      return {
        metric: m,
        label:  t(`metrics.card.${m === 'position' ? 'position' : m}`),
        color:  metricColor(m),
        data,
      }
    }).filter((s) => s.data.length)

    timeseries.value = {
      period:      props.period,
      granularity: 'day',
      labels:      baseLabels,
      series,
    }
  })
}

/* ============================================================
   fetchAllDimensions: 5 个 GSC 维度并发拉
   ============================================================ */
async function fetchAllDimensions() {
  const pk = unref(props.projectKey)
  if (!pk) return
  return withMinLoading((v) => { loading.value.dimension = v }, async () => {
    const fParts = filtersToUrlPart()
    const results = await Promise.all(
      ALL_DIMS.map((d) =>
        api.get(`/api/metrics/${pk}/gsc/dimension?period=${props.period}&dimension=${d.apiDim}${fParts}`)
          .then((res) => res?.code === 200 ? (res.data?.rows || []) : [])
          .catch(() => []),
      ),
    )
    const next = {}
    ALL_DIMS.forEach((d, i) => { next[d.key] = results[i] })
    dimsMap.value = next
  })
}

/* ============================================================
   refetchAll: period / filters / projectKey 任一变化触发
   ============================================================ */
async function refetchAll() {
  await Promise.all([
    fetchSummary(),
    fetchTimeseries(),
    fetchAllDimensions(),
  ])
}

defineExpose({ refetchAll })

watch(() => [props.period, props.filters, unref(props.projectKey)], () => {
  refetchAll()
}, { deep: true })

onMounted(() => {
  selectedMetrics.value = loadSelectedMetrics()
  refetchAll()
})

/* ============================================================
   DimensionDetailModal: URL ?search_dim=xxx 驱动 (Search 专属)
   ============================================================ */
const dimModalData = ref(null)

function buildDimModalData(target) {
  if (!target) return null
  const dim = ALL_DIMS.find((d) => d.key === target)
  if (!dim) return null
  return {
    key: target,
    title: t(dim.titleKey),
    rows: dimsMap.value[target] || [],
    countField: dim.count,
  }
}

watch(() => route.query.search_dim, (v) => {
  dimModalData.value = buildDimModalData(String(v || '').trim())
}, { immediate: true })

watch(dimsMap, () => {
  if (!dimModalData.value) return
  const target = dimModalData.value.key
  dimModalData.value = { ...dimModalData.value, rows: dimsMap.value[target] || [] }
}, { deep: true })

function openDimDetail(d) {
  router.replace({ query: { ...route.query, search_dim: d.key } })
}
function closeDimDetail() {
  const next = { ...route.query }
  delete next.search_dim
  router.replace({ query: next })
}
</script>

<template>
  <div>
    <!-- ============ 4 核心指标卡 ============ -->
    <section class="mt-2">
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div
          v-for="m in cards"
          :key="m.key"
          class="rounded-xl border border-gray-200 bg-white p-4"
        >
          <div class="flex h-5 items-center justify-between gap-2">
            <div class="flex min-w-0 items-center gap-1.5 text-sm font-medium leading-5 text-gray-500">
              <NuxtIcon :name="m.icon" class="size-4 shrink-0" />
              <span class="truncate">{{ m.label }}</span>
            </div>
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
              @click="toggleMetric(m.key)"
            >
              <NuxtIcon v-if="isSelected(m.key)" name="ri:check-line" class="size-3 text-white" />
            </button>
          </div>

          <template v-if="loading.summary">
            <div class="mt-2 h-9 w-2/3 animate-pulse rounded bg-gray-200" />
            <div class="mt-1 h-5 w-1/2 animate-pulse rounded bg-gray-100" />
          </template>
          <template v-else>
            <div class="mt-2 text-3xl font-semibold leading-9 text-gray-900 tabular-nums">
              {{ m.display }}
            </div>
            <div class="mt-1 flex h-5 items-center text-sm leading-5">
              <span
                v-tooltip.bottom="$t('metrics.previous_period')"
                :class="[
                  'cursor-help',
                  m.delta === null ? 'text-gray-400' :
                  (m.inverted ? m.delta < 0 : m.delta > 0) ? 'text-emerald-600' :
                  (m.inverted ? m.delta > 0 : m.delta < 0) ? 'text-red-500' : 'text-gray-400',
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
    </section>

    <!-- ============ 时序图 ============ -->
    <section class="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
      <TimeseriesChart
        :data="timeseries"
        :loading="loading.timeseries"
        :expected-series-count="selectedMetrics.length"
      />
    </section>

    <!-- ============ Search Queries 全屏 ============ -->
    <section class="mt-6">
      <BarList
        :title="$t(FULL_DIM.titleKey)"
        :data="dimsMap[FULL_DIM.key] || []"
        :loading="loading.dimension"
        :count-field="FULL_DIM.count"
        :dim="FULL_DIM.key"
        @view-more="openDimDetail(FULL_DIM)"
      />
    </section>

    <!-- ============ 4 普通维度网格
         country slot: GSC 返 alpha-3 (USA), 转 alpha-2 (US) 给 CountryFlag + countryNames 才能正确显示 ============ -->
    <section class="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <BarList
        v-for="d in SUB_DIMS"
        :key="d.key"
        :title="$t(d.titleKey)"
        :data="dimsMap[d.key] || []"
        :loading="loading.dimension"
        :count-field="d.count"
        :dim="d.key"
        @view-more="openDimDetail(d)"
      >
        <template v-if="d.key === 'country'" #label="{ row }">
          <div class="flex min-w-0 items-center gap-2">
            <CountryFlag :code="alpha3ToAlpha2(row.value)" :size="16" />
            <span class="truncate text-sm text-gray-700">{{ countryNames.nameOf(alpha3ToAlpha2(row.value)) || localizeDimensionValue('country', alpha3ToAlpha2(row.value), t) || row.value }}</span>
          </div>
        </template>
      </BarList>
    </section>

    <!-- ============ Dimension Detail Modal (top 50 全量, country 同款 alpha3 转换) ============ -->
    <DimensionDetailModal
      :visible="!!dimModalData"
      :title="dimModalData?.title || ''"
      :rows="dimModalData?.rows || []"
      :count-field="dimModalData?.countField || 'impressions'"
      :dim="dimModalData?.key || ''"
      @close="closeDimDetail"
    >
      <template v-if="dimModalData?.key === 'country'" #label="{ row }">
        <div class="flex min-w-0 items-center gap-2">
          <CountryFlag :code="alpha3ToAlpha2(row.value)" :size="16" />
          <span class="truncate text-sm text-gray-700">{{ countryNames.nameOf(alpha3ToAlpha2(row.value)) || localizeDimensionValue('country', alpha3ToAlpha2(row.value), t) || row.value }}</span>
        </div>
      </template>
    </DimensionDetailModal>
  </div>
</template>
