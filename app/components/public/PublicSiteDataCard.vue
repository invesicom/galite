<script setup>
/* ============================================================
   PublicSiteDataCard - public-safe site card
   ============================================================ */

import { computed, ref, resolveComponent, watch } from 'vue'
import MiniSparkline from '~/components/projects/MiniSparkline.vue'
import { resolveProjectIcon } from '~/utils/project-icon'

const props = defineProps({
  profileSlug: { type: String, default: '' },
  project:     { type: Object, default: () => ({}) },
  variant:     { type: String, default: 'site' },
  loading:     { type: Boolean, default: false },
  wide:        { type: Boolean, default: false },
})

const { t } = useI18n()
const localePath = useLocalePath()

const SITE_FIELDS = [
  { key: 'totalUsers',             label: 'metrics.card.visitors',   format: 'int' },
  { key: 'screenPageViews',        label: 'metrics.card.page_views', format: 'int', labelColor: 'var(--color-primary)' },
  { key: 'averageSessionDuration', label: 'metrics.card.engagement', format: 'duration' },
]

const SEARCH_FIELDS = [
  { key: 'clicks',      label: 'metrics.card.clicks',      format: 'int', labelColor: '#4285f4' },
  { key: 'impressions', label: 'metrics.card.impressions', format: 'int', labelColor: '#a142f4' },
  { key: 'position',    label: 'metrics.card.position',    format: 'decimal' },
]

const PROVIDERS = [
  { id: 'gsc', label: 'Google', fullLabel: 'Google Search Console', icon: '/images/icon/google-search-console.svg' },
  { id: 'bing', label: 'Bing', fullLabel: 'Bing Webmaster', icon: '/images/icon/bing-webmaster.svg' },
]

const isUnified = computed(() => props.variant === 'unified')
const isSearch = computed(() => props.variant === 'search')
const isLocked = computed(() => props.variant === 'locked' || props.project?.locked)
const isWide = computed(() => isUnified.value || props.wide)
const hasSearchSection = computed(() => isUnified.value || isSearch.value)
const displayName = computed(() => String(props.project?.display_name || 'Site'))
const siteIconBroken = ref(false)
const siteIconUrl = computed(() => resolveProjectIcon(props.project))
const detailLink = computed(() => {
  const base = localePath('/').replace(/\/$/, '')
  const slug = encodeURIComponent(String(props.profileSlug || ''))
  const key = encodeURIComponent(String(props.project?.public_project_key || ''))
  return `${base}/@${slug}/${key}`
})
const projectMode = computed(() => String(props.project?.mode || ''))
const canOpenDetail = computed(() =>
  Boolean(props.project?.public_project_key)
  && ['public', 'password', 'semi_public'].includes(projectMode.value),
)
const NuxtLink = resolveComponent('NuxtLink')
const cardComponent = computed(() => canOpenDetail.value ? NuxtLink : 'div')
const cardAttrs = computed(() => canOpenDetail.value ? { to: detailLink.value } : {})

const siteMetrics = computed(() => props.project?.traffic?.metrics || null)
const siteSparkline = computed(() => props.project?.traffic?.sparkline || [])
const searchMetrics = computed(() => props.project?.search?.metrics || null)
const searchProviderMetrics = computed(() => props.project?.search?.provider_metrics || {})
const searchSparklineSeries = computed(() => [
  { points: props.project?.search?.sparkline_clicks || [], color: '#4285f4' },
  { points: props.project?.search?.sparkline_impressions || [], color: '#a142f4' },
])

function formatInt(value) {
  const n = Number(value) || 0
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + 'B'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 10_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
  return n.toLocaleString('en-US')
}

function formatDuration(value) {
  const n = Number(value) || 0
  if (n < 60) return Math.round(n) + 's'
  const m = Math.floor(n / 60)
  const s = Math.round(n % 60)
  return `${m}m ${s}s`
}

function formatDecimal(value) {
  const n = Number(value) || 0
  return n > 0 ? n.toFixed(1) : '-'
}

function format(value, kind) {
  if (kind === 'duration') return formatDuration(value)
  if (kind === 'decimal') return formatDecimal(value)
  return formatInt(value)
}

function buildCards(fields, metricsObj) {
  return fields.map((field) => ({
    ...field,
    label: t(field.label),
    has: metricsObj != null && metricsObj[field.key] !== undefined,
    display: metricsObj != null && metricsObj[field.key] !== undefined
      ? format(metricsObj[field.key], field.format)
      : '-',
  }))
}

const siteCards = computed(() => buildCards(SITE_FIELDS, siteMetrics.value))
const searchCards = computed(() => buildCards(SEARCH_FIELDS, searchMetrics.value))

const providerBadges = computed(() => PROVIDERS
  .map((provider) => {
    const metrics = searchProviderMetrics.value?.[provider.id]
    if (!metrics) return null
    return {
      ...provider,
      clicks: formatInt(metrics.clicks),
    }
  })
  .filter(Boolean))

const visibleProviderBadges = computed(() =>
  providerBadges.value.length > 1 ? providerBadges.value : [],
)

watch(siteIconUrl, () => {
  siteIconBroken.value = false
})

function providerMetricDisplay(providerId, metricKey) {
  const metrics = searchProviderMetrics.value?.[providerId] || {}
  const field = SEARCH_FIELDS.find((item) => item.key === metricKey)
  return format(metrics[metricKey], field?.format || 'int')
}

function providerMetricTooltip(metricKey) {
  if (visibleProviderBadges.value.length <= 1) return ''
  return {
    rows: visibleProviderBadges.value.map((provider) => ({
      icon: provider.icon,
      alt: provider.fullLabel,
      label: provider.label,
      value: providerMetricDisplay(provider.id, metricKey),
    })),
  }
}
</script>

<template>
  <component
    :is="cardComponent"
    v-bind="cardAttrs"
    :class="[
      'group block overflow-hidden rounded-lg border border-gray-200 bg-white transition-colors',
      canOpenDetail ? 'hover:border-gray-300 hover:bg-gray-50/60' : 'cursor-default',
      isWide ? 'sm:col-span-2' : '',
    ]"
    :aria-disabled="canOpenDetail ? undefined : 'true'"
  >
    <div class="flex items-center justify-between gap-3 px-4 pt-4">
      <div class="flex min-w-0 items-center gap-3">
        <img
          v-if="siteIconUrl && !siteIconBroken"
          :src="siteIconUrl"
          class="size-9 shrink-0 rounded-md object-cover"
          referrerpolicy="no-referrer"
          alt=""
          @error="siteIconBroken = true"
        />
        <div v-else class="flex size-9 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-400">
          <NuxtIcon name="ri:global-line" class="size-4" />
        </div>
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <h3 class="truncate text-sm font-semibold text-gray-900">{{ displayName }}</h3>
            <NuxtIcon v-if="isLocked" name="ri:lock-2-line" class="size-4 shrink-0 text-gray-400" />
          </div>
        </div>
      </div>

      <div v-if="hasSearchSection && visibleProviderBadges.length" class="flex shrink-0 items-center gap-1">
        <span
          v-for="provider in visibleProviderBadges"
          :key="provider.id"
          v-tooltip="provider.fullLabel"
          class="inline-flex h-5 items-center gap-1 rounded bg-gray-50 px-1.5 text-[11px] font-medium leading-none text-gray-500 ring-1 ring-gray-100"
        >
          <img :src="provider.icon" class="size-3 rounded-sm object-contain" alt="" />
          <span class="tabular-nums">{{ provider.clicks }}</span>
        </span>
      </div>
    </div>

    <div v-if="isLocked" class="px-4 pb-4 pt-3">
      <div class="flex h-12 items-center justify-center rounded-md bg-gray-50 text-xs font-medium text-gray-500">
        {{ t('public_profile.protected_site') }}
      </div>
    </div>

    <div v-else-if="isUnified" class="grid grid-cols-1 divide-y divide-gray-100 pt-3 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
      <div class="px-4 pb-3">
        <div class="grid grid-cols-3 gap-2">
          <div v-for="item in siteCards" :key="item.key" class="min-w-0 text-center">
            <div class="mb-0.5 truncate text-xs" :style="item.labelColor ? { color: item.labelColor } : { color: '#6b7280' }">
              {{ item.label }}
            </div>
            <div class="text-base font-semibold leading-6 tabular-nums">
              <div v-if="loading" class="mx-auto h-6 w-12 animate-pulse rounded bg-gray-100" />
              <span v-else-if="!item.has" class="text-gray-300">-</span>
              <span v-else class="text-gray-900">{{ item.display }}</span>
            </div>
          </div>
        </div>
        <div class="pt-1">
          <MiniSparkline :points="siteSparkline" :loading="loading" :height="28" />
        </div>
      </div>

      <div class="px-4 pb-3 pt-3 lg:pt-0">
        <div class="grid grid-cols-3 gap-2">
          <div v-for="item in searchCards" :key="item.key" class="min-w-0 text-center">
            <div class="mb-0.5 truncate text-xs" :style="item.labelColor ? { color: item.labelColor } : { color: '#6b7280' }">
              {{ item.label }}
            </div>
            <div class="text-base font-semibold leading-6 tabular-nums">
              <div v-if="loading" class="mx-auto h-6 w-12 animate-pulse rounded bg-gray-100" />
              <span v-else-if="!item.has" class="text-gray-300">-</span>
              <span v-else class="text-gray-900" v-tooltip="providerMetricTooltip(item.key)">{{ item.display }}</span>
            </div>
          </div>
        </div>
        <div class="pt-1">
          <MiniSparkline :series="searchSparklineSeries" :loading="loading" :height="28" />
        </div>
      </div>
    </div>

    <div v-else class="px-4 pb-3 pt-3">
      <div class="grid grid-cols-3 gap-2">
        <div v-for="item in (isSearch ? searchCards : siteCards)" :key="item.key" class="min-w-0 text-center">
          <div class="mb-0.5 truncate text-xs" :style="item.labelColor ? { color: item.labelColor } : { color: '#6b7280' }">
            {{ item.label }}
          </div>
          <div class="text-base font-semibold leading-6 tabular-nums">
            <div v-if="loading" class="mx-auto h-6 w-12 animate-pulse rounded bg-gray-100" />
            <span v-else-if="!item.has" class="text-gray-300">-</span>
            <span v-else-if="isSearch" class="text-gray-900" v-tooltip="providerMetricTooltip(item.key)">{{ item.display }}</span>
            <span v-else class="text-gray-900">{{ item.display }}</span>
          </div>
        </div>
      </div>
      <div class="pt-1">
        <MiniSparkline
          v-if="isSearch"
          :series="searchSparklineSeries"
          :loading="loading"
          :height="28"
        />
        <MiniSparkline
          v-else
          :points="siteSparkline"
          :loading="loading"
          :height="28"
        />
      </div>
    </div>
  </component>
</template>
