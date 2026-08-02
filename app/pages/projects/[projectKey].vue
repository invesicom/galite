<template>
  <!-- ============================================================
       Project Detail - 项目详情 (单行 toolbar 模式)
       结构:
         工具栏 (sticky 悬顶, 单行): 站点切换器 + 周期 + 筛选 + 刷新
         SummaryCards × 4 (visitors / page_views / bounce / duration, 含骨架屏)
         TimeseriesChart (默认 screenPageViews, 可下拉切换, 含骨架屏)
         8 卡片 BarList 网格 (sources / pages / events / countries / ...)
         实时板块 (地图 + 明细 4 卡)
           BarList > 10 行右上角"更多" → DimensionDetailModal (key 注册表统一驱动)
         FunnelSection (转化漏斗)
       ============================================================ -->
  <div
    class="px-6 pb-6 pt-3 lg:px-10"
    :class="(!isLoggedIn || disconnected) ? 'pointer-events-none select-none' : ''"
    :aria-hidden="(!isLoggedIn || disconnected) ? 'true' : undefined"
  >
    <template v-if="isLoggedIn && loading && !project">
      <div class="mt-12 text-center text-sm text-gray-400">{{ $t('common.loading') }}</div>
    </template>

    <EmptyState
      v-else-if="isLoggedIn && !project"
      :title="$t('projects.not_found')"
      :cta-label="$t('projects.detail.back')"
      :cta-to="localePath('/projects')"
    />

    <template v-else-if="isLoggedIn">
      <!-- ============ 工具栏: 站点切换 + 周期 + 筛选 + 刷新 (单行 sticky)
           Header 已合并进来 — 站点切换器 (favicon+名字) 作为第一个 dropdown,
           跟 PeriodSwitcher / FilterAddDropdown / RefreshButton 同款视觉.
           --
           sticky 悬顶 + stuck 态变样:
             normal:  透明背景 + 透明边框 (融入页面 bg-gray-50)
             stuck:   bg-white/95 backdrop-blur + border-gray-100 (浮起感)
           sentinel + IntersectionObserver 检测是否滚出 viewport 顶部 ============ -->
      <div ref="stickySentinel" aria-hidden="true" class="h-0"></div>
      <div
        :class="[
          'sticky top-12 z-20 -mx-6 flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-6 py-3 transition-colors md:top-0 lg:-mx-10 lg:px-10',
          toolbarStuck
            ? 'border-gray-100 bg-white/95 backdrop-blur'
            : 'border-transparent bg-transparent',
        ]"
      >
        <!-- 站点切换器: PC 显在 toolbar 左上, 移动端入口在顶部 header 中间
             用 div + hidden md:contents 包: 移动端整组不渲染, md+ 时 div 自己消失
             (md:contents) 让 SiteSwitcherButton 直接是 toolbar 的 flex 子项,
             保持 toolbar gap 间距正常.
             ⚠️ 不能给 SiteSwitcherButton 直接加 hidden 类 — 它根元素自带
                 inline-flex, Tailwind utility 顺序 inline-flex 在 hidden 之后,
                 会覆盖 hidden 让移动端仍然显示 -->
        <div class="hidden md:contents">
          <SiteSwitcherButton
            :favicon-url="faviconUrl"
            :name="project?.name || ''"
            @open="openSwitcher"
          />
        </div>
        <div v-if="filters.length === 0" class="hidden md:block">
          <ProjectCardMenu
            mode="quick-access"
            :data-sources="dataSources"
            :site-url="project?.site_url || ''"
          />
        </div>
        <FilterBar
          :filters="filters"
          @remove="onRemoveFilter"
          @clear-all="onClearFilters"
          @edit="onEditFilter"
        />
        <!-- dataSource 切换 (仅双源项目显示): iOS-style segmented, 只 logo 无文字
             - 灰底容器 + 内部按钮 = "这是个切换器"
             - 激活态 → 白底 + shadow-sm 浮起
             - 非激活态 → 透明 (退到背景)
             - logo 自身就是 Google 系产品强识别符, 文字冗余, 去掉腾出空间
             图标尺寸抵消 SVG 内部留白: GA4 size-4 / GSC size-5 -->
        <div v-if="hasGa4 && hasSearch" class="ml-auto inline-flex h-9 items-center rounded-md bg-gray-100 p-0.5 md:h-10">
          <button
            v-for="opt in [
              { value: 'ga4', icon: '/images/icon/google-analytics.svg',     iconSize: 'size-4', label: 'Google Analytics' },
              { value: 'search', iconRi: 'ri:search-line', iconSize: 'size-4', label: 'Search' },
            ]"
            :key="opt.value"
            v-tooltip="opt.label"
            type="button"
            :class="[
              'flex h-full items-center justify-center rounded px-2 transition-all',
              dataSource === opt.value
                ? 'bg-white shadow-sm'
                : 'opacity-50 hover:opacity-80',
            ]"
            :aria-pressed="dataSource === opt.value"
            :aria-label="opt.label"
            @click="dataSource = opt.value"
          >
            <img v-if="opt.icon" :src="opt.icon" :class="opt.iconSize + ' shrink-0 object-contain'" :alt="opt.label" />
            <NuxtIcon v-else :name="opt.iconRi" :class="opt.iconSize + ' shrink-0 text-gray-700'" />
          </button>
        </div>
        <!-- + 筛选: 移动端 order-first 放最左 (用户高频入口前置);
             PC 端 order-none 回到右组, 与 PeriodSwitcher/RefreshButton 同一群组;
             单源项目 PC 端用 md:ml-auto 推右组贴右, 双源时 segmented 自带 ml-auto 已足够 -->
        <FilterAddDropdown
          :class="[
            'order-first md:order-none',
            (hasGa4 && hasSearch) ? '' : 'md:ml-auto',
          ]"
          :data-source="dataSource"
          :search-providers="mountedSearchProviders"
          @pick-dim="onPickDim"
        />
        <!-- 详情页时段选项扩展: 默认 5 + 半年/1年 (列表/实时页不需要这么长周期)
             allow-custom: 末尾追加"自定义"入口, 点击弹 CustomDateModal 选单日/区间 -->
        <PeriodSwitcher
          v-model="period"
          :options="detailPeriodOptions"
          allow-custom
          @request-custom="customModalVisible = true"
        />
        <RefreshButton :loading="anyLoading" @refresh="manualRefresh" />
      </div>

      <!-- ============ 筛选第二步弹窗: 输入匹配规则 ============
           添加模式: 维度由 FilterBar 下拉预选, initial=null
           编辑模式: 由 chip 点击进入, 携带 initial { match, value } 回填表单 -->
      <FilterAddModal
        :visible="filterAddVisible"
        :dim="filterAddDim"
        :initial="filterAddInitial"
        :dims-map="dimsMap"
        :project-key="projectKey"
        :period="period"
        :all-filters="filters"
        :search-providers="mountedSearchProviders"
        @close="filterAddVisible = false"
        @add="onAddFilter"
      />

      <!-- ============ 自定义日期选择弹窗 (单日 / 起止区间)
           apply 回调把选择写成 period=custom_START_END, 复用现有 period 全链路 -->
      <CustomDateModal
        :visible="customModalVisible"
        :model-value="period"
        @close="customModalVisible = false"
        @apply="onApplyCustom"
      />

      <!-- ============ 主体 ============ -->
      <!-- ============ Search 数据源视图 (GSC + Bing 聚合, 含 provider 子切换) ============ -->
      <ProjectDetailSearch
        v-if="dataSource === 'search'"
        ref="searchDetailRef"
        :project-key="projectKey"
        :period="period"
        :filters="filters"
        :project="project"
        :data-sources="dataSources"
      />

        <!-- ============ GA4 数据源视图 (原详情页内容, 用 v-else 包裹) ============ -->
        <template v-else>
        <!-- ============ 4 张核心指标卡 (周期切换时全 skeleton; checkbox 驱动图表叠加)
             mt-2 紧贴工具栏 — 控制条不属于"内容区"间距体系, 跟控制对象贴近 ============ -->
        <section class="mt-2">
          <SummaryCards
            :metrics="summary?.metrics || {}"
            :previous-metrics="summary?.previous_metrics || {}"
            :loading="metricsLoading.summary"
            v-model:selected-metrics="selectedMetrics"
          />
        </section>

        <!-- ============ 时序图 (周期切换时 skeleton; 数据由 selectedMetrics 多指标合并) ============ -->
        <section class="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
          <TimeseriesChart
            :data="timeseries"
            :loading="metricsLoading.timeseries"
            :expected-series-count="selectedMetrics.length"
          />
        </section>

        <!-- ============ Top Dimensions: 8 卡片 4 列网格 (周期切换时 skeleton) ============ -->
        <section class="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <BarList
            v-for="d in DIM_CONFIGS"
            :key="d.key"
            :title="$t(d.titleKey)"
            :data="dimsMap[d.key] || []"
            :loading="dimsLoading"
            :count-field="d.count"
            :dim="d.key"
            @view-more="openDimDetail(d.key)"
          >
            <template v-if="d.key === 'country'" #label="{ row }">
              <div class="flex min-w-0 items-center gap-2">
                <CountryFlag :code="row.value" :size="16" />
                <span class="truncate text-sm text-gray-700">{{ countryNames.nameOf(row.value) || localizeDimensionValue('country', row.value, t) || row.value }}</span>
                <span v-if="getCountryTier(row.value)" class="shrink-0 text-xs text-gray-400">
                  {{ getCountryTier(row.value) }}
                </span>
              </div>
            </template>
          </BarList>
        </section>

        <!-- ============ Search 搜索关键词卡 (仅 hasSearch 时显示, 独立 section)
             单卡占整行全宽, 让长关键词文本完整展开;
             不混入 8 维度网格 — 维持 GA4 卡片体验的纯粹性 ============ -->
        <section v-if="hasSearch" class="mt-6">
          <BarList
            :title="$t('projects.dim.search_queries')"
            :data="searchDimension?.rows || []"
            :loading="metricsLoading.searchDimension"
            count-field="impressions"
            dim="gscQuery"
            :provider="searchQueryTitleProvider"
            :row-provider-icons="searchQueryRowProviderIcons"
            :count-metrics="searchQueryCountMetrics"
            @view-more="openDimDetail('gscQuery')"
          />
        </section>

        <!-- ============ 实时板块: 地图 + 明细 Top (页面/事件/设备/城市) 合并一张大卡片,
             与上方 8 指标卡 / 下方漏斗在视觉上明确分块, 避免混淆.
             实时 API 维度有限 — 没有来源(source)维度, 故不含"流量来源" ============ -->
        <section class="mt-6 overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <WorldMap
            flat
            :data="realtimeGeo"
            :minute-data="realtime?.by_minute || []"
            :period-label="$t('realtime.map.last_30min')"
            :countdown="mapCountdown"
          />
          <!-- 实时明细 4 卡: 后端返 TOP_N=50 / 卡内显 10, >10 行右上角"更多"
               → 与 8 维度卡同一 DimensionDetailModal (key 走注册表 rt*) -->
          <div class="grid grid-cols-1 gap-px border-t border-gray-100 bg-gray-100 md:grid-cols-2 xl:grid-cols-4">
            <BarList flat :title="$t('realtime.detail.top_pages')"   :data="realtime?.by_page || []"   count-field="activeUsers" @view-more="openDimDetail('rtPages')" />
            <BarList flat :title="$t('realtime.detail.top_events')"  :data="realtime?.by_event || []"  count-field="eventCount" @view-more="openDimDetail('rtEvents')" />
            <BarList flat :title="$t('realtime.detail.top_devices')" :data="realtime?.by_device || []" count-field="activeUsers" dim="deviceCategory" @view-more="openDimDetail('rtDevices')" />
            <BarList flat :title="$t('realtime.detail.top_cities')"  :data="realtime?.by_city || []"   count-field="activeUsers" @view-more="openDimDetail('rtCities')" />
          </div>
        </section>

        <!-- ============ Funnels: 转化漏斗 (GA4 v1alpha runFunnelReport)
             period 跟随顶部全局 PeriodSwitcher, 同一页同一时间口径;
             ref 暴露 reload() 给 manualRefresh 整合刷新 -->
        <FunnelSection
          ref="funnelSectionRef"
          :project-key="projectKey"
          :disabled="!isLoggedIn || disconnected"
          :filters="filters"
          :page-suggestions="funnelPageSuggestions"
          :event-suggestions="funnelEventSuggestions"
          :period="period"
        />
      </template>  <!-- /GA4 视图 v-else -->

      <!-- ============ Dimension Detail Modal (URL 驱动) ============
           visible / 内容全部从 dimModalData computed (route.query.ga4_dim) 推导,
           关闭只清 URL 参数, 单一真相源 → 链接可分享可书签 -->
      <DimensionDetailModal
        v-if="hasGa4 && dataSource !== 'search'"
        :visible="!!dimModalData"
        :title="dimModalData?.title || ''"
        :rows="dimModalData?.rows || []"
        :count-field="dimModalData?.countField || 'screenPageViews'"
        :dim="dimModalData?.dim || ''"
        :provider="dimModalData?.provider || ''"
        :row-provider-icons="dimModalData?.rowProviderIcons || false"
        :count-metrics="dimModalData?.countMetrics || []"
        @close="closeDimDetail"
      >
        <template v-if="dimModalData?.key === 'country'" #label="{ row }">
          <div class="flex min-w-0 items-center gap-2">
            <CountryFlag :code="row.value" :size="16" />
            <span class="truncate text-sm text-gray-700">{{ countryNames.nameOf(row.value) || localizeDimensionValue('country', row.value, t) || row.value }}</span>
            <span v-if="getCountryTier(row.value)" class="shrink-0 text-xs text-gray-400">
              {{ getCountryTier(row.value) }}
            </span>
          </div>
        </template>
      </DimensionDetailModal>

      <!-- ============ 站点切换器 (保持 period 跳到其它站点详情) ============ -->
      <SiteSwitcherModal
        :visible="switcherVisible"
        :current-key="projectKey"
        :projects="switcherList"
        @close="switcherVisible = false"
        @select="onSwitchTo"
      />

      <!-- ============ 右下角悬浮产品 brand (仅移动端, 纯展示不可点)
           - fixed bottom-right, 半透明白底 + shadow 浮起
           - 不可点: 避免拇指误触跳走当前详情页 (用户在看数据时最不希望意外跳转)
           - 用户要回首页走顶部 brand (其他页面) / 汉堡 drawer (详情页) 已有入口
           - md:hidden 桌面端不渲染 ============ -->
      <div
        v-if="productLogo || productName"
        class="fixed bottom-4 end-4 z-30 flex items-center gap-1.5 rounded-full border border-gray-200 bg-white/95 px-3 py-1.5 shadow-md backdrop-blur md:hidden"
        :title="productName"
      >
        <img
          v-if="productLogo"
          :src="productLogo"
          class="size-4 shrink-0 rounded"
          alt=""
        />
        <span class="text-xs font-medium text-gray-700">{{ productName }}</span>
      </div>
    </template>

    <!-- ============ 资源断开引导态 ============
         登录用户的项目没有有效数据源时，引导其前往集成页重新连接。 -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div
          v-if="isLoggedIn && disconnected"
          class="fixed inset-0 z-[60] flex items-center justify-center bg-black/20 p-4 backdrop-blur-[3px]"
        >
          <div class="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <div class="flex items-center justify-center">
              <div class="flex size-12 items-center justify-center rounded-full bg-amber-50">
                <NuxtIcon name="ri:plug-2-line" class="size-6 text-amber-500" />
              </div>
            </div>
            <h3 class="mt-4 text-center text-lg font-bold text-gray-900">
              {{ $t('projects.detail.disconnected_title') }}
            </h3>
            <p class="mt-2 text-center text-sm text-gray-500">
              {{ $t('projects.detail.disconnected_desc') }}
            </p>
            <div class="mt-6 flex flex-col gap-2">
              <NuxtLink
                :to="localePath('/integrations')"
                class="inline-flex items-center justify-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-text hover:opacity-90"
              >
                <NuxtIcon name="ri:link-m" class="size-4" />
                {{ $t('projects.detail.disconnected_cta') }}
              </NuxtLink>
              <NuxtLink
                :to="localePath('/projects')"
                class="inline-flex items-center justify-center rounded-full px-4 py-2 text-sm text-gray-500 hover:bg-gray-50"
              >
                {{ $t('projects.detail.back') }}
              </NuxtLink>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

  </div>
</template>

<script setup>
definePageMeta({ layout: 'app' })

/* ============================================================
   /projects/[projectKey] - 项目详情页
   职责: 取项目 + 数据源 + 4 类指标
   设计: period 变化 -> watch 一键 refetch summary + timeseries + dimension
         data_sources 单独一份 ref, 与 useProjects.list 解耦
   ============================================================ */

import { computed, onBeforeUnmount, onMounted, onUnmounted, reactive, ref, watch, watchEffect } from 'vue'
import EmptyState from '~/components/layout/EmptyState.vue'
import RefreshButton from '~/components/layout/RefreshButton.vue'
import PeriodSwitcher from '~/components/metrics/PeriodSwitcher.vue'
import SummaryCards from '~/components/metrics/SummaryCards.vue'
import TimeseriesChart from '~/components/metrics/TimeseriesChart.vue'
import BarList from '~/components/metrics/BarList.vue'
import CountryFlag from '~/components/metrics/CountryFlag.vue'
import DimensionDetailModal from '~/components/metrics/DimensionDetailModal.vue'
import SiteSwitcherButton from '~/components/projects/SiteSwitcherButton.vue'
import SiteSwitcherModal from '~/components/projects/SiteSwitcherModal.vue'
import ProjectCardMenu from '~/components/projects/ProjectCardMenu.vue'
import ProjectDetailSearch from '~/components/projects/ProjectDetailSearch.vue'
import FunnelSection from '~/components/funnels/FunnelSection.vue'
import WorldMap from '~/components/metrics/WorldMap.vue'
import FilterBar from '~/components/metrics/FilterBar.vue'
import FilterAddDropdown from '~/components/metrics/FilterAddDropdown.vue'
import FilterAddModal from '~/components/metrics/FilterAddModal.vue'
import CustomDateModal from '~/components/metrics/CustomDateModal.vue'
import { parseCustomPeriod, buildCustomPeriod } from '~/utils/period'
import { getCountryTier } from '~/utils/country-tier'
import { localizeDimensionValue } from '~/utils/dimension-i18n'
import { METRIC_COLORS } from '~/utils/metric-colors'
import { parseFiltersFromQuery, filtersToQuery } from '~/utils/filters'
import { withMinLoading } from '~/utils/min-loading'
import { resolveProjectIcon } from '~/utils/project-icon'

const route = useRoute()
const router = useRouter()
const localePath = useLocalePath()
const { t, locale } = useI18n()
const configStore = useConfigStore()
const { isLoggedIn } = useAuth()

const projects = useProjects()
const { list: projectListRef, fetched: projectsFetched, fetchList: fetchProjectsList } = projects

const projectKey = computed(() => String(route.params.projectKey || ''))
/* ---- 站点切换器 ---- */
/* 跨 layout/page 共享 useState: 移动端顶部 header / PC toolbar SiteSwitcherButton 都设它 true
   detail page 内 SiteSwitcherModal :visible 绑定到此 ref */
const switcherVisible = useState('site-switcher-open', () => false)
const switcherList = computed(() => projectListRef.value || [])

/* PC toolbar SiteSwitcherButton 通过 @open 触发, 与移动端顶部入口共享同一 useState */
function openSwitcher() {
  switcherVisible.value = true
}

/* useState true 时按需补拉 projects 列表 (用户直接进 /projects/[key] 没经过 /projects) */
watch(switcherVisible, async (open) => {
  if (open && isLoggedIn.value && !projectsFetched.value) {
    try { await fetchProjectsList() } catch {}
  }
})
onBeforeUnmount(() => { switcherVisible.value = false })

function onSwitchTo(p) {
  switcherVisible.value = false
  if (!p?.project_key || p.project_key === projectKey.value) return
  /* 跨站点保留 period + filters + dataSource:
       period/filters 跨站对比同一切片是用户高频场景
       dataSource 让 Search 视图切站后仍保持 Search, 不强制回 GA4
       (新站点不支持当前 ds 时 watch(dataSources) 内会降级, 这里无脑带)
     dim 不带 — 维度详情是当前站点的临时态, 跨站无意义 */
  const query = {
    ...(period.value ? { period: period.value } : {}),
    ...(dataSource.value ? { ds: dataSource.value } : {}),
    ...filtersToQuery(filters.value),
  }
  router.push({ path: localePath(`/projects/${p.project_key}`), query })
}

/* ---- period 跨详情页持久化: localStorage 让"切站点保持筛选"成立 ---- */
const LS_DETAIL_PERIOD = 'galite:detail:period'
/* URL 参数白名单 — 详情页支持 7 个周期 (含 6months / 1year, 列表/实时页不需要)
   后端 MetricsPeriod + PERIOD_RANGES 已对齐这 7 个值, 不在白名单的值会被忽略走默认 */
const VALID_PERIODS = ['today', 'yesterday', '7days', '28days', '90days', '6months', '1year']

/* 合法周期判定: 固定 7 值 ∪ 合法 custom_START_END (与后端 isValidPeriod 对齐) */
function isAllowedPeriod(v) {
  return VALID_PERIODS.includes(v) || parseCustomPeriod(v) != null
}

/* 自定义日期弹窗: 选完写成 period=custom_START_END, 触发 watch(period) 全链路刷新 */
const customModalVisible = ref(false)
function onApplyCustom({ start, end }) {
  period.value = buildCustomPeriod(start, end)
}

/* PeriodSwitcher options (详情页专属 7 个): 默认 5 + 半年 + 1 年.
   列表/实时页用 default 5, 详情页用"长周期分析"需求驱动加长. */
const detailPeriodOptions = computed(() => [
  { value: 'today',     label: t('metrics.period.today') },
  { value: 'yesterday', label: t('metrics.period.yesterday') },
  { value: '7days',     label: t('metrics.period.7days') },
  { value: '28days',    label: t('metrics.period.28days') },
  { value: '90days',    label: t('metrics.period.90days') },
  { value: '6months',   label: t('metrics.period.6months') },
  { value: '1year',     label: t('metrics.period.1year') },
])

/* ---- 解构出顶层 ref, 让模板自动 unwrap.
       projectKey 传 computed (不是 .value), useMetrics 内部 unref 取最新值,
       这样"站点切换"路由参数变更后, fetchers 走的是新 key. ---- */
/* ============================================================
   筛选状态 (filters[])
   --
   初始值: URL > 默认空; URL 双向同步, 切站点不带 filter (跨站语义不通用)
   filterAddVisible: 添加筛选 modal 开关
   ============================================================ */
const filters = ref(parseFiltersFromQuery(route.query))
const filterAddVisible = ref(false)
const filterAddDim = ref('')        /* FilterBar pick-dim 选定后传给 FilterAddModal */
const filterAddInitial = ref(null)  /* 编辑模式: { match, value } 回填表单; null=添加模式 */
const filterAddIndex = ref(-1)      /* 编辑模式: 要替换的 filters[index]; -1=添加追加 */

const {
  period,
  summary,
  timeseries,
  searchDimension,
  realtime,
  loading: metricsLoading,
  fetchSummary,
  fetchSearchDimension,
  fetchRealtime,
} = useMetrics(projectKey, filters)

/* 实时地区分布 → 地图 data ([{code, count}]); realtime.by_country 含 ISO code + 全名 */
const realtimeGeo = computed(() =>
  (realtime.value?.by_country || []).map((r) => ({ code: r.code, count: r.activeUsers })),
)

/* ============================================================
   实时地图: 固定最近 30min, 60s 自动刷新 (独立轮询)
   倒计时显示在地图右上角; onMounted 启 / onUnmounted 清 / 切站点重置 /
   标签页隐藏暂停 — 避免泄漏、重复加载、后台空刷
   ============================================================ */
const MAP_REFRESH = 60
const mapCountdown = ref(MAP_REFRESH)
let mapTimer = null

function refreshMap() {
  mapCountdown.value = MAP_REFRESH
  if (hasGa4.value) fetchRealtime()
}
function startMapTimer() {
  if (mapTimer || typeof window === 'undefined') return
  mapTimer = window.setInterval(() => {
    mapCountdown.value -= 1
    if (mapCountdown.value <= 0) refreshMap()
  }, 1000)
}
function stopMapTimer() {
  if (mapTimer) { window.clearInterval(mapTimer); mapTimer = null }
}
function onMapVisibility() {
  if (document.hidden) stopMapTimer()
  else { refreshMap(); startMapTimer() }
}

const api = useApi()

/* ---- 详情数据 (单实例, 不走全局缓存) ---- */
const project = ref(null)
const dataSources = ref([])
const loading = ref(true)

/* ---- 浏览器标签标题: "站点名 · 网址 - GA Lite" (后缀由 app.vue titleTemplate 自动补)
        project 未加载/未找到时退回通用标题, 避免出现裸 "GA Lite" ---- */
const pageTitle = computed(() => {
  const p = project.value
  if (!p) return t('projects.title')
  const host = String(p.site_url || '').replace(/^https?:\/\//, '').replace(/\/+$/, '')
  const name = String(p.name || '').trim()
  if (name && host) return `${name} · ${host}`
  return name || host || t('projects.title')
})
useHead({ title: () => pageTitle.value })

/* ============================================================
   时序图指标多选 (PV/UV/跳出率/平均时长)
   --
   selectedMetrics: 由 SummaryCards checkboxes 驱动, 至少 1 个;
   默认勾 PV + UV 与业界 SaaS 习惯一致.
   持久到 localStorage 让用户的偏好跨刷新/切站点保留.
   ============================================================ */
const LS_DETAIL_METRICS = 'galite:detail:metrics'
const ALL_METRICS = ['screenPageViews', 'totalUsers', 'bounceRate', 'averageSessionDuration']
const DEFAULT_METRICS = ['screenPageViews', 'totalUsers']

function loadSelectedMetrics() {
  if (typeof window === 'undefined') return DEFAULT_METRICS
  try {
    const raw = localStorage.getItem(LS_DETAIL_METRICS)
    if (!raw) return DEFAULT_METRICS
    const arr = JSON.parse(raw)
    const cleaned = Array.isArray(arr) ? arr.filter((m) => ALL_METRICS.includes(m)) : []
    return cleaned.length ? cleaned : DEFAULT_METRICS
  } catch {
    return DEFAULT_METRICS
  }
}

const selectedMetrics = ref(DEFAULT_METRICS)

/* ===========================================================
   8 个 Top Dimensions (对齐 ga-lite 详情页)
   key       = 后端 dimension API 接受的 GA4 dimension 名
   titleKey  = i18n key for 卡片标题
   count     = 主显示/排序字段, 与后端 DIMENSION_CONFIG.primary 一一对应
               eventName 必须用 eventCount: 自定义事件的 screenPageViews
               永远为 0 (只有 page_view 事件本身计 PV), 用 PV 会全 0
   =========================================================== */
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

const dimsMap = ref({})
const dimsLoading = ref(false)
/* ---- Dimension Modal: 由 URL query.dim 驱动 (单一真相源) ----
   显式用 watch (() => route.query.ga4_dim) 而非 computed 直接访问 route.query.xxx,
   后者在 Nuxt 3 + Vue Router 4 的某些 hydration 边界 case 下追踪不到子属性变化.
   watch + ref 显式持有展示数据, 行为可控可调试. */
const dimModalData = ref(null)

/* ===========================================================
   维度详情注册表: route.query.ga4_dim 的 key → modal 数据源
   三类卡走同一张表, buildDimModalData 一次查找, 零特例:
     DIM_CONFIGS  8 卡 (GA4 历史维度)
     gscQuery     GSC 搜索关键词卡
     rt*          实时板块 4 卡 (rows 来自 realtime 60s 轮询, modal 跟随刷新)
   title/rows 是 getter — 快照在 build 时取值, 数据刷新由下方 watch 重建
   dim 字段 = 展示层翻译用的维度名 (localizeDimensionValue), 与 key 解耦
   =========================================================== */
const DIM_DETAIL_SOURCES = {
  ...Object.fromEntries(DIM_CONFIGS.map((d) => [d.key, {
    title: () => t(d.titleKey),
    rows:  () => dimsMap.value[d.key] || [],
    countField: d.count,
    dim: d.key,
  }])),
  gscQuery:  {
    title: () => t('projects.dim.search_queries'),
    rows: () => searchDimension.value?.rows || [],
    countField: 'impressions',
    provider: () => searchQueryTitleProvider.value,
    rowProviderIcons: () => searchQueryRowProviderIcons.value,
    countMetrics: () => searchQueryCountMetrics.value,
  },
  rtPages:   { title: () => t('realtime.detail.top_pages'),   rows: () => realtime.value?.by_page   || [], countField: 'activeUsers' },
  rtEvents:  { title: () => t('realtime.detail.top_events'),  rows: () => realtime.value?.by_event  || [], countField: 'eventCount' },
  rtDevices: { title: () => t('realtime.detail.top_devices'), rows: () => realtime.value?.by_device || [], countField: 'activeUsers', dim: 'deviceCategory' },
  rtCities:  { title: () => t('realtime.detail.top_cities'),  rows: () => realtime.value?.by_city   || [], countField: 'activeUsers' },
}

function buildDimModalData(target) {
  const src = DIM_DETAIL_SOURCES[target]
  if (!src) return null
  return {
    key: target,
    title: src.title(),
    rows: src.rows(),
    countField: src.countField,
    dim: src.dim || '',
    provider: typeof src.provider === 'function' ? src.provider() : (src.provider || ''),
    rowProviderIcons: typeof src.rowProviderIcons === 'function' ? src.rowProviderIcons() : !!src.rowProviderIcons,
    countMetrics: typeof src.countMetrics === 'function' ? src.countMetrics() : (src.countMetrics || []),
  }
}

/* URL → modal 显隐: dim 进则 build, dim 出则 null */
watch(
  () => route.query.ga4_dim,
  (v) => {
    dimModalData.value = buildDimModalData(String(v || '').trim())
  },
  { immediate: true },
)

/* 数据刷新 (8 维度 / GSC / 实时 60s 轮询) → modal 正打开时重建快照同步 rows.
   三个 ref 全是整体替换赋值 (useMetrics / fetchAllDimensions),
   浅层 watch 即可命中; 重建走同一条 build 路径, 不区分来源 */
watch([dimsMap, searchDimension, realtime], () => {
  if (!dimModalData.value) return
  dimModalData.value = buildDimModalData(dimModalData.value.key)
})

/* ---- 漏斗 step value 输入框的候选: 复用上方 Top Dimensions 已查到的真实值 ----
   pagePath / eventName 是 funnel 的两类 step 来源, 这里把 rows[].value 提出来,
   FunnelFormModal 内的 <datalist> 自动按当前 step.kind 切换给哪个 input. */
const funnelPageSuggestions = computed(() =>
  (dimsMap.value.pagePath || []).map((r) => r.value).filter(Boolean),
)
const funnelEventSuggestions = computed(() =>
  (dimsMap.value.eventName || []).map((r) => r.value).filter(Boolean),
)

/* ============================================================
   工具栏 sticky stuck 检测
   --
   sentinel <div class="mt-4 h-0"> 紧贴 toolbar 上方 (吃掉原 mt-4),
   IntersectionObserver 监听它是否滚出 viewport 顶部.
   --
   rootMargin 处理桌面 (top-0) vs 移动 (top-12 / h-12 = 48px) 差异:
     桌面: rootMargin 0   → sentinel y<0 时 stuck
     移动: rootMargin -48 → 移动顶栏遮挡 48px, sentinel 进入这片
                            "被遮挡区" 时即 stuck (而非完全出视口)
   matchMedia 监听断点切换, 重建 observer 用新 rootMargin.
   ============================================================ */
const stickySentinel = ref(null)
const toolbarStuck = ref(false)
let stickyObserver = null
let stickyMq = null

function rebuildStickyObserver() {
  stickyObserver?.disconnect()
  stickyObserver = null
  if (!stickySentinel.value || typeof window === 'undefined') return
  const isDesktop = window.matchMedia('(min-width: 768px)').matches
  const rootMargin = isDesktop ? '0px 0px 0px 0px' : '-48px 0px 0px 0px'
  stickyObserver = new IntersectionObserver(
    ([entry]) => { toolbarStuck.value = !entry.isIntersecting },
    { rootMargin, threshold: [0, 1] },
  )
  stickyObserver.observe(stickySentinel.value)
}

/* sentinel 在 v-else 分支内, 登录态加载完才挂载. ref 变化时 rebuild. */
watch(stickySentinel, rebuildStickyObserver, { flush: 'post' })

/* ---- 国家名 (i18n locale 自动加载) ---- */
const countryNames = useCountryNames()
onMounted(() => countryNames.ensureLoaded())

/* ---- 后端只返回有效挂载 (status=ACTIVE), 这里直接判长度 ---- */
const hasDataSource = computed(() => dataSources.value.length > 0)

/* ---- disconnected: 项目存在，但没有有效的数据源挂载 ---- */
const disconnected = ref(false)

/* ---- 项目是否挂了 Search provider: 驱动 Search 主视图
        没挂时整页保持纯 GA4 体验, Search Queries 卡不出现 ---- */
const SEARCH_PROVIDER_IDS = ['gsc', 'bing']
const mountedSearchProviders = computed(() => {
  const mounted = new Set((dataSources.value || []).map((d) => String(d?.provider || '').trim()))
  return SEARCH_PROVIDER_IDS.filter((provider) => mounted.has(provider))
})
const hasSearch = computed(() => mountedSearchProviders.value.length > 0)
const hasGa4 = computed(() => dataSources.value.some((d) => d.provider === 'ga4'))
function searchProviderFilterValue(list = filters.value) {
  const value = String((list || []).find((f) => f?.dim === 'searchProvider')?.value || '').trim()
  return mountedSearchProviders.value.includes(value) ? value : ''
}
const searchQueryTitleProvider = computed(() =>
  searchProviderFilterValue() || (mountedSearchProviders.value.length === 1 ? mountedSearchProviders.value[0] : ''),
)
const searchQueryRowProviderIcons = computed(() => mountedSearchProviders.value.length > 1 && !searchProviderFilterValue())
const searchQueryRequestProvider = computed(() => searchQueryTitleProvider.value || 'all')
const searchQueryCountMetrics = computed(() => [
  { field: 'clicks', icon: 'ri:cursor-line', color: METRIC_COLORS.clicks, label: t('metrics.card.clicks') },
  { field: 'impressions', icon: 'ri:eye-2-line', color: METRIC_COLORS.impressions, label: t('metrics.card.impressions') },
  { field: 'ctr', icon: 'ri:pie-chart-line', color: METRIC_COLORS.ctr, label: t('metrics.card.ctr'), format: 'rate1', hideOnMobile: true },
])

/* ============================================================
   dataSource 切换 (双源项目用户可在 GA4 / Search 视图间切)
   URL ?ds=ga4|search 与 ref 双向同步; 默认决策:
     hasGa4         → 'ga4'  (优先, 多数用户首屏关注 GA4 行为数据)
     仅 hasSearch   → 'search'
     都没           → 'ga4'  (兜底走 GA4 视图渲染 EmptyState)
   toolbar 切换按钮仅 hasGa4 && hasSearch 时显示
   ============================================================ */
const dataSource = ref('ga4')

function decideDefaultDataSource() {
  if (!hasGa4.value && hasSearch.value) return 'search'
  return 'ga4'
}

/* 监听 dataSources 加载完后初始化 dataSource
   优先级: URL ds (但必须与项目实际数据源兼容) → 默认决策
   兼容性兜底: URL ?ds=search 但新站点没挂 Search → 降级到该项目默认 ds */
watch(dataSources, () => {
  if (!isLoggedIn.value) return
  const fromUrl = String(route.query.ds || '').trim()
  if ((fromUrl === 'search' || fromUrl === 'gsc') && hasSearch.value) {
    dataSource.value = 'search'
  } else if (fromUrl === 'ga4' && hasGa4.value) {
    dataSource.value = 'ga4'
  } else {
    dataSource.value = decideDefaultDataSource()
  }
}, { immediate: true })

/* dataSource 变化 → 写回 URL (不污染 history) */
watch(dataSource, (v) => {
  if (String(route.query.ds || '') === v) return
  router.replace({ query: { ...route.query, ds: v } })
})

/* URL ?ds 反向同步 (浏览器前进/后退) */
watch(() => route.query.ds, (v) => {
  const value = String(v || '').trim()
  if (value === 'ga4' && value !== dataSource.value) {
    dataSource.value = value
  } else if ((value === 'search' || value === 'gsc') && dataSource.value !== 'search') {
    dataSource.value = 'search'
  }
})

/* ---- 站点图标: 与列表卡片使用同一解析规则 ---- */
const faviconUrl = computed(() => resolveProjectIcon(project.value))

/* ============================================================
   brand-override 跨页面共享给 layout: 顶部 logo + 名换成"当前站点"
   - logo: 优先 project.logo_url，否则使用本地图标
   - name: project.name (layout 内置 truncate 自动省略)
   - project 还没加载时不设置, 让 layout 走默认产品 logo+名
   - 离开本页时 onBeforeUnmount 清空, 不污染其他页面
   --
   ⚠️ 必须用 useState — Vue provide/inject 父→子单向,
       layout 是父我们是子, provide 父级拿不到 (踩坑后才发现)
   ============================================================ */
const brandOverride = useState('brand-override', () => null)
watchEffect(() => {
  if (!project.value) {
    brandOverride.value = null
  } else {
    brandOverride.value = {
      logo: project.value.logo_url || faviconUrl.value,
      name: project.value.name || '',
    }
  }
})
onBeforeUnmount(() => { brandOverride.value = null })

/* ---- 产品自身的 logo + 名 (右下角悬浮用; layout 已被 brand-override 覆盖,
        这里直接读 configStore 拿原始产品配置) ---- */
const productLogo = computed(() => {
  const cfg = configStore.getTranslated(locale.value)
  return cfg?.logo?.logo_64 || ''
})
const productName = computed(() => {
  const cfg = configStore.getTranslated(locale.value)
  return String(cfg?.site_name || configStore.siteName || 'GA Lite')
})

/* ---- 任一指标 fetch 中: 用于刷新按钮 disable + 转圈 (含 Search 关键词卡) ---- */
const anyLoading = computed(() => {
  const l = metricsLoading.value || {}
  return Boolean(l.summary || l.timeseries || l.dimension || l.searchDimension)
})

/* ---- 漏斗区 ref: 让 manualRefresh 整合刷新漏斗 (走 funnel 自己的 reload) ---- */
const funnelSectionRef = ref(null)
const searchDetailRef = ref(null)

async function manualRefresh() {
  await load()
  /* 手动刷新: dimensions 强制绕过缓存 (summary/timeseries 每周期独立 cache, 切换会自然重打)
     漏斗走 FunnelSection.reload(force=true) 一并强制重拉
     Search 关键词卡: 仅 hasSearch 时拉, 不强制 force (60s cache 够新) */
  await Promise.all([
    fetchSummary(),
    fetchTimeseriesMulti(),
    fetchAllDimensions(true),
    hasSearch.value ? fetchSearchDimension('query', searchQueryRequestProvider.value) : Promise.resolve(),
    hasGa4.value ? fetchRealtime() : Promise.resolve(),
    dataSource.value === 'search' ? searchDetailRef.value?.refetchAll?.() : Promise.resolve(),
    funnelSectionRef.value?.reload?.(true),
  ])
}

/* ============================================================
   fetchTimeseriesMulti - selectedMetrics 每个指标并行拉, 合并为单一图表数据
   --
   后端 timeseries API 当前只接受单 metric, 这里前端拼接:
     1. 并发 fetch 每个 metric (后端 60s cache 帮抑制重复)
     2. 用第一个成功结果的 labels 作为对齐基准
     3. 每个 metric 把 per-source 多 series 求和合一条线 (多数据源
        项目少见, 合一显得简洁; 真要看分源走 admin 那边)
     4. 注入 metric + color 字段, TimeseriesChart 直接读 series.color
   ============================================================ */
/* 把 filters[] 拼成 URL 片段 &f=... */
function filtersToUrlPart() {
  if (!filters.value.length) return ''
  return filters.value.map((f) =>
    `&f=${encodeURIComponent(`${f.dim}:${f.match}:${f.value}`)}`,
  ).join('')
}

async function fetchTimeseriesMulti() {
  if (!hasDataSource.value || !selectedMetrics.value.length) return
  return withMinLoading((v) => { metricsLoading.value.timeseries = v }, async () => {
    const metrics = [...selectedMetrics.value]
    const fParts = filtersToUrlPart()
    const results = await Promise.all(
      metrics.map((m) =>
        api.get(`/api/metrics/${projectKey.value}/timeseries?period=${period.value}&metric=${m}${fParts}`)
          .catch(() => null),
      ),
    )
    /* 用第一个 200 的结果的 labels 作为 x 轴基准 (所有 metric 同 period 应该一致) */
    const baseLabels = results.find((r) => r?.code === 200)?.data?.labels || []
    if (!baseLabels.length) {
      timeseries.value = null
      return
    }
    const series = metrics.map((m, idx) => {
      const res = results[idx]
      const sources = (res?.code === 200 ? res.data?.series : null) || []
      /* 求和: per-source 各天数据按位累加, 多源项目合一条线 */
      const data = baseLabels.map((_, i) =>
        sources.reduce((sum, s) => sum + (Number(s.data?.[i]) || 0), 0),
      )
      return {
        metric: m,
        label:  t(`metrics.field.${m}`),
        color:  METRIC_COLORS[m],
        data,
      }
    }).filter((s) => s.data.length)

    timeseries.value = {
      period:      period.value,
      granularity: results.find((r) => r?.code === 200)?.data?.granularity || 'day',
      labels:      baseLabels,
      series,
    }
  })
}

/* ===========================================================
   load - 拉详情 (含 data_sources)
   =========================================================== */
async function load() {
  if (!isLoggedIn.value) return
  loading.value = true
  try {
    const res = await projects.fetchDetail(projectKey.value)
    if (res?.code === 200) {
      project.value = res.data?.project || null
      const rawDs = res.data?.data_sources || []
      dataSources.value = rawDs
      disconnected.value = Boolean(project.value && rawDs.length === 0)
      if (disconnected.value) {
        summary.value = null
        timeseries.value = null
        dimsMap.value = {}
        searchDimension.value = null
        realtime.value = null
      }
    } else {
      project.value = null
      dataSources.value = []
      disconnected.value = false
    }
  } catch {
    project.value = null
    dataSources.value = []
    disconnected.value = false
  } finally {
    loading.value = false
  }
}

/* ===========================================================
   refetchAll - 周期变更 / 数据源变更后统一刷新
   --
   GA4 主体: summary + timeseries + 8 维度
   Search 关键词卡 (仅 hasSearch): 单独拉 fetchSearchDimension('query'),
     与 GA4 并行, 单方失败不阻塞另一方
   =========================================================== */
async function refetchAll() {
  if (!hasDataSource.value) return
  if (disconnected.value) return
  await Promise.all([
    fetchSummary(),
    fetchTimeseriesMulti(),
    fetchAllDimensions(),
    hasSearch.value ? fetchSearchDimension('query', searchQueryRequestProvider.value) : Promise.resolve(),
    hasGa4.value ? fetchRealtime() : Promise.resolve(),
  ])
}

/* ===========================================================
   8 维度并发拉取 (单 dim 失败不阻塞其他)
   后端 cache 60s, dim 切换不会重复打 GA4
   =========================================================== */
async function fetchAllDimensions(force = false) {
  return withMinLoading((v) => { dimsLoading.value = v }, async () => {
    const f = force ? '&force=1' : ''
    const fParts = filtersToUrlPart()
    const results = await Promise.all(
      DIM_CONFIGS.map((d) =>
        api.get(`/api/metrics/${projectKey.value}/dimension?period=${period.value}&dimension=${d.key}${f}${fParts}`)
          .then((res) => {
            if (res?.code !== 200) return []
            /* 数据层保留 GA4 原值 (filter 候选 / 筛选提交需要原值);
               翻译在展示层 (BarList / FilterChip / FilterAddModal) 调
               localizeDimensionValue 处理 — 数据与展示分离 */
            return res.data?.rows || []
          })
          .catch(() => []),
      ),
    )
    const next = {}
    DIM_CONFIGS.forEach((d, i) => { next[d.key] = results[i] })
    dimsMap.value = next
  })
}

/* ---- 打开维度详情弹窗 (展示后端返的全量, 后端 TOP_N=50) ----
   唯一入口: key ∈ DIM_DETAIL_SOURCES, 只写 URL, watch(route.query.ga4_dim) 自动渲染 */
function openDimDetail(key) {
  router.replace({ query: { ...route.query, ga4_dim: key } })
}
/* 关闭维度详情: 清 URL 参数, dimModalData 变 null modal 自动隐藏 */
function closeDimDetail() {
  const next = { ...route.query }
  delete next.ga4_dim
  router.replace({ query: next })
}

/* period 变化: 双写 URL + localStorage
   - URL: 用 router.replace (不污染 history); 链接可分享对方打开就是同一周期
   - localStorage: 切到其他站点时仍能记住偏好 (URL 只在当前页有效) */
watch(period, (v) => {
  if (typeof window !== 'undefined') localStorage.setItem(LS_DETAIL_PERIOD, v)
  if (String(route.query.period || '') !== v) {
    router.replace({ query: { ...route.query, period: v } })
  }
  if (!isLoggedIn.value) return
  refetchAll()
})

/* URL → period 反向同步 (浏览器前进/后退, 外部链接打开) */
watch(() => route.query.period, (v) => {
  const value = String(v || '').trim()
  if (!value || value === period.value) return
  /* 校验是合法周期 (含 custom), 防御恶意 URL 参数 */
  if (isAllowedPeriod(value)) {
    period.value = value
  }
})

/* ============================================================
   filters 状态同步
   --
   filters → URL: router.replace + 触发 refetchAll
   URL → filters: 浏览器前进/后退时反向同步, JSON 比对避免循环
   切站点 (projectKey 变): 在下方 watch 里清空 (跨站语义不通用)
   ============================================================ */
watch(filters, (v) => {
  const { f } = filtersToQuery(v)
  /* spread 现有 query 保留 period / dim 等其他参数 */
  router.replace({ query: { ...route.query, f } })
  if (!isLoggedIn.value) return
  /* 过滤变了所有数据都要重拉 */
  refetchAll()
}, { deep: true })

watch(() => route.query.f, () => {
  const fromUrl = parseFiltersFromQuery(route.query)
  const a = JSON.stringify(fromUrl)
  const b = JSON.stringify(filters.value)
  if (a !== b) filters.value = fromUrl
})

/* ---- FilterBar / FilterAddModal handlers ----
   pick-dim: 添加模式 — 维度下拉选好, initial=null, index=-1
   edit:     编辑模式 — chip 点击, 用 filters[index] 回填 + 记录 index 待替换
   add:      modal 提交 — 根据 filterAddIndex 决定 push(添加) 或 replace(编辑)
   remove:   chip ✕ → 按 index 移除
   clear:    折叠菜单"清除全部" → 清空 */
function onPickDim(dim) {
  /* 该维度已有 filter → 直接进编辑模式 (避免同维度重复条件,
     "一个维度只允许一条 filter" 是 Plausible/Mixpanel 标准约定;
     用户改完 chip 视觉等价于更新条件) */
  const existingIndex = filters.value.findIndex((f) => f.dim === dim)
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
  const f = filters.value[index]
  if (!f) return
  filterAddDim.value = f.dim
  filterAddInitial.value = { match: f.match, value: f.value }
  filterAddIndex.value = index
  filterAddVisible.value = true
}
function onAddFilter(f) {
  if (filterAddIndex.value >= 0) {
    /* 编辑: 替换该 index, 保持其他 filter 顺序 */
    const next = [...filters.value]
    next[filterAddIndex.value] = f
    filters.value = next
  } else {
    /* 添加: 追加到末尾 */
    filters.value = [...filters.value, f]
  }
  /* 重置编辑态, 下次默认走添加 */
  filterAddIndex.value = -1
  filterAddInitial.value = null
}
function onRemoveFilter(index) {
  filters.value = filters.value.filter((_, i) => i !== index)
}
function onClearFilters() {
  filters.value = []
}

/* ---- selectedMetrics 变化: 只重拉时序图 + 持久 LS (summary/dim 不受影响) ---- */
watch(selectedMetrics, (v) => {
  if (typeof window !== 'undefined') localStorage.setItem(LS_DETAIL_METRICS, JSON.stringify(v))
  if (isLoggedIn.value) fetchTimeseriesMulti()
}, { deep: true })

onMounted(async () => {
  /* ---- 恢复 period 优先级: URL query > localStorage > 默认 7days
         URL 优先让"分享链接"场景成立 (对方点开就是同一视图);
         无 URL 时落回 localStorage 让"切站点保持周期"场景成立 ---- */
  if (typeof window !== 'undefined') {
    const fromUrl = String(route.query.period || '').trim()
    const fromLs = localStorage.getItem(LS_DETAIL_PERIOD)
    if (fromUrl && isAllowedPeriod(fromUrl)) {
      period.value = fromUrl
    } else if (fromLs && isAllowedPeriod(fromLs)) {
      period.value = fromLs
    }
  }
  selectedMetrics.value = loadSelectedMetrics()

  /* ---- 监听断点切换, 重建 sticky observer (设备旋转 / 缩放) ---- */
  if (typeof window !== 'undefined') {
    stickyMq = window.matchMedia('(min-width: 768px)')
    stickyMq.addEventListener('change', rebuildStickyObserver)
  }

  /* 未登录只显示登录弹窗，不发数据请求。 */
  if (!isLoggedIn.value) return
  if (typeof window !== 'undefined') document.addEventListener('visibilitychange', onMapVisibility)
  await load()
  await refetchAll()
  /* 地图独立轮询: 首拉已在 refetchAll, 这里启 60s 定时 + 标签页可见性暂停 */
  mapCountdown.value = MAP_REFRESH
  startMapTimer()
})

onUnmounted(() => {
  stickyObserver?.disconnect()
  stickyObserver = null
  stickyMq?.removeEventListener('change', rebuildStickyObserver)
  /* 离开详情页: 清地图定时器 + 可见性监听, 避免泄漏 / 后台空刷 */
  stopMapTimer()
  if (typeof window !== 'undefined') document.removeEventListener('visibilitychange', onMapVisibility)
})

/* ---- 切站点 (route.params.projectKey 变了但同一个组件实例) 重新拉数据 ---- */
watch(projectKey, async (newKey, oldKey) => {
  if (!newKey || newKey === oldKey) return
  if (!isLoggedIn.value) return
  /* filters 跨站点保留 — onSwitchTo 已把当前 filters 带到新站点 URL,
     route.query.f 反向同步 watcher 会自动恢复 filters.value;
     这里不再主动清, 避免跟 URL 同步抢序 */
  /* 清旧站点数据, 立刻进 loading 态避免显示上一站的指标
     disconnected 也要清, 否则切到挂着数据源的新站点遮罩还残留 */
  project.value = null
  dataSources.value = []
  summary.value = null
  timeseries.value = null
  dimsMap.value = {}
  searchDimension.value = null
  disconnected.value = false
  stopMapTimer()
  await load()
  await refetchAll()
  mapCountdown.value = MAP_REFRESH   /* 切站点: 重置地图倒计时 (refetchAll 已重拉地图数据) */
  startMapTimer()
})
</script>
