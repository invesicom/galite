<template>
  <div :class="shellClass">
    <div v-if="unavailable" class="flex h-full min-h-40 items-center justify-center text-sm text-gray-500">
      Widget unavailable
    </div>
    <template v-else>
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="truncate text-sm font-semibold">{{ title }}</div>
          <div v-if="subtitle" class="mt-0.5 truncate text-xs opacity-60">{{ subtitle }}</div>
        </div>
        <span class="shrink-0 rounded-full border px-2 py-0.5 text-[11px] opacity-70">Verified</span>
      </div>

      <div v-if="widget.widget_type === 'timeseries'" class="mt-2">
        <PublicSparkline :data="timeseries" :color="accentColor" />
      </div>
      <div v-else-if="widget.widget_type === 'profile_summary'" class="mt-4 grid grid-cols-2 gap-2">
        <PublicMetricCard label="Visitors" :value="profileTraffic.totalUsers" />
        <PublicMetricCard label="Pageviews" :value="profileTraffic.screenPageViews" />
        <PublicMetricCard label="Clicks" :value="profileSearch.clicks" />
        <PublicMetricCard label="Impressions" :value="profileSearch.impressions" />
      </div>
      <div v-else-if="widget.widget_type === 'search_card'" class="mt-4 grid grid-cols-3 gap-2">
        <PublicMetricCard label="Clicks" :value="projectSearch.clicks" />
        <PublicMetricCard label="Impressions" :value="projectSearch.impressions" />
        <PublicMetricCard label="CTR" :value="projectSearch.ctr" format="percent" />
      </div>
      <div v-else class="mt-5">
        <div class="text-4xl font-semibold tracking-tight">{{ formatMetric(metricValue) }}</div>
        <div class="mt-1 text-xs opacity-60">{{ metricLabel }}</div>
      </div>

      <div class="mt-3 text-[11px] opacity-50">Verified by Galite</div>
    </template>
  </div>
</template>

<script setup>
definePageMeta({ layout: 'widget' })

const route = useRoute()
const requestFetch = useRequestFetch()
const widgetKey = computed(() => String(route.params.widgetKey || ''))

const { data: res } = await useAsyncData(
  () => `widget:${widgetKey.value}`,
  () => requestFetch(`/api/widgets/${encodeURIComponent(widgetKey.value)}`),
)

const payload = computed(() => res.value?.data || {})
const unavailable = computed(() => payload.value.status !== 'ok')
const widget = computed(() => payload.value.widget || {})
const data = computed(() => payload.value.data || {})

const accentColor = computed(() => widget.value.accent_color || 'var(--color-primary)')
const isDark = computed(() => widget.value.theme === 'dark')
const shellClass = computed(() => [
  'min-h-screen overflow-hidden p-4 text-gray-900',
  isDark.value ? 'bg-gray-950 text-white' : 'bg-white',
])

const title = computed(() => widget.value.title || defaultTitle.value)
const subtitle = computed(() => widget.value.period ? widget.value.period.replace('days', 'd') : '')

const projectTraffic = computed(() => data.value.traffic?.summary?.metrics || {})
const projectSearch = computed(() => data.value.search?.summary?.metrics || {})
const profileTraffic = computed(() => data.value.traffic?.summary?.metrics || {})
const profileSearch = computed(() => data.value.search?.summary?.metrics || {})

const metricSource = computed(() => {
  const metric = widget.value.metric || 'totalUsers'
  if (['clicks', 'impressions', 'ctr', 'position'].includes(metric)) return projectSearch.value
  return projectTraffic.value
})
const metricValue = computed(() => metricSource.value[widget.value.metric || 'totalUsers'])
const metricLabel = computed(() => labelOf(widget.value.metric || 'totalUsers'))
const timeseries = computed(() => {
  const metric = widget.value.metric || ''
  if (['clicks', 'impressions', 'ctr', 'position'].includes(metric)) return data.value.search?.timeseries || {}
  return data.value.traffic?.timeseries || {}
})
const defaultTitle = computed(() => {
  if (widget.value.widget_type === 'timeseries') return 'Trend'
  if (widget.value.widget_type === 'search_card') return 'Search performance'
  if (widget.value.widget_type === 'profile_summary') return 'Verified profile'
  return metricLabel.value
})

function labelOf(metric) {
  const map = {
    totalUsers: 'Visitors',
    screenPageViews: 'Pageviews',
    activeUsers: 'Active users',
    sessions: 'Sessions',
    clicks: 'Search clicks',
    impressions: 'Search impressions',
    ctr: 'CTR',
    position: 'Position',
  }
  return map[metric] || metric
}

function formatMetric(value) {
  const number = Number(value) || 0
  if (widget.value.metric === 'ctr') return `${(number * 100).toFixed(1)}%`
  if (widget.value.metric === 'position') return number.toFixed(1)
  return Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(number)
}

useHead({
  title: 'Verified widget',
  meta: [{ name: 'robots', content: 'noindex' }],
})
</script>
