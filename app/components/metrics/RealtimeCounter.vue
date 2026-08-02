<template>
  <!-- ============================================================
       RealtimeCounter - 大号活跃用户数 + 三栏 (国家 / 设备 / 页面)
       ============================================================ -->
  <div class="rounded-2xl border border-gray-200 bg-white p-6">
    <!-- ============ 顶部: 大号数字 + 心跳 ============ -->
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <div class="text-xs uppercase tracking-wide text-gray-400">
          {{ $t('realtime.active_users') }}
        </div>
        <div class="mt-1 flex items-center gap-3">
          <div class="text-5xl font-bold text-gray-900 tabular-nums">
            {{ formatInt(data?.active_users_30min || 0) }}
          </div>
          <span class="relative flex size-3">
            <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span class="relative inline-flex size-3 rounded-full bg-emerald-500" />
          </span>
        </div>
      </div>
      <div v-if="updatedAt" class="text-xs text-gray-400">
        {{ $t('realtime.last_updated', { time: updatedAt }) }}
      </div>
    </div>

    <!-- ============ 三栏 ============ -->
    <div class="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
      <div
        v-for="bucket in buckets"
        :key="bucket.key"
        class="rounded-xl border border-gray-100 bg-gray-50/40 p-4"
      >
        <div class="text-xs font-medium uppercase tracking-wide text-gray-500">
          {{ bucket.title }}
        </div>
        <div v-if="!bucket.rows.length" class="mt-3 text-xs text-gray-400">—</div>
        <ul v-else class="mt-3 space-y-2">
          <li
            v-for="(r, i) in bucket.rows.slice(0, 6)"
            :key="i"
            class="flex items-center gap-2 text-sm"
          >
            <span class="min-w-0 flex-1 truncate text-gray-700" :title="r.value">
              {{ r.value || '—' }}
            </span>
            <div class="h-1.5 w-12 overflow-hidden rounded-full bg-gray-200">
              <div
                class="h-full rounded-full bg-primary"
                :style="{ width: pct(r.activeUsers, bucket.max) + '%' }"
              />
            </div>
            <span class="w-8 text-right font-mono text-xs text-gray-500">
              {{ formatInt(r.activeUsers) }}
            </span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup>
/* ============================================================
   RealtimeCounter
   data: { active_users_30min, by_country, by_device, by_page, fetched_at }
   ============================================================ */

import { computed } from 'vue'

const props = defineProps({
  data: { type: Object, default: () => null },
})

const { t } = useI18n()

const updatedAt = computed(() => {
  const ts = props.data?.fetched_at
  if (!ts) return ''
  return new Date(ts * 1000).toLocaleTimeString()
})

function formatInt(v) {
  const n = Number(v) || 0
  return n.toLocaleString()
}

function maxOf(rows) {
  let m = 0
  for (const r of rows || []) if ((r.activeUsers || 0) > m) m = r.activeUsers
  return m || 1
}

function pct(v, max) {
  return Math.min(100, ((Number(v) || 0) / max) * 100).toFixed(1)
}

/* ---- 三栏统一定义, 避免模板重复 ---- */
const buckets = computed(() => {
  const d = props.data || {}
  return [
    { key: 'country', title: t('realtime.by_country'), rows: d.by_country || [], max: maxOf(d.by_country) },
    { key: 'device',  title: t('realtime.by_device'),  rows: d.by_device  || [], max: maxOf(d.by_device) },
    { key: 'page',    title: t('realtime.by_page'),    rows: d.by_page    || [], max: maxOf(d.by_page) },
  ]
})
</script>
