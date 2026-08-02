<template>
  <div class="mx-auto max-w-6xl px-4 pb-8 pt-4 sm:px-6 sm:pb-12 sm:pt-6">
    <div class="mb-0 flex items-start justify-between gap-4">
      <section class="min-w-0 flex-1">
        <div class="flex min-w-0 items-center gap-2.5">
          <NuxtLink
            :to="profilePath"
            class="group flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-100 text-gray-400 sm:size-10"
            :aria-label="profileHomeLabel"
          >
            <NuxtIcon name="ri:user-3-line" class="size-5" />
          </NuxtLink>

          <div class="flex min-w-0 items-center gap-1.5">
            <NuxtLink
              :to="profilePath"
              class="group min-w-0 truncate text-base font-semibold leading-6 tracking-tight text-gray-900 hover:text-primary sm:text-lg"
              :aria-label="profileHomeLabel"
            >
              {{ profileName }}
            </NuxtLink>
            <button
              v-if="hasVerifiedSources"
              type="button"
              class="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-primary hover:bg-primary/10"
              :aria-label="t('public_profile.verified_badge')"
              v-tooltip.bottom="t('public_profile.verified_badge')"
              @click="certificationOpen = true"
            >
              <NuxtIcon name="ri:verified-badge-fill" class="size-4" />
            </button>
            <NuxtLink
              :to="profilePath"
              class="hidden min-w-0 truncate text-sm text-gray-500 hover:text-gray-800 sm:inline"
            >
              @{{ profileSlug }}
            </NuxtLink>
          </div>
        </div>
      </section>

      <PublicPageActions
        :title="shareTitle"
        :floating="false"
        :show-branding="showBranding"
        class="shrink-0 !mb-0"
      />
    </div>

    <section class="mt-4">
      <div ref="stickySentinel" aria-hidden="true" class="h-0"></div>
      <div
        :class="[
          'sticky top-0 z-20 -mx-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3 transition-colors sm:-mx-6 sm:px-6',
          toolbarStuck
            ? 'border-gray-100 bg-white/95 backdrop-blur'
            : 'border-transparent bg-transparent',
        ]"
      >
        <PublicSiteSwitcher
          v-if="publicProjects.length"
          :current-key="currentProjectKey"
          :projects="publicProjects"
          @select="onSwitchProject"
        />

        <FilterBar
          v-if="showFullDetail"
          :filters="filters"
          @remove="onRemoveFilter"
          @clear-all="onClearFilters"
          @edit="onEditFilter"
        />

        <div v-if="!locked && !hidden" class="ml-auto flex items-center gap-2">
          <FilterAddDropdown
            v-if="showFullDetail"
            data-source="ga4"
            @pick-dim="onPickFilterDim"
          />
          <PeriodSwitcher
            v-model="period"
            :options="detailPeriodOptions"
            allow-custom
            @request-custom="customModalVisible = true"
          />
          <RefreshButton
            :loading="metricsPending"
            @refresh="refreshMetrics"
          />
        </div>
      </div>

      <p v-if="!hidden && project.description" class="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
        {{ project.description }}
      </p>
    </section>

    <section v-if="hidden" class="mx-auto mt-10 max-w-md text-center">
      <div class="mx-auto flex size-12 items-center justify-center rounded-full bg-gray-100">
        <NuxtIcon name="ri:eye-off-line" class="size-6 text-gray-500" />
      </div>
      <h2 class="mt-4 text-xl font-semibold text-gray-900">{{ t('public_profile.hidden_site_title') }}</h2>
      <p class="mt-2 text-sm leading-6 text-gray-500">{{ t('public_profile.hidden_site_desc') }}</p>
      <NuxtLink
        :to="profilePath"
        class="mt-6 inline-flex items-center justify-center rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-text hover:opacity-90"
      >
        {{ t('public_profile.back_to_profile') }}
      </NuxtLink>
    </section>

    <template v-else>
      <section v-if="locked" class="mx-auto mt-12 w-full max-w-sm rounded-lg border border-gray-200 p-5 text-center">
        <div class="flex items-center justify-center gap-2 text-sm font-semibold text-gray-900">
          <NuxtIcon name="ri:lock-2-line" class="size-4" />
          {{ t('public_profile.protected_site') }}
        </div>
        <div class="relative mt-4">
          <input
            v-model="password"
            :type="passwordVisible ? 'text' : 'password'"
            class="w-full rounded-lg border border-gray-200 px-3 py-2 pr-10 text-sm focus:border-primary focus:outline-none"
            :placeholder="t('projects.public.password')"
            @keydown.enter="unlock"
          />
          <button
            type="button"
            class="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 hover:bg-gray-50 hover:text-gray-700"
            :aria-label="passwordVisible ? t('public_profile.hide_password') : t('public_profile.show_password')"
            @click="passwordVisible = !passwordVisible"
          >
            <NuxtIcon :name="passwordVisible ? 'ri:eye-off-line' : 'ri:eye-line'" class="size-4" />
          </button>
        </div>
        <button
          type="button"
          class="mt-4 rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-text hover:opacity-90 disabled:opacity-50"
          :disabled="unlocking || !password"
          @click="unlock"
        >
          {{ unlocking ? t('public_profile.unlocking') : t('public_profile.unlock') }}
        </button>
      </section>

      <PublicProjectDetailPanel
        v-else
        class="mt-6"
        :metrics="metrics"
        :full="showFullDetail"
        :loading="coreMetricsPending"
        :dimensions-loading="dimsMetricsPending"
        :realtime-loading="realtimeMetricsPending"
        :funnels-loading="funnelsMetricsPending"
      />

      <FilterAddModal
        v-if="showFullDetail"
        :visible="filterAddVisible"
        :dim="filterAddDim"
        :initial="filterAddInitial"
        :dims-map="filterDimsMap"
        :period="period"
        :all-filters="filters"
        @close="filterAddVisible = false"
        @add="onApplyFilter"
      />

      <CustomDateModal
        :visible="customModalVisible"
        :model-value="period"
        @close="customModalVisible = false"
        @apply="onApplyCustom"
      />
    </template>

    <footer v-if="!hidden && showBranding" class="mt-12 flex justify-center">
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
      v-if="!hidden && showBranding"
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
import { parseFiltersFromQuery, filtersToQuery } from '~/utils/filters'
import { buildCustomPeriod } from '~/utils/period'
import FilterBar from '~/components/metrics/FilterBar.vue'
import FilterAddDropdown from '~/components/metrics/FilterAddDropdown.vue'
import FilterAddModal from '~/components/metrics/FilterAddModal.vue'
import PeriodSwitcher from '~/components/metrics/PeriodSwitcher.vue'
import CustomDateModal from '~/components/metrics/CustomDateModal.vue'
import RefreshButton from '~/components/layout/RefreshButton.vue'
import ToastContainer from '~/components/layout/ToastContainer.vue'
import PublicSiteSwitcher from '~/components/public/PublicSiteSwitcher.vue'

definePageMeta({ layout: false })

const route = useRoute()
const router = useRouter()
const requestFetch = useRequestFetch()
const { t, locale } = useI18n()
const localePath = useLocalePath()
const configStore = useConfigStore()
const slug = computed(() => String(route.params.slug || ''))
const publicProjectKey = computed(() => String(route.params.publicProjectKey || ''))
const period = ref('28days')
const password = ref('')
const passwordVisible = ref(false)
const unlocking = ref(false)
const certificationOpen = ref(false)
const filterAddVisible = ref(false)
const filterAddDim = ref('')
const filterAddInitial = ref(null)
const filterAddIndex = ref(-1)
const customModalVisible = ref(false)
const stickySentinel = ref(null)
const toolbarStuck = ref(false)
let stickyObserver = null
let realtimeTimer = null
const detailPeriodOptions = computed(() => [
  { value: 'today', label: t('metrics.period.today') },
  { value: 'yesterday', label: t('metrics.period.yesterday') },
  { value: '7days', label: t('metrics.period.7days') },
  { value: '28days', label: t('metrics.period.28days') },
  { value: '90days', label: t('metrics.period.90days') },
  { value: '6months', label: t('metrics.period.6months') },
  { value: '1year', label: t('metrics.period.1year') },
])

const projectPath = computed(() =>
  `/api/public/profile/${encodeURIComponent(slug.value)}/projects/${encodeURIComponent(publicProjectKey.value)}`,
)
const filters = computed(() => parseFiltersFromQuery(route.query))
const filtersKey = computed(() =>
  filters.value
    .map((item) => `${item.dim}:${item.match}:${item.value}`)
    .sort()
    .join('|'),
)

function filtersUrlPart() {
  return filters.value.map((item) =>
    `&f=${encodeURIComponent(`${item.dim}:${item.match}:${item.value}`)}`,
  ).join('')
}

const { data: projectRes, refresh: refreshProject } = await useAsyncData(
  () => `public-project:${slug.value}:${publicProjectKey.value}`,
  () => requestFetch(projectPath.value),
)

if (projectRes.value?.code !== 200) {
  throw createError({ statusCode: 404, statusMessage: 'Site not found' })
}

const mode = computed(() => projectRes.value?.data?.mode || 'semi_public')
const hidden = computed(() => mode.value === 'hidden')
const locked = computed(() => mode.value === 'password')
const showFullDetail = computed(() => mode.value === 'public')

const { data: switcherProjectsRes, refresh: refreshSwitcherProjects } = await useAsyncData(
  () => `public-project-switcher:${slug.value}`,
  () => requestFetch(`/api/public/profile/${encodeURIComponent(slug.value)}/projects`),
  { lazy: true, server: false },
)

function metricsUrl(section, includeFilters = true) {
  const filterPart = includeFilters ? filtersUrlPart() : ''
  return `${projectPath.value}/metrics?period=${encodeURIComponent(period.value)}&section=${section}${filterPart}`
}

async function loadMetricsSection(section, options = {}) {
  if (locked.value || hidden.value) return { code: 200, data: null }
  if (options.fullOnly && !showFullDetail.value) return { code: 200, data: null }
  try {
    return await requestFetch(metricsUrl(section, options.filters !== false))
  } catch (err) {
    console.error(`[public-project] ${section} metrics failed:`, err?.message || err)
    return { code: 200, data: null }
  }
}

const { data: coreMetricsRes, pending: coreMetricsPending, refresh: refreshCoreMetrics } = await useAsyncData(
  () => `public-project-core:${slug.value}:${publicProjectKey.value}:${period.value}:${mode.value}:${filtersKey.value}`,
  () => loadMetricsSection('core'),
  { lazy: true, server: false },
)

const { data: dimsMetricsRes, pending: dimsMetricsPending, refresh: refreshDimsMetrics } = await useAsyncData(
  () => `public-project-dims:${slug.value}:${publicProjectKey.value}:${period.value}:${mode.value}:${filtersKey.value}`,
  () => loadMetricsSection('dims', { fullOnly: true }),
  { lazy: true, server: false },
)

const { data: realtimeMetricsRes, pending: realtimeMetricsPending, refresh: refreshRealtimeMetrics } = await useAsyncData(
  () => `public-project-realtime:${slug.value}:${publicProjectKey.value}:${mode.value}`,
  () => loadMetricsSection('realtime', { fullOnly: true, filters: false }),
  { lazy: true, server: false },
)
const lastGoodRealtimeMetrics = ref(null)

const { data: funnelsMetricsRes, pending: funnelsMetricsPending, refresh: refreshFunnelsMetrics } = await useAsyncData(
  () => `public-project-funnels:${slug.value}:${publicProjectKey.value}:${period.value}:${mode.value}:${filtersKey.value}`,
  () => loadMetricsSection('funnels', { fullOnly: true }),
  { lazy: true, server: false },
)

const profile = computed(() => projectRes.value?.data?.profile || {})
const summary = computed(() => projectRes.value?.data?.summary || { verified_sources: [] })
const project = computed(() => projectRes.value?.data?.project || {})
const currentProjectKey = computed(() => project.value.public_project_key || publicProjectKey.value)
const showBranding = computed(() => profile.value.show_branding !== false)
const publicProjects = computed(() => {
  const list = (switcherProjectsRes.value?.data?.projects || []).filter(canShowInSwitcher)
  if (!currentProjectKey.value || list.some((item) => item.public_project_key === currentProjectKey.value)) return list
  return canShowInSwitcher(project.value) ? [project.value, ...list] : list
})
const profileSlug = computed(() => profile.value.slug || slug.value)
const profilePath = computed(() => publicRoutePath(profileSlug.value))
const profileName = computed(() => profile.value.display_name || t('public_profile.default_profile_name'))
const profileHomeLabel = computed(() => t('public_profile.profile_home_label', { name: profileName.value }))
const shareTitle = computed(() => `${project.value.display_name || t('public_profile.default_site_name')} · ${profileName.value}`)
const verifiedSourceItems = computed(() =>
  (summary.value.verified_sources || []).map((key) => ({ key, label: sourceLabel(key) })),
)
const hasVerifiedSources = computed(() => verifiedSourceItems.value.length > 0)
const resolvedConfig = computed(() => configStore.getTranslated(locale.value))
const siteName = computed(() => String(resolvedConfig.value.site_name || configStore.siteName || 'GA Lite'))
const logo = computed(() => resolvedConfig.value.logo || {})
const metricsPending = computed(() =>
  coreMetricsPending.value
  || (showFullDetail.value && (dimsMetricsPending.value || realtimeMetricsPending.value || funnelsMetricsPending.value)),
)
const metrics = computed(() => mergeMetrics(
  coreMetricsRes.value?.data,
  dimsMetricsRes.value?.data,
  realtimeMetricsData.value,
  funnelsMetricsRes.value?.data,
))
const { show: showToast } = useToast()
const filterDimsMap = computed(() => {
  const traffic = metrics.value?.traffic?.dimensions || {}
  const search = metrics.value?.search?.dimensions || {}
  return {
    pagePath: traffic.pagePath?.rows || traffic.page?.rows || [],
    country: traffic.country?.rows || [],
    deviceCategory: traffic.deviceCategory?.rows || traffic.device?.rows || [],
    sessionDefaultChannelGroup: traffic.sessionDefaultChannelGroup?.rows || traffic.source?.rows || [],
    sessionSource: traffic.sessionSource?.rows || [],
    browser: traffic.browser?.rows || [],
    operatingSystem: traffic.operatingSystem?.rows || [],
    eventName: traffic.eventName?.rows || [],
    searchQuery: search.query?.rows || [],
  }
})

watch([slug, publicProjectKey], async () => {
  password.value = ''
  passwordVisible.value = false
  filterAddVisible.value = false
  lastGoodRealtimeMetrics.value = null
  await refreshProject()
  await refreshSwitcherProjects()
  await refreshMetrics()
})

function isGoodRealtimeMetrics(data) {
  return data?.realtime
    && data.realtime.realtime_status !== 'error'
    && data.realtime.active_users_30min !== undefined
}

const realtimeMetricsData = computed(() => {
  const data = realtimeMetricsRes.value?.data
  if (isGoodRealtimeMetrics(data)) return data
  return lastGoodRealtimeMetrics.value
})

watch(
  () => realtimeMetricsRes.value?.data,
  (data) => {
    if (isGoodRealtimeMetrics(data)) lastGoodRealtimeMetrics.value = data
  },
  { immediate: true },
)

function mergeMetrics(...items) {
  const out = {}
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    for (const [key, value] of Object.entries(item)) {
      if (key === 'traffic' || key === 'search') continue
      if (value !== undefined && value !== null) out[key] = value
    }
    if (item.traffic) out.traffic = mergeMetricGroup(out.traffic, item.traffic)
    if (item.search) out.search = mergeMetricGroup(out.search, item.search)
  }
  return out
}

function mergeMetricGroup(base, patch) {
  const out = { ...(base || {}) }
  for (const [key, value] of Object.entries(patch || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) && out[key] && typeof out[key] === 'object' && !Array.isArray(out[key])) {
      out[key] = { ...out[key], ...value }
    } else {
      out[key] = value
    }
  }
  return out
}

async function refreshMetrics() {
  const jobs = [refreshCoreMetrics()]
  if (showFullDetail.value) {
    jobs.push(refreshDimsMetrics(), refreshRealtimeMetrics(), refreshFunnelsMetrics())
  }
  await Promise.all(jobs)
}

function rebuildStickyObserver() {
  stickyObserver?.disconnect()
  stickyObserver = null
  if (!stickySentinel.value || typeof window === 'undefined') return
  stickyObserver = new IntersectionObserver(
    ([entry]) => { toolbarStuck.value = !entry.isIntersecting },
    { threshold: [0, 1] },
  )
  stickyObserver.observe(stickySentinel.value)
}

watch(stickySentinel, rebuildStickyObserver, { flush: 'post' })

onMounted(() => {
  rebuildStickyObserver()
  realtimeTimer = window.setInterval(() => {
    if (showFullDetail.value && !locked.value && !hidden.value) refreshRealtimeMetrics()
  }, 30_000)
})

onBeforeUnmount(() => {
  stickyObserver?.disconnect()
  stickyObserver = null
  if (realtimeTimer) window.clearInterval(realtimeTimer)
  realtimeTimer = null
})

async function unlock() {
  if (!password.value || unlocking.value) return
  unlocking.value = true
  try {
    const res = await $fetch(`${projectPath.value}/unlock`, {
      method: 'POST',
      body: { password: password.value },
      credentials: 'same-origin',
    })
    if (res?.code !== 200) {
      showToast(unlockErrorMessage(res?.msg), { type: 'error' })
      return
    }
    password.value = ''
    await refreshProject()
  } catch (err) {
    showToast(unlockErrorMessage(err?.data?.msg || err?.message), { type: 'error' })
  } finally {
    unlocking.value = false
  }
}

function unlockErrorMessage(code) {
  return t('public_profile.invalid_password')
}

function setFilters(nextFilters) {
  const next = { ...route.query, ...filtersToQuery(nextFilters) }
  if (next.f === undefined) delete next.f
  router.replace({ query: next })
}

function onPickFilterDim(dim) {
  const existingIndex = filters.value.findIndex((item) => item.dim === dim)
  if (existingIndex >= 0) {
    onEditFilter(existingIndex)
    return
  }
  filterAddDim.value = dim
  filterAddInitial.value = null
  filterAddIndex.value = -1
  filterAddVisible.value = true
}

function onEditFilter(index) {
  const item = filters.value[index]
  if (!item) return
  filterAddDim.value = item.dim
  filterAddInitial.value = { match: item.match, value: item.value }
  filterAddIndex.value = index
  filterAddVisible.value = true
}

function onApplyFilter(filter) {
  const next = [...filters.value]
  if (filterAddIndex.value >= 0) next.splice(filterAddIndex.value, 1, filter)
  else next.push(filter)
  setFilters(next)
}

function onRemoveFilter(index) {
  setFilters(filters.value.filter((_, i) => i !== index))
}

function onClearFilters() {
  setFilters([])
}

function onApplyCustom({ start, end }) {
  period.value = buildCustomPeriod(start, end)
}

function onSwitchProject(item) {
  if (!item?.public_project_key || item.public_project_key === currentProjectKey.value) return
  const query = {
    ...route.query,
    period: period.value,
    ...filtersToQuery(filters.value),
  }
  if (query.f === undefined) delete query.f
  router.push({
    path: publicRoutePath(profileSlug.value, item.public_project_key),
    query,
  })
}

function publicRoutePath(profileSlugValue, publicProjectKeyValue = '') {
  const base = localePath('/').replace(/\/$/, '')
  const slugPart = encodeURIComponent(String(profileSlugValue || ''))
  const projectPart = publicProjectKeyValue ? `/${encodeURIComponent(String(publicProjectKeyValue))}` : ''
  return `${base}/@${slugPart}${projectPart}`
}

function canShowInSwitcher(item) {
  return Boolean(item?.public_project_key) && item.mode !== 'hidden' && !item.hidden
}

function sourceLabel(source) {
  const map = { ga4: 'Google Analytics 4', gsc: 'Google Search Console', bing: 'Bing Webmaster' }
  return map[source] || source
}

useHead(() => ({
  title: `${project.value.display_name || t('public_profile.default_site_name')} · ${profile.value.display_name || t('public_profile.default_profile_name')}`,
  meta: [
    ...(locked.value || hidden.value
      ? [{ key: 'robots', name: 'robots', content: 'noindex, nofollow' }]
      : []),
    { name: 'description', content: project.value.description || t('public_profile.site_meta_description') },
  ],
}))
</script>
