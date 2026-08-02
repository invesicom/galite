<script setup>
/* ============================================================
   BarList - 维度 Top N 排行卡片
   --
   每行: 后景进度条 (按 max(value) 算百分比, bg-blue-50)
         + 标签 (含国旗等自定义渲染槽 #label) + 数字右对齐
   显示前 10 行, 数据 > 10 时标题右侧"更多"按钮触发 emit('view-more')
   --
   props.data:    [{ value, screenPageViews, sessions, totalUsers, ... }] (后端 dimension API 返回行)
                  也可以 BarList-original 风格 [{label, count, ...}], 通过 props.labelField/countField 适配
   props.title:   卡片标题
   props.loading: 骨架屏开关
   ============================================================ */

import { computed } from 'vue'
import { localizeDimensionValue } from '~/utils/dimension-i18n'

/* 展示层翻译: GA4 原值 (如 "(direct)") → 本地化字符串 ("直接访问")
   未命中映射 / 未传 dim 时返原值. row[labelField] 默认是 row.value (原值) */
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
  title:        { type: String,  default: '' },
  data:         { type: Array,   default: () => [] },
  loading:      { type: Boolean, default: false },
  labelField:   { type: String,  default: 'value' },           /* 行内显示文本字段 */
  countField:   { type: String,  default: 'screenPageViews' }, /* 行内显示数字字段 (排序+进度条基准) */
  emptyMessage: { type: String,  default: '' },
  /* dim: 当前维度 key (sessionSource / deviceCategory / ...), 给固定枚举值
     做展示层翻译 — 数据层 row.value 保留 GA4 原值, 这里渲染时 localize.
     不传 / 未在 dimension-i18n DIM_VALUE_I18N 命中时返原值, 兼容旧调用. */
  dim:          { type: String,  default: '' },
  /* provider: ga4 | gsc | '' — 标题左侧渲染对应数据源 logo,
     让 12 张卡里出现的"页面/国家/设备"3 对同名维度能一眼分辨数据来源. */
  provider:     { type: String,  default: '' },
  /* rowProviderIcons: 多 Search provider 聚合列表使用.
     单源时 provider 图标放标题; 多源时每行从 row.provider / row.providers 渲染来源图标. */
  rowProviderIcons: { type: Boolean, default: false },
  /* countMetrics: 右侧多指标显示, 例如 Search Queries 同时显示 clicks / impressions.
     不传时保持旧的单 countField 数字, 避免污染普通维度卡. */
  countMetrics: { type: Array, default: () => [] },
  /* flat: 去自身圆角/边框/最小高, 融入父级大卡片 (保留 bg-white 给网格分隔线透色) */
  flat:         { type: Boolean, default: false },
})

/* ---- provider → logo asset (与 utils/filters.js PROVIDER_ICON 同源) ---- */
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

defineEmits(['view-more'])

const { t } = useI18n()

/* ---- 显示前 10 行 (后端已按 countField 降序), >10 才显示"更多"按钮 ---- */
const TOP = 10
const visible = computed(() => (props.data || []).slice(0, TOP))
const hasMore = computed(() => (props.data || []).length > TOP)

/* ---- 进度条基准: 单卡片内的最大值 (与 ga-lite 一致) ---- */
const maxValue = computed(() => {
  let m = 0
  for (const r of visible.value) {
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
      return { ...metric, valueWidth: metricValueWidth(metric, visible.value) }
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
</script>

<template>
  <!-- min-h 计算 (字号升级后重算):
       p-4 (32) + h-6 (24) + mb-3 (12) + 10 li × py-1.5+h-5 (32) + 9 divide-y (9) = 397px
       覆盖 10 行卡片自然高 397, 同 grid 不同 row 不会差 4px 抖动 -->
  <div :class="['flex flex-col bg-white p-4', flat ? 'min-h-[280px]' : 'h-full min-h-[397px] rounded-xl border border-gray-200']">
    <!-- ============ 标题行: title + "更多"按钮 (>10 行时显示)
         flex items-center + h-6 锁定行高 (text-base 14px → 升 text-base 16px line-24) ============ -->
    <div class="mb-3 flex h-6 items-center justify-between gap-2">
      <div class="flex min-w-0 flex-1 items-center gap-1.5">
        <!-- provider logo (size-4 与文字基线对齐, 留出小间隔) -->
        <img
          v-if="providerIcon"
          :src="providerIcon"
          class="size-4 shrink-0"
          :alt="provider"
        />
        <h3 class="truncate text-base font-semibold leading-6 text-gray-900">{{ title }}</h3>
      </div>
      <!-- 更多按钮: 灰色文字 + 右箭头 (展开语义, 不是 a 标签链接风)
           text-primary hover:underline 会让用户误以为是"跳转外部链接"; 实际是
           展开 modal 看完整列表, 用 chevron-right 传达"打开内嵌区域"更准 -->
      <button
        v-if="!loading && hasMore"
        type="button"
        class="inline-flex shrink-0 items-center gap-0.5 rounded text-sm text-gray-500 transition-colors hover:text-gray-900"
        @click="$emit('view-more')"
      >
        {{ t('projects.detail.view_more') }}
        <NuxtIcon name="ri:arrow-right-s-line" class="size-4" />
      </button>
    </div>

    <!-- ============ 加载骨架屏 (10 行, 与真实 list 同 row 结构: divide-y + py-1.5 + h-5)
         任何调整必须同步两侧, 否则切周期会闪现高度抖动 ============ -->
    <ul v-if="loading" class="flex-1 divide-y divide-gray-50">
      <li
        v-for="i in 10"
        :key="i"
        class="flex h-8 items-center justify-between gap-3 py-1.5"
      >
        <div class="h-5 w-3/5 animate-pulse rounded bg-gray-100" />
        <div :class="['h-5 animate-pulse rounded bg-gray-100', visibleCountMetrics.length ? 'w-36 lg:w-52' : 'w-10']" />
      </li>
    </ul>

    <!-- ============ 空数据 ============ -->
    <div
      v-else-if="!visible.length"
      class="flex flex-1 items-center justify-center text-xs text-gray-400"
    >
      {{ emptyMessage || t('metrics.no_data') }}
    </div>

    <!-- ============ 行列表 ============ -->
    <ul v-else class="flex-1 divide-y divide-gray-50">
      <li
        v-for="(row, i) in visible"
        :key="i"
        class="relative flex h-8 items-center justify-between gap-3 py-1.5"
      >
        <!-- 后景进度条 (绝对定位, 不影响行高) -->
        <div
          class="absolute inset-y-1 left-0 -z-0 rounded bg-blue-50"
          :style="{ width: pct(row) + '%' }"
        />
        <!-- 标签 (槽, 调用方可注入国旗 / 浏览器图标等);
             默认渲染: 把 row[labelField] (原值) 经 dim-i18n 翻译为本地化文本
             leading-5 显式锁定文字行高 20px, 跟骨架 h-5 严格等高 -->
        <div class="relative z-10 min-w-0 flex-1 truncate px-1.5 text-sm leading-5 text-gray-700">
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
        <!-- 数字: 普通列表显示单指标; Search Queries 可显示 clicks / impressions 双指标 -->
        <div
          v-if="visibleCountMetrics.length"
          class="relative z-10 flex shrink-0 items-center justify-end gap-2.5 px-1 text-xs font-medium leading-5 tabular-nums text-gray-600 sm:text-sm"
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
        <div v-else class="relative z-10 shrink-0 px-1.5 text-sm font-medium leading-5 tabular-nums text-gray-700">
          {{ formatInt(row[countField]) }}
        </div>
      </li>
    </ul>
  </div>
</template>
