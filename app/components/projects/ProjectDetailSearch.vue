<script setup>
/* ============================================================
   ProjectDetailSearch - Search 聚合详情 (GSC + Bing)
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
  projectKey: { type: [String, Object], required: true },
  period:     { type: String, default: '7days' },
  filters:    { type: Array,  default: () => [] },
  project:    { type: Object, default: null },
  dataSources: { type: Array, default: () => [] },
})

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const api = useApi()
const countryNames = useCountryNames()
onMounted(() => countryNames.ensureLoaded())

const PROVIDER_ICON = {
  gsc: '/images/icon/google-search-console.svg',
  bing: '/images/icon/bing-webmaster.svg',
}
const SEARCH_PROVIDER_IDS = ['gsc', 'bing']

const mountedSearchProviders = computed(() => {
  const mounted = new Set(
    (props.dataSources || [])
      .map((d) => String(d?.provider || '').trim())
      .filter((p) => SEARCH_PROVIDER_IDS.includes(p)),
  )
  return SEARCH_PROVIDER_IDS.filter((p) => mounted.has(p))
})

const hasMultipleSearchProviders = computed(() => mountedSearchProviders.value.length > 1)

function searchProviderFilterValue() {
  const value = String((props.filters || []).find((f) => f?.dim === 'searchProvider')?.value || '').trim()
  return mountedSearchProviders.value.includes(value) ? value : ''
}

const currentProvider = computed(() => {
  if (mountedSearchProviders.value.length === 1) return mountedSearchProviders.value[0]
  return searchProviderFilterValue() || 'all'
})

const FIELDS = [
  { key: 'clicks',      labelKey: 'metrics.card.clicks',      format: 'int',     icon: 'ri:cursor-line' },
  { key: 'impressions', labelKey: 'metrics.card.impressions', format: 'int',     icon: 'ri:eye-2-line' },
  { key: 'ctr',         labelKey: 'metrics.card.ctr',         format: 'rate',    icon: 'ri:percent-line' },
  { key: 'position',    labelKey: 'metrics.card.position',    format: 'decimal', icon: 'ri:bar-chart-2-line', inverted: true },
]

function formatInt(v) {
  const n = Number(v) || 0
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 10_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
  return n.toLocaleString()
}
function formatRate(v) {
  return ((Number(v) || 0) * 100).toFixed(2) + '%'
}
function formatDecimal(v) {
  const n = Number(v) || 0
  return n > 0 ? n.toFixed(1) : '-'
}
function format(value, kind) {
  if (kind === 'rate') return formatRate(value)
  if (kind === 'decimal') return formatDecimal(value)
  return formatInt(value)
}
function calcDelta(curr, prev) {
  const a = Number(curr) || 0
  const b = Number(prev) || 0
  if (b === 0) return null
  return ((a - b) / b) * 100
}

const summary = ref(null)
const timeseries = ref(null)
const dimsMap = ref({})
const loading = ref({ summary: false, timeseries: false, dimension: false })

const cards = computed(() =>
  FIELDS.map((f) => {
    const value = summary.value?.metrics?.[f.key] ?? 0
    const prev = summary.value?.previous_metrics?.[f.key]
    return {
      key: f.key,
      icon: f.icon,
      label: t(f.labelKey),
      display: format(value, f.format),
      delta: prev === undefined || prev === null ? null : calcDelta(value, prev),
      inverted: !!f.inverted,
    }
  }),
)

const dimensionTitleProvider = computed(() => {
  if (currentProvider.value !== 'all') return currentProvider.value
  return mountedSearchProviders.value.length === 1 ? mountedSearchProviders.value[0] : ''
})
const dimensionRowProviderIcons = computed(() =>
  currentProvider.value === 'all' && hasMultipleSearchProviders.value,
)

const searchQueryCountMetrics = computed(() => [
  { field: 'clicks', icon: 'ri:cursor-line', color: metricColor('clicks'), label: t('metrics.card.clicks') },
  { field: 'impressions', icon: 'ri:eye-2-line', color: metricColor('impressions'), label: t('metrics.card.impressions') },
  { field: 'ctr', icon: 'ri:pie-chart-line', color: metricColor('ctr'), label: t('metrics.card.ctr'), format: 'rate1', hideOnMobile: true },
])

const LS_KEY = 'galite:detail-search:metrics'
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

const FULL_DIM = { key: 'query', apiDim: 'query', titleKey: 'projects.dim.search_queries', count: 'impressions' }
const SUB_DIMS = [
  { key: 'page',             apiDim: 'page',             titleKey: 'projects.dim.top_pages',         count: 'impressions' },
  { key: 'country',          apiDim: 'country',          titleKey: 'projects.dim.countries',         count: 'impressions' },
  { key: 'device',           apiDim: 'device',           titleKey: 'projects.dim.devices',           count: 'impressions' },
  { key: 'searchAppearance', apiDim: 'searchAppearance', titleKey: 'projects.dim.search_appearance', count: 'impressions' },
]
const ALL_DIMS = [FULL_DIM, ...SUB_DIMS]

function filtersToUrlPart() {
  if (!props.filters?.length) return ''
  return props.filters.filter((f) => f?.dim !== 'searchProvider').map((f) =>
    `&f=${encodeURIComponent(`${f.dim}:${f.match}:${f.value}`)}`,
  ).join('')
}

function baseQuery() {
  return `period=${encodeURIComponent(props.period)}&sp=${encodeURIComponent(currentProvider.value)}${filtersToUrlPart()}`
}

async function fetchSummary() {
  const pk = unref(props.projectKey)
  if (!pk) return
  return withMinLoading((v) => { loading.value.summary = v }, async () => {
    const res = await api.get(`/api/metrics/${pk}/search/summary?${baseQuery()}`).catch(() => null)
    summary.value = res?.code === 200 ? res.data : null
  })
}

function timeseriesMetrics(metrics) {
  const out = new Set(metrics)
  if (out.has('ctr')) {
    out.add('clicks')
    out.add('impressions')
  }
  if (out.has('position')) out.add('impressions')
  return Array.from(out)
}

function sourcePoints(source) {
  return Array.isArray(source?.points) ? source.points : []
}

function metricPayloadMap(results, metrics) {
  const map = new Map()
  metrics.forEach((metric, idx) => {
    const res = results[idx]
    if (res?.code === 200) map.set(metric, res.data || {})
  })
  return map
}

function providerIdsFrom(payloads) {
  const ids = new Set()
  for (const payload of payloads.values()) {
    for (const source of (payload?.series || [])) {
      const provider = String(source?.source_id || '').trim()
      if (provider) ids.add(provider)
    }
  }
  return [
    ...SEARCH_PROVIDER_IDS.filter((id) => ids.has(id)),
    ...Array.from(ids).filter((id) => !SEARCH_PROVIDER_IDS.includes(id)),
  ]
}

function sourceByProvider(payload, provider) {
  return (payload?.series || []).find((s) => s?.source_id === provider) || null
}

function providerPoint(payloads, provider, metric, index) {
  const source = sourceByProvider(payloads.get(metric), provider)
  return Number(sourcePoints(source)[index]) || 0
}

function aggregateMetric(payloads, providers, labels, metric) {
  return labels.map((_, index) => {
    if (metric === 'ctr') {
      const clicks = providers.reduce((sum, p) => sum + providerPoint(payloads, p, 'clicks', index), 0)
      const impressions = providers.reduce((sum, p) => sum + providerPoint(payloads, p, 'impressions', index), 0)
      return impressions > 0 ? clicks / impressions : 0
    }
    if (metric === 'position') {
      let weighted = 0
      let impressions = 0
      for (const provider of providers) {
        const imp = providerPoint(payloads, provider, 'impressions', index)
        const pos = providerPoint(payloads, provider, 'position', index)
        if (imp > 0 && pos > 0) {
          weighted += pos * imp
          impressions += imp
        }
      }
      return impressions > 0 ? weighted / impressions : 0
    }
    return providers.reduce((sum, p) => sum + providerPoint(payloads, p, metric, index), 0)
  })
}

async function fetchTimeseries() {
  const pk = unref(props.projectKey)
  if (!pk || !selectedMetrics.value.length) return
  return withMinLoading((v) => { loading.value.timeseries = v }, async () => {
    const metrics = [...selectedMetrics.value]
    const requestMetrics = timeseriesMetrics(metrics)
    const results = await Promise.all(
      requestMetrics.map((m) =>
        api.get(`/api/metrics/${pk}/search/timeseries?${baseQuery()}&metric=${encodeURIComponent(m)}`).catch(() => null),
      ),
    )
    const baseLabels = results.find((r) => r?.code === 200)?.data?.labels || []
    if (!baseLabels.length) {
      timeseries.value = null
      return
    }
    const payloads = metricPayloadMap(results, requestMetrics)
    const providers = providerIdsFrom(payloads)
    if (!providers.length) {
      timeseries.value = null
      return
    }
    const series = metrics.map((m) => ({
      metric: m,
      label: t(`metrics.card.${m}`),
      color: metricColor(m),
      data: aggregateMetric(payloads, providers, baseLabels, m),
    }))

    timeseries.value = { period: props.period, granularity: 'day', labels: baseLabels, series, tooltipSeries: series }
  })
}

async function fetchAllDimensions() {
  const pk = unref(props.projectKey)
  if (!pk) return
  return withMinLoading((v) => { loading.value.dimension = v }, async () => {
    const results = await Promise.all(
      ALL_DIMS.map((d) =>
        api.get(`/api/metrics/${pk}/search/dimension?${baseQuery()}&dimension=${d.apiDim}`)
          .then((res) => res?.code === 200 ? (res.data?.rows || []) : [])
          .catch(() => []),
      ),
    )
    const next = {}
    ALL_DIMS.forEach((d, i) => { next[d.key] = results[i] })
    dimsMap.value = next
  })
}

async function refetchAll() {
  await Promise.all([fetchSummary(), fetchTimeseries(), fetchAllDimensions()])
}

defineExpose({ refetchAll })

watch(() => [props.period, props.filters, unref(props.projectKey), currentProvider.value], () => {
  refetchAll()
}, { deep: true })

onMounted(() => {
  selectedMetrics.value = loadSelectedMetrics()
  refetchAll()
})

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
    provider: dim.key === 'query' ? dimensionTitleProvider.value : '',
    rowProviderIcons: dim.key === 'query' ? dimensionRowProviderIcons.value : false,
    countMetrics: dim.key === 'query' ? searchQueryCountMetrics.value : [],
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
    <section class="mt-2">
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div v-for="m in cards" :key="m.key" class="rounded-xl border border-gray-200 bg-white p-4">
          <div class="flex h-5 items-center justify-between gap-2">
            <div class="flex min-w-0 items-center gap-1.5 text-sm font-medium leading-5 text-gray-500">
              <NuxtIcon :name="m.icon" class="size-4 shrink-0" />
              <span class="truncate">{{ m.label }}</span>
            </div>
            <button
              type="button"
              :class="[
                'flex size-4 shrink-0 items-center justify-center rounded transition-colors',
                isSelected(m.key) ? 'border-0' : 'border border-gray-300 bg-white hover:border-gray-400',
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
            <div class="mt-2 text-3xl font-semibold leading-9 text-gray-900 tabular-nums">{{ m.display }}</div>
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
                <template v-if="m.delta === null || m.delta === 0">-</template>
                <template v-else>{{ m.delta > 0 ? '+' : '' }}{{ m.delta.toFixed(1) }}%</template>
              </span>
            </div>
          </template>
        </div>
      </div>
    </section>

    <section class="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
      <TimeseriesChart :data="timeseries" :loading="loading.timeseries" :expected-series-count="Math.max(1, selectedMetrics.length)" />
    </section>

    <section class="mt-6">
      <BarList
        :title="$t(FULL_DIM.titleKey)"
        :data="dimsMap[FULL_DIM.key] || []"
        :loading="loading.dimension"
        :count-field="FULL_DIM.count"
        :dim="FULL_DIM.key"
        :provider="dimensionTitleProvider"
        :row-provider-icons="dimensionRowProviderIcons"
        :count-metrics="searchQueryCountMetrics"
        @view-more="openDimDetail(FULL_DIM)"
      />
    </section>

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

    <DimensionDetailModal
      :visible="!!dimModalData"
      :title="dimModalData?.title || ''"
      :rows="dimModalData?.rows || []"
      :count-field="dimModalData?.countField || 'impressions'"
      :dim="dimModalData?.key || ''"
      :provider="dimModalData?.provider || ''"
      :row-provider-icons="dimModalData?.rowProviderIcons || false"
      :count-metrics="dimModalData?.countMetrics || []"
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
