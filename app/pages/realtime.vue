<template>
  <!-- ============================================================
       Realtime - 全站点实时聚合
       60s 自动刷新, 倒计时显示, 页面不可见时暂停
       工具栏: 倒计时 / 排序 / 脱敏 / 手动刷新
       ============================================================ -->
  <div class="px-6 py-6 lg:px-10">
    <!-- ============ Header (ga-lite 紧凑风) ============ -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <h1 class="text-xl font-bold text-gray-900">{{ $t('realtime.title') }}</h1>
        <span class="relative flex size-2">
          <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span class="relative inline-flex size-2 rounded-full bg-emerald-500" />
        </span>
      </div>
      <span
        v-if="autoEnabled && countdown > 0 && isLoggedIn"
        class="text-xs tabular-nums text-gray-400"
      >
        {{ $t('realtime.toolbar.next_refresh', { n: countdown }) }}
      </span>
    </div>

    <!-- ============ 工具栏: 周期切换 / 地图开关 / 脱敏 / 排序 / 刷新 ============ -->
    <div class="mt-4 flex flex-wrap items-center justify-between gap-2">
      <PeriodSwitcher v-model="period" :options="periodOptions" responsive />
      <div class="flex items-center gap-1.5">
        <!-- 地图开关: 与 HideToggle 同款样式; 关闭态地球叠一道划线 (禁止/隐藏语义) -->
        <button
          type="button"
          v-tooltip="showMap ? $t('realtime.toolbar.hide_map') : $t('realtime.toolbar.show_map')"
          class="inline-flex size-9 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700"
          :aria-label="showMap ? $t('realtime.toolbar.hide_map') : $t('realtime.toolbar.show_map')"
          :aria-pressed="showMap"
          @click="toggleMap"
        >
          <span class="relative inline-flex size-5 items-center justify-center">
            <NuxtIcon name="ri:earth-line" class="size-5" />
            <span
              v-if="!showMap"
              class="pointer-events-none absolute left-1/2 top-1/2 h-[2px] w-[125%] -translate-x-1/2 -translate-y-1/2 -rotate-45 rounded-full bg-current shadow-[0_0_0_1.5px_white]"
            />
          </span>
        </button>
        <HideToggle v-model="hideNames" />
        <SortDropdown v-model="sortBy" :options="sortOptions" />
        <RefreshButton :loading="loading" @refresh="manualRefresh" />
      </div>
    </div>

    <!-- ============ 实时全球地图 (默认折叠, 地球图标切换, 占满整屏宽) ============ -->
    <div v-if="showMap && isLoggedIn" class="mt-4">
      <WorldMap
        :data="mapData"
        :minute-data="minuteData"
        :period-label="activePeriodLabel"
      />
    </div>

    <!-- ============ 登录用户加载中: 骨架屏卡片网格 ============ -->
    <!-- ============ 加载骨架: 跟 /projects 同样的 fetched 守卫
         - !fetched: 首次进入 (SSR 预拉失败兜底 / 未登录窗口) 走骨架占位
         - useState 跨页保留, 切回时 fetched 仍为 true, 不会闪骨架 ============ -->
    <div
      v-if="isLoggedIn && !fetched"
      class="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
    >
      <RealtimeSiteCard mode="overview" :overview-label="$t('overview.all_sites')" :loading="true" />
      <RealtimeSiteCard v-for="i in 5" :key="i" mode="site" :loading="true" />
    </div>

    <!-- ============ 空态: fetched=true 且 projects=[] 才判 ============ -->
    <EmptyState
      v-else-if="isLoggedIn && fetched && !projects.length"
      :title="$t('realtime.empty')"
      :description="$t('realtime.empty_desc')"
      :cta-label="$t('projects.detail.add_data_source')"
      :cta-to="localePath('/integrations')"
    />

    <!-- ============ 网格 ============ -->
    <div
      v-else-if="isLoggedIn"
      class="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
    >
      <RealtimeSiteCard
        mode="overview"
        :overview-label="`${$t('overview.all_sites')} (${projects.length})`"
        :active-users="totalActive"
        :loading="false"
        :number-loading="isLoggedIn && loading"
      />
      <div
        v-for="(p, idx) in sortedProjects"
        :key="p.project_key"
        class="relative min-w-0"
      >
        <RealtimeSiteCard
          mode="site"
          :project="p"
          :active-users="p.active_users_30min == null ? null : Number(p.active_users_30min || 0)"
          :loading="false"
          :number-loading="isLoggedIn && loading"
          :hide-names="hideNames"
          :index="idx"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
definePageMeta({ layout: 'app' })

/* ============================================================
   /realtime - 全站点实时
   核心:
     - 60s 自动刷新 + 1s 倒计时
     - document.hidden -> 暂停定时器 (visibilitychange)
     - 默认全部项目 (后端已移除 realtime_dashboard 过滤)
     - 工具栏: 排序 / 脱敏 / 手动刷新
   ============================================================ */

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import EmptyState from '~/components/layout/EmptyState.vue'
import HideToggle from '~/components/layout/HideToggle.vue'
import RefreshButton from '~/components/layout/RefreshButton.vue'
import SortDropdown from '~/components/layout/SortDropdown.vue'
import PeriodSwitcher from '~/components/metrics/PeriodSwitcher.vue'
import RealtimeSiteCard from '~/components/projects/RealtimeSiteCard.vue'
import WorldMap from '~/components/metrics/WorldMap.vue'

const { isLoggedIn } = useAuth()
const localePath = useLocalePath()

const { fetchRealtimeAll } = useGlobalMetrics()
const { fetched: projectsFetched, fetchList: fetchProjectsList } = useProjects()
const { show: showToast } = useToast()
const { t } = useI18n()

/* ---- 浏览器标签标题: "实时概况 · account@example.com - GA Lite" ---- */
const pageTitle = useAccountTitle(() => t('realtime.title'))
useHead({ title: () => pageTitle.value })

/* ---- localStorage keys ---- */
const LS_SORT   = 'galite:realtime:sort'
const LS_HIDE   = 'galite:realtime:hide_names'
const LS_PERIOD = 'galite:realtime:period'
const LS_MAP    = 'galite:realtime:show_map'

/* ---- 数据态 (useState 跨页保留, 让 SSR 拉到的数据水合到 client,
        切回页面看到的是缓存数据而非骨架; onMounted 后台再拉一次保持新鲜) ---- */
const projects    = useState('galite:realtime:projects',     () => [])
const totalActive = useState('galite:realtime:total-active', () => 0)
const fetched     = useState('galite:realtime:fetched',      () => false)
/* loading: 仅当前组件态 (本地 ref), 跨页不保留 — 每次进入页面默认假
   onMounted 拉数据时再 set 一次. 控制 number-loading pulse 时机 */
const loading = ref(false)

/* ---- 地图态: showMap 控制全球地图显示 (默认显示; 用户关闭后 localStorage 记住不再显示),
        mapData 为全站点 by_country 数组, useState 跨 SSR/client 防水合不一致 ---- */
const showMap = ref(true)
const mapData = useState('galite:realtime:map-data', () => [])
const minuteData = useState('galite:realtime:minute-data', () => [])

/* ---- 工具栏态 ---- */
const sortBy = ref('active')
const hideNames = ref(false)
const period = ref('30min')

/* ---- 实时周期选项 (与 server constants RealtimePeriod 对齐) ---- */
const periodOptions = computed(() => [
  { value: '30min', label: t('metrics.period.realtime_30min') },
  { value: '5min',  label: t('metrics.period.realtime_5min') },
  { value: '1min',  label: t('metrics.period.realtime_1min') },
])
const activePeriodLabel = computed(() =>
  periodOptions.value.find((item) => item.value === period.value)?.label || '',
)

/* ---- 定时器: 自动 60s + 倒计时 1s; visibilitychange 暂停 ---- */
const REFRESH_INTERVAL = 60
const countdown = ref(REFRESH_INTERVAL)
const autoEnabled = ref(true)
let tickTimer = null

const sortOptions = computed(() => [
  { value: 'active',  label: t('realtime.toolbar.sort_active') },
  { value: 'created', label: t('realtime.toolbar.sort_created') },
])

const sortedProjects = computed(() => {
  const items = [...projects.value]
  if (sortBy.value === 'active') {
    return items.sort(
      (a, b) => Number(b.active_users_30min || 0) - Number(a.active_users_30min || 0),
    )
  }
  /* created: 后端已按 project_list 顺序返回, 这里不动 */
  return items
})

async function ensureProjectsList() {
  if (!isLoggedIn.value || projectsFetched.value) return
  await fetchProjectsList().catch(() => null)
}

/* ============================================================
   load - 拉数据 (manual / auto 共用)
   ============================================================ */

async function load() {
  if (!isLoggedIn.value) return
  await ensureProjectsList()
  try {
    const res = await fetchRealtimeAll(period.value)
    if (res?.code === 200) {
      projects.value = res.data?.projects || []
      totalActive.value = Number(res.data?.total_active_users_30min || 0)
      /* by_country 行是 { code, value, activeUsers }; WorldMap 要 { code, count } — 映射对齐 */
      mapData.value = (res.data?.by_country || []).map((r) => ({ code: r.code, count: r.activeUsers }))
      minuteData.value = Array.isArray(res.data?.by_minute) ? res.data.by_minute : []
    } else {
      showToast(res?.msg || t('metrics.realtime_failed'), { type: 'error' })
    }
  } catch (err) {
    /* 静默: 401 由 useApi 标 silent, 其它仅首次失败提示, 后续轮询失败不打扰 */
    if (!err?.silent && loading.value) {
      showToast(err?.message || t('metrics.realtime_failed'), { type: 'error' })
    }
  } finally {
    loading.value = false
    /* 无论成败标记 fetched, 让骨架退场 (失败时让空态/已有数据自己决定渲染) */
    fetched.value = true
  }
}

/* 地图只控显示开关; 数据已随 load() 从 realtime 端点的 by_country 拿到 (与站点卡同源同步) */
function toggleMap() {
  showMap.value = !showMap.value
  if (typeof window !== 'undefined') localStorage.setItem(LS_MAP, showMap.value ? '1' : '0')
}

/* ============================================================
   SSR 预拉 (setup 顶层 await, 仅 server 阶段执行)
   首屏直出真实卡片网格而非骨架, useState hydration 把数据带到 client.
   失败静默 → fetched 仍 false → client 端骨架兜底 + onMounted 补拉.
   ============================================================ */
if (import.meta.server && isLoggedIn.value && !fetched.value) {
  await load().catch(() => {})
}

async function manualRefresh() {
  if (loading.value) return
  loading.value = true
  await load()
  countdown.value = REFRESH_INTERVAL
}

/* ============================================================
   1s tick: 倒计时, 触底拉数据
   visibilitychange: hidden 暂停 / visible 立刻刷一次
   ============================================================ */

function startTimer() {
  if (tickTimer || !autoEnabled.value) return
  tickTimer = window.setInterval(async () => {
    countdown.value -= 1
    if (countdown.value <= 0) {
      countdown.value = REFRESH_INTERVAL
      await load()
    }
  }, 1000)
}

function stopTimer() {
  if (!tickTimer) return
  window.clearInterval(tickTimer)
  tickTimer = null
}

function onVisibilityChange() {
  if (document.hidden) {
    autoEnabled.value = false
    stopTimer()
  } else {
    autoEnabled.value = true
    countdown.value = REFRESH_INTERVAL
    load()
    startTimer()
  }
}

/* ============================================================
   持久化: localStorage 同步
   ============================================================ */

watch(sortBy, (v) => {
  if (typeof window !== 'undefined') localStorage.setItem(LS_SORT, v)
})
watch(hideNames, (v) => {
  if (typeof window !== 'undefined') localStorage.setItem(LS_HIDE, v ? '1' : '0')
})
watch(period, async (v) => {
  if (typeof window !== 'undefined') localStorage.setItem(LS_PERIOD, v)
  countdown.value = REFRESH_INTERVAL
  loading.value = true /* 触发卡片数字骨架屏 */
  await load()
})

onMounted(() => {
  if (typeof window !== 'undefined') {
    const s = localStorage.getItem(LS_SORT)
    if (s) sortBy.value = s
    hideNames.value = localStorage.getItem(LS_HIDE) === '1'
    const p = localStorage.getItem(LS_PERIOD)
    if (p) period.value = p
    showMap.value = localStorage.getItem(LS_MAP) !== '0'   /* 默认显示, 仅用户显式关闭过(存 '0')才隐藏 */
  }
  load()
  if (typeof window !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange)
    startTimer()
  }
})

onUnmounted(() => {
  stopTimer()
  if (typeof window !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
})
</script>
