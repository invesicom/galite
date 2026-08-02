<script setup>
/* ============================================================
   DimensionDetailModal - 单维度完整列表弹窗
   --
   触发: BarList @view-more
   显示: 完整 dimension API 返回的 rows (后端 TOP_N=50)
   行格式: 跟 BarList 同款 (后景进度条 + label + 数字)
   ============================================================ */

import { computed } from 'vue'
import { localizeDimensionValue } from '~/utils/dimension-i18n'

/* 跟 BarList 同款: 数据层 row.value 保留原值, 展示层 localize */
function displayValue(raw) {
  if (!props.dim) return raw
  return localizeDimensionValue(props.dim, raw, t)
}

function labelTooltip(row) {
  const value = displayValue(row?.[props.labelField])
  if (value === undefined || value === null || value === '') return ''
  return String(value)
}

const props = defineProps({
  visible: { type: Boolean, default: false },
  title:   { type: String,  default: '' },
  rows:    { type: Array,   default: () => [] },
  labelField: { type: String, default: 'value' },
  countField: { type: String, default: 'screenPageViews' },
  /* dim: 同 BarList 同款, 给固定枚举值做展示层翻译 */
  dim:     { type: String,  default: '' },
  provider: { type: String, default: '' },
  rowProviderIcons: { type: Boolean, default: false },
  countMetrics: { type: Array, default: () => [] },
})

const emit = defineEmits(['close'])

const { t } = useI18n()

const PROVIDER_ICON = {
  ga4: '/images/icon/google-analytics.svg',
  gsc: '/images/icon/google-search-console.svg',
  bing: '/images/icon/bing-webmaster.svg',
}
const providerIcon = computed(() => PROVIDER_ICON[props.provider] || '')

function providersForRow(row) {
  const out = []
  const add = (provider) => {
    const key = String(provider || '').trim()
    if (key && PROVIDER_ICON[key] && !out.includes(key)) out.push(key)
  }
  add(row?.provider || row?.source_id)
  for (const provider of Object.keys(row?.providers || {})) add(provider)
  return out
}

function providerIconsForRow(row) {
  if (!props.rowProviderIcons) return []
  return providersForRow(row).map((provider) => ({ provider, icon: PROVIDER_ICON[provider] }))
}

const maxValue = computed(() => {
  let m = 0
  for (const r of props.rows) {
    const v = Number(r[props.countField]) || 0
    if (v > m) m = v
  }
  return m || 1
})

function pct(row) {
  return Math.min(100, ((Number(row[props.countField]) || 0) / maxValue.value) * 100).toFixed(1)
}

function formatInt(v) {
  const n = Number(v) || 0
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 10_000)    return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
  return n.toLocaleString()
}

function metricRawValue(row, metric) {
  if (metric.field !== 'ctr') return row?.[metric.field]
  const impressions = Number(row?.impressions) || 0
  if (!impressions) return 0
  return (Number(row?.clicks) || 0) / impressions
}

function formatMetricValue(row, metric) {
  const value = metricRawValue(row, metric)
  if (metric.format === 'rate1' || metric.field === 'ctr') {
    return ((Number(value) || 0) * 100).toFixed(1) + '%'
  }
  return formatInt(value)
}

function metricValueWidth(metric, rows) {
  const maxChars = rows.reduce((max, row) => Math.max(max, formatMetricValue(row, metric).length), 1)
  return `${maxChars}ch`
}

const visibleCountMetrics = computed(() =>
  (props.countMetrics || [])
    .map((m) => {
      const field = String(m?.field || m?.key || '').trim()
      const metric = {
        field,
        icon: String(m?.icon || '').trim(),
        color: String(m?.color || '').trim(),
        label: String(m?.label || '').trim(),
        format: String(m?.format || '').trim(),
        hideOnMobile: !!m?.hideOnMobile,
      }
      return { ...metric, valueWidth: metricValueWidth(metric, props.rows || []) }
    })
    .filter((m) => m.field),
)

function metricColumns(metric) {
  return metric.icon ? `0.875rem ${metric.valueWidth}` : metric.valueWidth
}

function metricStyle(metric) {
  return {
    gridTemplateColumns: metricColumns(metric),
    ...(metric.color ? { color: metric.color } : {}),
  }
}

function metricProviderTooltip(row, metric) {
  const rows = providersForRow(row)
    .map((provider) => {
      const metrics = row?.providers?.[provider]
      if (!metrics) return null
      if (metric.field !== 'ctr' && (metrics?.[metric.field] === undefined || metrics?.[metric.field] === null)) return null
      return {
        icon: PROVIDER_ICON[provider],
        alt: provider,
        value: formatMetricValue(metrics, metric),
      }
    })
    .filter(Boolean)

  return rows.length > 1 ? { rows } : ''
}

/* ---- ESC 关闭 ---- */
function onKeydown(e) { if (e.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="visible"
        class="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4 backdrop-blur-[3px]"
        @click.self="emit('close')"
      >
        <div class="flex h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
          <!-- Header -->
          <div class="flex items-center justify-between border-b border-gray-100 px-5 py-3">
            <div class="flex min-w-0 flex-1 items-center gap-1.5">
              <img v-if="providerIcon" :src="providerIcon" class="size-4 shrink-0" :alt="provider" />
              <h3 class="truncate text-base font-semibold text-gray-900">{{ title }}</h3>
            </div>
            <button
              class="flex size-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              :aria-label="t('common.close')"
              @click="emit('close')"
            >
              <NuxtIcon name="ri:close-line" class="size-5" />
            </button>
          </div>

          <!-- 列表 -->
          <div v-if="!rows.length" class="flex flex-1 items-center justify-center text-sm text-gray-400">
            {{ t('metrics.no_data') }}
          </div>
          <ul v-else class="flex-1 divide-y divide-gray-50 overflow-y-auto px-5 py-2">
            <li
              v-for="(row, i) in rows"
              :key="i"
              class="relative flex items-center justify-between gap-3 py-2"
            >
              <div
                class="absolute inset-y-1 left-0 -z-0 rounded bg-blue-50"
                :style="{ width: pct(row) + '%' }"
              />
              <div class="relative z-10 min-w-0 flex-1 truncate px-1.5 text-sm text-gray-700">
                <slot name="label" :row="row" :index="i">
                  <span class="flex min-w-0 items-center gap-1.5" v-tooltip.overflow="labelTooltip(row)">
                    <img
                      v-for="item in providerIconsForRow(row)"
                      :key="item.provider"
                      :src="item.icon"
                      class="size-4 shrink-0"
                      :alt="item.provider"
                    />
                    <span class="min-w-0 truncate">{{ displayValue(row[labelField]) || '—' }}</span>
                  </span>
                </slot>
              </div>
              <div
                v-if="visibleCountMetrics.length"
                class="relative z-10 flex shrink-0 items-center justify-end gap-2.5 px-1 text-xs font-medium tabular-nums text-gray-600 sm:text-sm"
              >
                <span
                  v-for="m in visibleCountMetrics"
                  :key="m.field"
                  :class="[m.hideOnMobile ? 'hidden lg:inline-grid' : 'inline-grid', 'items-center gap-x-1']"
                  :style="metricStyle(m)"
                  :aria-label="m.label"
                  v-tooltip="metricProviderTooltip(row, m)"
                >
                  <NuxtIcon
                    v-if="m.icon"
                    :name="m.icon"
                    class="size-3.5 shrink-0 justify-self-center"
                  />
                  <span class="justify-self-start text-left">{{ formatMetricValue(row, m) }}</span>
                </span>
              </div>
              <div v-else class="relative z-10 shrink-0 px-1.5 text-sm font-medium tabular-nums text-gray-700">
                {{ formatInt(row[countField]) }}
              </div>
            </li>
          </ul>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
