<script setup>
/* ===================================================================
 * PublicProjectDetailPanel
 *
 * 公开站点详情只消费 public metrics DTO:
 * - full: 顶部指标 + 曲线 + 8 维度 + 实时 + 漏斗
 * - core: 顶部指标 + 曲线
 * =================================================================== */

import { computed, onMounted, ref } from 'vue'
import { metricColor } from '~/utils/metric-colors'
import { alpha3ToAlpha2 } from '~/utils/country-code-map'
import SummaryCards from '~/components/metrics/SummaryCards.vue'
import TimeseriesChart from '~/components/metrics/TimeseriesChart.vue'
import BarList from '~/components/metrics/BarList.vue'
import CountryFlag from '~/components/metrics/CountryFlag.vue'
import DimensionDetailModal from '~/components/metrics/DimensionDetailModal.vue'
import WorldMap from '~/components/metrics/WorldMap.vue'
import FunnelCard from '~/components/funnels/FunnelCard.vue'

const props = defineProps({
  metrics: { type: Object, default: () => ({}) },
  full:    { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  dimensionsLoading: { type: Boolean, default: false },
  realtimeLoading: { type: Boolean, default: false },
  funnelsLoading: { type: Boolean, default: false },
})

const { t } = useI18n()
const countryNames = useCountryNames()
onMounted(() => countryNames.ensureLoaded())

const TRAFFIC_DEFAULT = ['screenPageViews', 'totalUsers']
const SEARCH_DEFAULT = ['clicks', 'impressions']

const selectedTrafficMetrics = ref(TRAFFIC_DEFAULT)
const selectedSearchMetrics = ref(SEARCH_DEFAULT)
const activeDimensionKey = ref('')

const DIM_CONFIGS = [
  { key: 'sessionSource',              titleKey: 'projects.dim.traffic_sources', count: 'screenPageViews' },
  { key: 'pagePath',                   titleKey: 'projects.dim.top_pages',       count: 'screenPageViews' },
  { key: 'eventName',                  titleKey: 'projects.dim.events',          count: 'eventCount' },
  { key: 'country',                    titleKey: 'projects.dim.countries',       count: 'screenPageViews' },
  { key: 'browser',                    titleKey: 'projects.dim.browsers',        count: 'screenPageViews' },
  { key: 'operatingSystem',            titleKey: 'projects.dim.os',              count: 'screenPageViews' },
  { key: 'deviceCategory',             titleKey: 'projects.dim.devices',         count: 'screenPageViews' },
  { key: 'sessionDefaultChannelGroup', titleKey: 'projects.dim.channels',        count: 'screenPageViews' },
]

const trafficSummary = computed(() => props.metrics?.traffic?.summary || {})
const searchSummary = computed(() => props.metrics?.search?.summary || {})
const trafficMetricSeries = computed(() => props.metrics?.traffic?.timeseries_metrics || {})

const trafficCardsMetrics = computed(() => trafficSummary.value.metrics || {})
const trafficPreviousMetrics = computed(() => trafficSummary.value.previous_metrics || {})

function metricSeriesSource(metric) {
  return trafficMetricSeries.value?.[metric] || (
    props.metrics?.traffic?.timeseries?.metric === metric ? props.metrics.traffic.timeseries : null
  )
}

function chartLabels(sources) {
  return sources.find((source) => source?.labels?.length)?.labels || []
}

function sourceData(source, labels) {
  const data = source?.series?.[0]?.data || []
  return labels.map((_, index) => Number(data[index]) || 0)
}

const trafficChartData = computed(() => {
  const sources = selectedTrafficMetrics.value.map(metricSeriesSource).filter(Boolean)
  const labels = chartLabels(sources)
  return {
    period: props.metrics?.period || trafficSummary.value.period || '28days',
    granularity: 'day',
    labels,
    series: selectedTrafficMetrics.value
      .map((metric) => {
        const source = metricSeriesSource(metric)
        if (!source) return null
        return {
          metric,
          label: t(`metrics.card.${trafficLabelKey(metric)}`),
          color: metricColor(metric),
          data: sourceData(source, labels),
        }
      })
      .filter(Boolean),
  }
})

const searchMetrics = computed(() => searchSummary.value.metrics || {})
const searchPreviousMetrics = computed(() => searchSummary.value.previous_metrics || {})

function searchSeriesSource(metric) {
  if (metric === 'impressions') return props.metrics?.search?.timeseries_impressions || null
  return props.metrics?.search?.timeseries_clicks || props.metrics?.search?.timeseries || null
}

const searchChartData = computed(() => {
  const sources = selectedSearchMetrics.value.map(searchSeriesSource).filter(Boolean)
  const labels = chartLabels(sources)
  return {
    period: props.metrics?.period || searchSummary.value.period || '28days',
    granularity: 'day',
    labels,
    series: selectedSearchMetrics.value
      .map((metric) => {
        const source = searchSeriesSource(metric)
        if (!source) return null
        return {
          metric,
          label: t(`metrics.card.${searchLabelKey(metric)}`),
          color: metricColor(metric),
          data: sourceData(source, labels),
        }
      })
      .filter(Boolean),
  }
})

function seriesHasValue(source) {
  return (source?.series || []).some((series) =>
    (series?.data || series?.points || []).some((value) => Number(value) > 0),
  )
}

const hasSearch = computed(() => {
  const metricHit = Object.values(searchMetrics.value).some((value) => Number(value) > 0)
  const seriesHit =
    seriesHasValue(props.metrics?.search?.timeseries_clicks)
    || seriesHasValue(props.metrics?.search?.timeseries_impressions)
    || seriesHasValue(props.metrics?.search?.timeseries)
  const dimensions = props.metrics?.search?.dimensions || {}
  const dimensionHit = Object.values(dimensions).some((block) => (block?.rows || []).length > 0)
  return metricHit || seriesHit || dimensionHit
})
const showSearchSection = computed(() => !props.full && (props.loading || hasSearch.value))

const searchCards = computed(() => [
  { key: 'clicks',      icon: 'ri:cursor-line',     label: t('metrics.card.clicks'),      format: 'int' },
  { key: 'impressions', icon: 'ri:eye-2-line',      label: t('metrics.card.impressions'), format: 'int' },
  { key: 'ctr',         icon: 'ri:percent-line',    label: t('metrics.card.ctr'),         format: 'rate' },
  { key: 'position',    icon: 'ri:bar-chart-2-line', label: t('metrics.card.position'),   format: 'decimal', inverted: true },
].map((item) => ({
  ...item,
  display: formatValue(searchMetrics.value[item.key], item.format),
  delta: calcDelta(searchMetrics.value[item.key], searchPreviousMetrics.value[item.key]),
  selected: selectedSearchMetrics.value.includes(item.key),
  selectable: ['clicks', 'impressions'].includes(item.key),
})))

const dimensionBlocks = computed(() => {
  if (!props.full) return []
  const traffic = props.metrics?.traffic?.dimensions || {}
  return DIM_CONFIGS.map((item) => ({
    key: item.key,
    title: t(item.titleKey),
    rows: traffic[item.key]?.rows || [],
    count: item.count,
    dim: item.key,
  }))
})

const searchQueryBlock = computed(() => {
  if (!props.full || (!hasSearch.value && !props.dimensionsLoading)) return null
  return {
    key: 'search-query',
    title: t('projects.dim.search_queries'),
    rows: props.metrics?.search?.dimensions?.query?.rows || [],
    count: 'impressions',
    dim: 'gscQuery',
  }
})

const realtime = computed(() => props.metrics?.realtime || null)
const realtimeGeo = computed(() =>
  (realtime.value?.by_country || []).map((row) => ({
    code: row.code,
    count: row.activeUsers,
  })),
)
const realtimeBlocks = computed(() => {
  if (!props.full || !realtime.value) return []
  return [
    { key: 'rtPages', title: t('realtime.detail.top_pages'), rows: realtime.value.by_page || [], count: 'activeUsers' },
    { key: 'rtEvents', title: t('realtime.detail.top_events'), rows: realtime.value.by_event || [], count: 'eventCount' },
    { key: 'rtDevices', title: t('realtime.detail.top_devices'), rows: realtime.value.by_device || [], count: 'activeUsers', dim: 'deviceCategory' },
    { key: 'rtCities', title: t('realtime.detail.top_cities'), rows: realtime.value.by_city || [], count: 'activeUsers' },
  ]
})
const showRealtime = computed(() => props.full && (props.realtimeLoading || realtime.value))

const funnels = computed(() => props.metrics?.funnels || null)
const funnelList = computed(() => funnels.value?.list || [])
const funnelResults = computed(() => funnels.value?.results || {})
const showFunnels = computed(() => props.full && (props.funnelsLoading || funnelList.value.length > 0))

const allDimensionBlocks = computed(() => [
  ...dimensionBlocks.value,
  ...(searchQueryBlock.value ? [searchQueryBlock.value] : []),
  ...realtimeBlocks.value,
])

const activeDimension = computed(() =>
  allDimensionBlocks.value.find((block) => block.key === activeDimensionKey.value) || null,
)

function trafficLabelKey(metric) {
  if (metric === 'screenPageViews') return 'page_views'
  if (metric === 'totalUsers') return 'visitors'
  if (metric === 'bounceRate') return 'bounce_rate'
  if (metric === 'averageSessionDuration') return 'engagement'
  return metric
}

function searchLabelKey(metric) {
  if (metric === 'impressions') return 'impressions'
  if (metric === 'clicks') return 'clicks'
  if (metric === 'position') return 'position'
  return metric
}

function formatInt(value) {
  const n = Number(value) || 0
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 10_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
  return n.toLocaleString()
}

function formatValue(value, format) {
  const n = Number(value) || 0
  if (format === 'rate') return (n * 100).toFixed(2) + '%'
  if (format === 'decimal') return n > 0 ? n.toFixed(1) : '-'
  return formatInt(n)
}

function calcDelta(curr, prev) {
  const a = Number(curr) || 0
  const b = Number(prev) || 0
  if (!b) return null
  return ((a - b) / b) * 100
}

function toggleSearchMetric(key) {
  if (!['clicks', 'impressions'].includes(key)) return
  if (selectedSearchMetrics.value.length === 1 && selectedSearchMetrics.value[0] === key) return
  selectedSearchMetrics.value = selectedSearchMetrics.value.includes(key)
    ? selectedSearchMetrics.value.filter((item) => item !== key)
    : [...selectedSearchMetrics.value, key]
}

function countryCode(row) {
  const value = String(row?.value || '')
  return value.length === 3 ? alpha3ToAlpha2(value) : value
}
</script>

<template>
  <div>
    <section class="mt-2">
      <SummaryCards
        :metrics="trafficCardsMetrics"
        :previous-metrics="trafficPreviousMetrics"
        :loading="loading"
        v-model:selected-metrics="selectedTrafficMetrics"
      />
    </section>

    <section class="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
      <TimeseriesChart
        :data="trafficChartData"
        :loading="loading"
        :expected-series-count="selectedTrafficMetrics.length"
      />
    </section>

    <section v-if="showSearchSection" class="mt-6">
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <button
          v-for="card in searchCards"
          :key="card.key"
          type="button"
          :class="[
            'rounded-xl border border-gray-200 bg-white p-4 text-left',
            card.selectable ? 'transition-colors hover:border-gray-300' : 'cursor-default',
          ]"
          @click="toggleSearchMetric(card.key)"
        >
          <div class="flex h-5 items-center justify-between gap-2">
            <div class="flex min-w-0 items-center gap-1.5 text-sm font-medium leading-5 text-gray-500">
              <NuxtIcon :name="card.icon" class="size-4 shrink-0" />
              <span class="truncate">{{ card.label }}</span>
            </div>
            <span
              v-if="card.selectable"
              class="flex size-4 shrink-0 items-center justify-center rounded"
              :style="card.selected ? { background: metricColor(card.key) } : {}"
              :class="card.selected ? '' : 'border border-gray-300 bg-white'"
            >
              <NuxtIcon v-if="card.selected" name="ri:check-line" class="size-3 text-white" />
            </span>
          </div>
          <div v-if="loading" class="mt-3 h-8 w-28 animate-pulse rounded bg-gray-100"></div>
          <div v-else class="mt-2 text-3xl font-semibold leading-9 text-gray-900 tabular-nums">
            {{ card.display }}
          </div>
          <div v-if="loading" class="mt-2 h-4 w-16 animate-pulse rounded bg-gray-50"></div>
          <div v-else class="mt-1 flex h-5 items-center text-sm leading-5">
            <span
              :class="[
                card.delta === null ? 'text-gray-400' :
                (card.inverted ? card.delta < 0 : card.delta > 0) ? 'text-emerald-600' :
                (card.inverted ? card.delta > 0 : card.delta < 0) ? 'text-red-500' : 'text-gray-400',
              ]"
            >
              <template v-if="card.delta === null || card.delta === 0">-</template>
              <template v-else>{{ card.delta > 0 ? '+' : '' }}{{ card.delta.toFixed(1) }}%</template>
            </span>
          </div>
        </button>
      </div>

      <div class="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
        <TimeseriesChart
          :data="searchChartData"
          :loading="loading"
          :expected-series-count="selectedSearchMetrics.length"
        />
      </div>
    </section>

    <section v-if="full" class="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      <BarList
        v-for="block in dimensionBlocks"
        :key="block.key"
        :title="block.title"
        :data="block.rows"
        :loading="dimensionsLoading"
        :count-field="block.count"
        :dim="block.dim || ''"
        @view-more="activeDimensionKey = block.key"
      >
        <template v-if="block.dim === 'country'" #label="{ row }">
          <div class="flex min-w-0 items-center gap-2">
            <CountryFlag :code="countryCode(row)" :size="16" />
            <span class="truncate text-sm text-gray-700">
              {{ countryNames.nameOf(countryCode(row)) || row.value }}
            </span>
          </div>
        </template>
      </BarList>
    </section>

    <section v-if="full && searchQueryBlock" class="mt-6">
      <BarList
        :title="searchQueryBlock.title"
        :data="searchQueryBlock.rows"
        :loading="dimensionsLoading"
        :count-field="searchQueryBlock.count"
        :dim="searchQueryBlock.dim"
        @view-more="activeDimensionKey = searchQueryBlock.key"
      />
    </section>

    <section v-if="showRealtime" class="mt-6 overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <template v-if="realtimeLoading">
        <div class="p-5">
          <div class="h-5 w-28 animate-pulse rounded bg-gray-100"></div>
          <div class="mt-4 h-[360px] animate-pulse rounded-xl bg-gray-50"></div>
        </div>
        <div class="grid grid-cols-1 gap-px border-t border-gray-100 bg-gray-100 md:grid-cols-2 xl:grid-cols-4">
          <div v-for="i in 4" :key="i" class="bg-white p-4">
            <div class="h-5 w-24 animate-pulse rounded bg-gray-100"></div>
            <div class="mt-4 space-y-3">
              <div v-for="j in 5" :key="j" class="h-4 animate-pulse rounded bg-gray-50"></div>
            </div>
          </div>
        </div>
      </template>
      <template v-else>
        <WorldMap
          flat
          :data="realtimeGeo"
          :minute-data="realtime?.by_minute || []"
          :period-label="$t('realtime.map.last_30min')"
        />
        <div class="grid grid-cols-1 gap-px border-t border-gray-100 bg-gray-100 md:grid-cols-2 xl:grid-cols-4">
          <BarList
            v-for="block in realtimeBlocks"
            :key="block.key"
            flat
            :title="block.title"
            :data="block.rows"
            :count-field="block.count"
            :dim="block.dim || ''"
            @view-more="activeDimensionKey = block.key"
          />
        </div>
      </template>
    </section>

    <section v-if="showFunnels" class="mt-6">
      <div v-if="funnelsLoading" class="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <FunnelCard v-for="i in 2" :key="i" skeleton :actions="false" />
      </div>
      <div v-else class="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <FunnelCard
          v-for="funnel in funnelList"
          :key="funnel.funnel_key"
          :funnel="funnel"
          :result="funnelResults[funnel.funnel_key] || null"
          :actions="false"
        />
      </div>
    </section>

    <DimensionDetailModal
      :visible="!!activeDimension"
      :title="activeDimension?.title || ''"
      :rows="activeDimension?.rows || []"
      :count-field="activeDimension?.count || 'screenPageViews'"
      :dim="activeDimension?.dim || ''"
      @close="activeDimensionKey = ''"
    >
      <template v-if="activeDimension?.dim === 'country'" #label="{ row }">
        <div class="flex min-w-0 items-center gap-2">
          <CountryFlag :code="countryCode(row)" :size="16" />
          <span class="truncate text-sm text-gray-700">
            {{ countryNames.nameOf(countryCode(row)) || row.value }}
          </span>
        </div>
      </template>
    </DimensionDetailModal>
  </div>
</template>
