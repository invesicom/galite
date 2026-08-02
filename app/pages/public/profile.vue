<template>
  <div class="mx-auto max-w-6xl px-4 pb-8 pt-4 sm:px-6 sm:pb-12 sm:pt-6">
    <PublicPageActions :title="shareTitle" :floating="false" :show-branding="showBranding" />

    <section class="flex flex-col items-center text-center">
      <div class="flex flex-col items-center">
        <div class="flex size-20 items-center justify-center rounded-full bg-gray-100 text-gray-400">
          <NuxtIcon name="ri:user-3-line" class="size-10" />
        </div>

        <h1 class="mt-4 flex max-w-full items-center justify-center gap-1.5 text-2xl font-semibold tracking-tight text-gray-900">
          <span class="truncate">{{ displayName }}</span>
          <button
            v-if="hasVerifiedSources"
            type="button"
            class="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-primary hover:bg-primary/10"
            :aria-label="t('public_profile.verified_badge')"
            v-tooltip.bottom="t('public_profile.verified_badge')"
            @click="certificationOpen = true"
          >
            <NuxtIcon name="ri:verified-badge-fill" class="size-5" />
          </button>
        </h1>

        <p v-if="profile.bio" class="mt-2 max-w-xl text-sm leading-6 text-gray-600">{{ profile.bio }}</p>

        <div v-if="socialLinks.length" class="mt-4 flex flex-wrap items-center justify-center gap-2">
          <a
            v-for="link in socialLinks"
            :key="link.key"
            :href="link.href"
            target="_blank"
            rel="noopener noreferrer"
            class="flex size-9 items-center justify-center rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50"
            :aria-label="link.label"
          >
            <NuxtIcon :name="link.icon" class="size-4" />
          </a>
        </div>
      </div>
    </section>

    <section v-if="profileEmpty" class="mx-auto mt-10 max-w-lg rounded-lg border border-gray-200 px-6 py-10 text-center">
      <div class="mx-auto flex size-12 items-center justify-center rounded-full bg-gray-100">
        <NuxtIcon name="ri:folder-open-line" class="size-6 text-gray-500" />
      </div>
      <h2 class="mt-4 text-xl font-semibold text-gray-900">{{ t('public_profile.empty_projects_title') }}</h2>
      <p class="mt-2 text-sm leading-6 text-gray-500">{{ t('public_profile.empty_projects_desc') }}</p>
    </section>

    <template v-else>
      <section class="mt-8 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <PublicMetricCard :label="t('metrics.card.visitors')" :value="traffic.totalUsers" :loading="summaryLoading" />
        <PublicMetricCard :label="t('metrics.card.page_views')" :value="traffic.screenPageViews" :loading="summaryLoading" />
        <PublicMetricCard :label="t('public_profile.metric_search_clicks')" :value="search.clicks" :loading="summaryLoading" />
        <PublicMetricCard :label="t('metrics.card.impressions')" :value="search.impressions" :loading="summaryLoading" />
        <PublicMetricCard :label="t('public_profile.avg_duration')" :value="traffic.averageSessionDuration" format="duration" :loading="summaryLoading" />
        <PublicMetricCard :label="t('public_profile.projects')" :value="summary.public_projects_count" />
      </section>

      <section class="mt-8">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 class="text-base font-semibold text-gray-900">{{ t('public_profile.verified_growth') }}</h2>
          <div class="flex items-center gap-2">
            <PeriodSwitcher
              v-model="period"
              :options="profilePeriodOptions"
              allow-custom
              @request-custom="customModalVisible = true"
            />
            <RefreshButton
              :loading="projectLoadingCount > 0"
              @refresh="refreshProfileMetrics"
            />
          </div>
        </div>
        <div
          v-if="summaryLoading"
          class="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2"
        >
          <div
            v-for="item in 2"
            :key="item"
            class="rounded-lg border border-gray-200 p-4"
          >
            <div class="h-4 w-20 animate-pulse rounded bg-gray-100" />
            <div class="mt-4 h-40 w-full animate-pulse rounded bg-gray-100" />
          </div>
        </div>
        <div v-else class="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div class="rounded-lg border border-gray-200 p-4">
            <div class="text-sm font-medium text-gray-900">{{ t('public_profile.traffic') }}</div>
            <PublicSparkline :data="metrics.traffic?.timeseries" />
          </div>
          <div class="rounded-lg border border-gray-200 p-4">
            <div class="text-sm font-medium text-gray-900">{{ t('public_profile.search') }}</div>
            <PublicSparkline :data="metrics.search?.timeseries" color="#0f766e" />
          </div>
        </div>
      </section>

      <CustomDateModal
        :visible="customModalVisible"
        :model-value="period"
        @close="customModalVisible = false"
        @apply="onApplyCustom"
      />

      <section class="mt-8">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 class="text-base font-semibold text-gray-900">
            {{ t('public_profile.projects_count', { count: summary.public_projects_count }) }}
          </h2>
          <SortDropdown v-model="projectSort" :options="projectSortOptions" />
        </div>
        <div
          v-if="projectsLoading"
          class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          <div
            v-for="item in projectSkeletonCount"
            :key="item"
            class="rounded-lg border border-gray-200 bg-white p-4"
          >
            <div class="flex items-center gap-3">
              <div class="size-10 animate-pulse rounded bg-gray-100" />
              <div class="min-w-0 flex-1">
                <div class="h-4 w-36 animate-pulse rounded bg-gray-100" />
                <div class="mt-2 h-3 w-24 animate-pulse rounded bg-gray-50" />
              </div>
            </div>
            <div class="mt-5 grid grid-cols-3 gap-3">
              <div v-for="metric in 3" :key="metric">
                <div class="h-3 w-14 animate-pulse rounded bg-gray-50" />
                <div class="mt-2 h-5 w-16 animate-pulse rounded bg-gray-100" />
              </div>
            </div>
            <div class="mt-5 h-20 animate-pulse rounded bg-gray-100" />
          </div>
        </div>
        <div v-else class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <PublicSiteDataCard
            v-for="card in publicSiteCards"
            :key="card.key"
            :profile-slug="profile.slug"
            :project="card.project"
            :variant="card.variant"
            :loading="card.loading"
            :wide="card.wide"
          />
        </div>
      </section>
    </template>

    <footer v-if="!profileEmpty && showBranding" class="mt-12 flex justify-center">
      <NuxtLink
        :to="localePath('/')"
        class="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-900"
      >
        <img v-if="logo.logo_64" :src="logo.logo_64" class="size-6 rounded-md" :alt="siteName" />
        <span v-else class="flex size-6 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-text">
          {{ siteName.slice(0, 1).toUpperCase() }}
        </span>
        {{ t('public_profile.powered_by', { name: siteName }) }}
      </NuxtLink>
    </footer>

    <NuxtLink
      v-if="!profileEmpty && showBranding"
      :to="localePath('/')"
      class="fixed bottom-4 right-4 z-20 hidden items-center gap-2 rounded-full border border-gray-200 bg-white/95 px-3 py-2 text-sm font-medium text-gray-600 backdrop-blur hover:bg-white hover:text-gray-900 md:inline-flex"
      :aria-label="t('public_profile.brand_home', { name: siteName })"
    >
      <img v-if="logo.logo_64" :src="logo.logo_64" class="size-5 rounded-md" :alt="siteName" />
      <span v-else class="flex size-5 items-center justify-center rounded-md bg-primary text-[10px] font-bold text-primary-text">
        {{ siteName.slice(0, 1).toUpperCase() }}
      </span>
      {{ siteName }}
    </NuxtLink>

    <Teleport to="body">
      <div
        v-if="certificationOpen"
        class="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 p-4 backdrop-blur-[3px]"
        @click.self="certificationOpen = false"
      >
        <section class="w-full max-w-sm rounded-xl bg-white p-5 text-left">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="inline-flex items-center gap-1.5 text-base font-semibold text-gray-900">
                <NuxtIcon name="ri:verified-badge-fill" class="size-5 text-primary" />
                <span>{{ t('public_profile.verified_title') }}</span>
              </h3>
              <p class="mt-2 text-sm leading-6 text-gray-500">{{ t('public_profile.verified_desc') }}</p>
            </div>
            <button
              type="button"
              class="flex size-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              :aria-label="t('common.close')"
              @click="certificationOpen = false"
            >
              <NuxtIcon name="ri:close-line" class="size-5" />
            </button>
          </div>

          <div class="mt-5">
            <div class="text-xs font-medium uppercase tracking-wide text-gray-400">{{ t('public_profile.verified_sources') }}</div>
            <div class="mt-2 flex flex-wrap gap-2">
              <span
                v-for="source in verifiedSourceItems"
                :key="source.key"
                class="inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600"
              >
                <NuxtIcon name="ri:verified-badge-line" class="size-3.5 text-primary" />
                {{ source.label }}
              </span>
            </div>
          </div>

          <div v-if="showBranding" class="mt-3 text-center leading-none">
            <NuxtLink
              :to="localePath('/')"
              class="text-xs font-normal text-gray-300 underline underline-offset-4 decoration-gray-300 transition-colors hover:text-blue-600 hover:decoration-blue-600"
            >
              {{ t('public_profile.create_my_profile') }}
            </NuxtLink>
          </div>
        </section>
      </div>
    </Teleport>

    <ToastContainer />
  </div>
</template>

<script setup>
import { buildCustomPeriod } from '~/utils/period'
import PeriodSwitcher from '~/components/metrics/PeriodSwitcher.vue'
import CustomDateModal from '~/components/metrics/CustomDateModal.vue'
import RefreshButton from '~/components/layout/RefreshButton.vue'
import SortDropdown from '~/components/layout/SortDropdown.vue'
import ToastContainer from '~/components/layout/ToastContainer.vue'

definePageMeta({ layout: false })

const route = useRoute()
const requestFetch = useRequestFetch()
const { t, locale } = useI18n()
const localePath = useLocalePath()
const configStore = useConfigStore()
const slug = computed(() => String(route.params.slug || ''))
const period = ref('28days')
const projectSort = ref('priority')
const projectMetricState = ref({})
const certificationOpen = ref(false)
const customModalVisible = ref(false)
const PROJECT_METRIC_CONCURRENCY = 6
let activeRun = 0
let activeAbort = null

const profilePeriodOptions = computed(() => [
  { value: 'today', label: t('metrics.period.today') },
  { value: 'yesterday', label: t('metrics.period.yesterday') },
  { value: '7days', label: t('metrics.period.7days') },
  { value: '28days', label: t('metrics.period.28days') },
  { value: '90days', label: t('metrics.period.90days') },
  { value: '6months', label: t('metrics.period.6months') },
  { value: '1year', label: t('metrics.period.1year') },
])

const { data: profileRes } = await useAsyncData(
  () => `public-profile:${slug.value}`,
  () => requestFetch(`/api/public/profile/${encodeURIComponent(slug.value)}`),
)

if (profileRes.value?.code !== 200) {
  throw createError({ statusCode: 404, statusMessage: 'Profile not found' })
}

const data = computed(() => profileRes.value?.data || {})
const profile = computed(() => data.value.profile || {})
const profileSummary = computed(() => data.value.summary || { verified_sources: [], public_projects_count: 0 })

const { data: projectsRes, pending: projectsPending, refresh: refreshProjects } = await useAsyncData(
  () => `public-profile-projects:${slug.value}`,
  () => requestFetch(`/api/public/profile/${encodeURIComponent(slug.value)}/projects`),
  { lazy: true, server: false },
)

const projectsData = computed(() => projectsRes.value?.data || {})
const summary = computed(() => ({
  ...profileSummary.value,
  ...(projectsData.value.summary || {}),
  verified_sources: profileSummary.value.verified_sources || projectsData.value.summary?.verified_sources || [],
}))
const projects = computed(() => projectsData.value.projects || [])
const profileEmpty = computed(() => Number(summary.value.public_projects_count) <= 0)
const projectsLoading = computed(() => projectsPending.value && Number(summary.value.public_projects_count) > 0 && !projects.value.length)
const projectSkeletonCount = computed(() => Math.max(1, Math.min(Number(summary.value.public_projects_count) || 1, 6)))
const showBranding = computed(() => profile.value.show_branding !== false)
const displayName = computed(() => profile.value.display_name || 'Builder')
const shareTitle = computed(() => `${displayName.value} · ${t('public_profile.verified_growth')}`)
const verifiedSourceItems = computed(() =>
  (summary.value.verified_sources || []).map((key) => ({ key, label: sourceLabel(key) })),
)
const hasVerifiedSources = computed(() => verifiedSourceItems.value.length > 0)
const resolvedConfig = computed(() => configStore.getTranslated(locale.value))
const siteName = computed(() => String(resolvedConfig.value.site_name || configStore.siteName || 'GA Lite'))
const logo = computed(() => resolvedConfig.value.logo || {})
const loadedProjectMetrics = computed(() =>
  Object.values(projectMetricState.value)
    .map((item) => item?.data)
    .filter(Boolean),
)
const traffic = computed(() => mergeTrafficMetricObjects(loadedProjectMetrics.value.map((item) => item.traffic?.metrics)))
const search = computed(() => mergeSearchMetricObjects(loadedProjectMetrics.value.map((item) => item.search?.metrics)))
const metrics = computed(() => ({
  traffic: {
    summary: { metrics: traffic.value },
    timeseries: mergeSparklineSeries(
      loadedProjectMetrics.value.map((item) => item.traffic?.sparkline),
      t('public_profile.traffic'),
      loadedProjectMetrics.value.map((item) => item.traffic?.sparkline_labels),
    ),
  },
  search: {
    summary: { metrics: search.value },
    timeseries: mergeSparklineSeries(
      loadedProjectMetrics.value.map((item) => item.search?.sparkline_clicks),
      t('public_profile.search'),
      loadedProjectMetrics.value.map((item) => item.search?.sparkline_labels),
    ),
  },
}))
const metricProjects = computed(() => {
  return projects.value.map((project) => ({
    ...project,
    ...(projectMetricState.value[project.public_project_key]?.data || {}),
  }))
})
const projectSortOptions = computed(() => [
  { value: 'priority', label: t('projects.toolbar.sort_priority') },
  { value: 'visitors', label: t('projects.toolbar.sort_users') },
  { value: 'pageviews', label: t('projects.toolbar.sort_views') },
  { value: 'duration', label: t('projects.toolbar.sort_duration') },
  { divider: true },
  { value: 'clicks', label: t('projects.toolbar.sort_clicks') },
  { value: 'impressions', label: t('projects.toolbar.sort_impressions') },
  { value: 'position', label: t('projects.toolbar.sort_position') },
])
const sortedMetricProjects = computed(() => {
  const rows = metricProjects.value.map((project, index) => ({ project, index }))
  if (projectSort.value === 'priority') {
    return rows.map((row) => row.project)
  }

  rows.sort((a, b) =>
    projectMetricValue(b.project, projectSort.value) - projectMetricValue(a.project, projectSort.value)
    || a.index - b.index,
  )
  return rows.map((row) => row.project)
})

const projectLoadTotal = computed(() =>
  projects.value.filter((project) => shouldLoadProjectMetrics(project)).length,
)
const projectLoadingCount = computed(() =>
  Object.values(projectMetricState.value).filter((item) => item?.loading).length,
)
const summaryLoading = computed(() =>
  projectsLoading.value || (projectLoadTotal.value > 0 && projectLoadingCount.value > 0),
)

const SEARCH_PROVIDER_SET = new Set(['gsc', 'bing'])

function projectProviders(project) {
  return Array.isArray(project?.providers) ? project.providers : []
}

function hasPositiveMetric(metricsObj, keys) {
  return keys.some((key) => Number(metricsObj?.[key]) > 0)
}

function hasGa4Provider(project) {
  return projectProviders(project).includes('ga4')
    || hasPositiveMetric(project?.traffic?.metrics, ['screenPageViews', 'totalUsers', 'sessions'])
}

function hasSearchProvider(project) {
  return projectProviders(project).some((provider) => SEARCH_PROVIDER_SET.has(provider))
    || hasPositiveMetric(project?.search?.metrics, ['clicks', 'impressions'])
}

function shouldLoadProjectMetrics(project) {
  return !project?.locked && (hasGa4Provider(project) || hasSearchProvider(project))
}

function projectState(project) {
  return projectMetricState.value[project?.public_project_key] || {}
}

function isProjectLoading(project) {
  return Boolean(projectState(project).loading)
}

const dataSourcedProjects = computed(() =>
  sortedMetricProjects.value.filter((project) =>
    !project.locked && (hasGa4Provider(project) || hasSearchProvider(project)),
  ),
)

const comboEligibleProjects = computed(() =>
  dataSourcedProjects.value.filter((project) =>
    hasGa4Provider(project) && hasSearchProvider(project),
  ),
)

const useSiteCombo = computed(() =>
  dataSourcedProjects.value.length > 0
    && comboEligibleProjects.value.length * 2 > dataSourcedProjects.value.length,
)

const publicSiteCards = computed(() => {
  const cards = []
  for (const project of sortedMetricProjects.value) {
    const key = project.public_project_key
    if (project.locked) {
      cards.push({ key: `locked-${key}`, variant: 'locked', project, loading: false, wide: useSiteCombo.value })
      continue
    }

    const hasGa4 = hasGa4Provider(project)
    const hasSearch = hasSearchProvider(project)
    const loading = isProjectLoading(project)
    if (useSiteCombo.value && (hasGa4 || hasSearch)) {
      cards.push({ key: `combo-${key}`, variant: 'unified', project, loading })
      continue
    }

    if (hasGa4) cards.push({ key: `site-${key}`, variant: 'site', project, loading })
    if (hasSearch) cards.push({ key: `search-${key}`, variant: 'search', project, loading })
    if (!hasGa4 && !hasSearch) cards.push({ key: `site-empty-${key}`, variant: 'site', project, loading })
  }
  return cards
})

function projectMetricValue(project, sortKey) {
  const trafficMetrics = project?.traffic?.metrics || {}
  const searchMetrics = project?.search?.metrics || {}
  const map = {
    visitors: Number(trafficMetrics.totalUsers) || 0,
    pageviews: Number(trafficMetrics.screenPageViews) || 0,
    duration: Number(trafficMetrics.averageSessionDuration) || 0,
    clicks: Number(searchMetrics.clicks) || 0,
    impressions: Number(searchMetrics.impressions) || 0,
    position: Number(searchMetrics.position) || Number.POSITIVE_INFINITY,
  }
  return sortKey === 'position' ? -map.position : (map[sortKey] || 0)
}

function firstSeriesData(timeseries) {
  return Array.isArray(timeseries?.series?.[0]?.data)
    ? timeseries.series[0].data
    : []
}

function shapeProjectCardMetrics(payload) {
  const trafficPayload = payload?.traffic || {}
  const searchPayload = payload?.search || {}
  return {
    traffic: {
      metrics: trafficPayload.summary?.metrics || {},
      sparkline: firstSeriesData(trafficPayload.timeseries),
      sparkline_labels: Array.isArray(trafficPayload.timeseries?.labels) ? trafficPayload.timeseries.labels : [],
    },
    search: {
      metrics: searchPayload.summary?.metrics || {},
      sparkline_clicks: firstSeriesData(searchPayload.timeseries_clicks || searchPayload.timeseries),
      sparkline_impressions: firstSeriesData(searchPayload.timeseries_impressions),
      sparkline_labels: Array.isArray((searchPayload.timeseries_clicks || searchPayload.timeseries)?.labels)
        ? (searchPayload.timeseries_clicks || searchPayload.timeseries).labels
        : [],
      provider_metrics: searchPayload.summary?.provider_metrics || {},
    },
  }
}

function mergeTrafficMetricObjects(items) {
  const out = {}
  let sessionsSum = 0
  const weightedFields = ['averageSessionDuration', 'userEngagementDuration', 'bounceRate']
  const weightedTotals = Object.fromEntries(weightedFields.map((field) => [field, 0]))

  for (const item of items) {
    const sessions = Number(item?.sessions) || 0
    sessionsSum += sessions
    for (const [key, value] of Object.entries(item || {})) {
      if (weightedFields.includes(key)) {
        weightedTotals[key] += (Number(value) || 0) * sessions
        continue
      }
      out[key] = (Number(out[key]) || 0) + (Number(value) || 0)
    }
  }

  for (const field of weightedFields) {
    out[field] = sessionsSum > 0 ? weightedTotals[field] / sessionsSum : 0
  }

  return out
}

function mergeSearchMetricObjects(items) {
  let clicks = 0
  let impressions = 0
  let posWeighted = 0
  let posImpressions = 0
  for (const item of items) {
    const imp = Number(item?.impressions) || 0
    const pos = Number(item?.position) || 0
    clicks += Number(item?.clicks) || 0
    impressions += imp
    if (imp > 0 && pos > 0) {
      posWeighted += pos * imp
      posImpressions += imp
    }
  }
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: posImpressions > 0 ? posWeighted / posImpressions : 0,
  }
}

function addLabeledSparkline(timeline, points, labels) {
  if (!Array.isArray(points) || !points.length || points.length !== labels?.length) return false
  for (let i = 0; i < labels.length; i++) {
    const key = String(labels[i] || '')
    if (key) timeline.set(key, (timeline.get(key) || 0) + (Number(points[i]) || 0))
  }
  return true
}

function mergeSparklineSeries(items, label, labelCandidates = []) {
  const timeline = new Map()
  let hasLabeledSeries = false
  for (let i = 0; i < items.length; i++) {
    hasLabeledSeries = addLabeledSparkline(timeline, items[i], labelCandidates[i]) || hasLabeledSeries
  }
  if (hasLabeledSeries) {
    const labels = Array.from(timeline.keys()).sort()
    return { metric: '', labels, series: [{ label, data: labels.map((key) => timeline.get(key) || 0) }] }
  }

  /* 兼容旧缓存: 没有 labels 时才退回历史下标语义. */
  const arrays = items.filter((item) => Array.isArray(item) && item.length)
  const len = Math.max(0, ...arrays.map((item) => item.length))
  const data = Array.from({ length: len }, (_, index) =>
    arrays.reduce((sum, item) => sum + (Number(item[index]) || 0), 0),
  )
  return { metric: '', labels: [], series: [{ label, data }] }
}

function setProjectMetricState(key, patch) {
  projectMetricState.value = {
    ...projectMetricState.value,
    [key]: {
      ...(projectMetricState.value[key] || {}),
      ...patch,
    },
  }
}

function resetProjectMetricState() {
  const next = {}
  for (const project of projects.value) {
    next[project.public_project_key] = {
      loading: shouldLoadProjectMetrics(project),
      data: null,
      error: false,
    }
  }
  projectMetricState.value = next
}

async function mapLimit(items, limit, worker) {
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++]
      await worker(item)
    }
  })
  await Promise.all(workers)
}

async function loadProjectMetric(project, run, requestedPeriod, signal) {
  const key = project.public_project_key
  try {
    const res = await requestFetch(
      `/api/public/profile/${encodeURIComponent(slug.value)}/projects/${encodeURIComponent(key)}/metrics?period=${requestedPeriod}&scope=card`,
      { signal },
    )
    if (run !== activeRun) return
    if (res?.code === 200) {
      setProjectMetricState(key, {
        loading: false,
        data: shapeProjectCardMetrics(res.data),
        error: false,
      })
      return
    }
  } catch (err) {
    if (err?.name === 'AbortError' || run !== activeRun) return
  }
  if (run === activeRun) setProjectMetricState(key, { loading: false, data: null, error: true })
}

async function loadProjectMetricsForPeriod() {
  const run = ++activeRun
  const requestedPeriod = period.value
  if (activeAbort) activeAbort.abort()
  activeAbort = typeof AbortController !== 'undefined' ? new AbortController() : null
  resetProjectMetricState()

  if (!import.meta.client) return
  const queue = projects.value.filter((project) => shouldLoadProjectMetrics(project))
  await mapLimit(queue, PROJECT_METRIC_CONCURRENCY, (project) =>
    loadProjectMetric(project, run, requestedPeriod, activeAbort?.signal),
  )
}

watch([period, projects], loadProjectMetricsForPeriod, { immediate: true })

function refreshProfileMetrics() {
  if (!projects.value.length && Number(summary.value.public_projects_count) > 0) refreshProjects()
  loadProjectMetricsForPeriod()
}

function onApplyCustom({ start, end }) {
  period.value = buildCustomPeriod(start, end)
  customModalVisible.value = false
}

const SOCIAL = {
  x: ['X', 'ri:twitter-x-line'],
  threads: ['Threads', 'ri:threads-line'],
  instagram: ['Instagram', 'ri:instagram-line'],
  facebook: ['Facebook', 'ri:facebook-circle-line'],
  youtube: ['YouTube', 'ri:youtube-line'],
  tiktok: ['TikTok', 'ri:tiktok-line'],
  xiaohongshu: ['小红书', 'ri:book-open-line'],
  bilibili: ['Bilibili', 'ri:bilibili-line'],
}

const socialLinks = computed(() => {
  const out = []
  for (const [key, href] of Object.entries(profile.value.social_links || {})) {
    const meta = SOCIAL[key]
    if (meta && href) out.push({ key, href, label: meta[0], icon: meta[1] })
  }
  if (profile.value.website_url) {
    out.push({ key: 'website', href: profile.value.website_url, label: t('account.public_profile.website'), icon: 'ri:global-line' })
  }
  return out
})

function sourceLabel(source) {
  const map = { ga4: 'Google Analytics 4', gsc: 'Google Search Console', bing: 'Bing Webmaster' }
  return map[source] || source
}

useHead(() => ({
  title: `${profile.value.display_name || t('public_profile.default_profile_name')} · ${t('public_profile.verified_growth')}`,
  meta: [
    { name: 'description', content: profile.value.bio || t('public_profile.meta_description') },
  ],
}))
</script>
