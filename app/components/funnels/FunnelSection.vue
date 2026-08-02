<template>
  <!-- ============================================================
       FunnelSection - 站点详情页"漏斗"区
       --
       结构 (对齐 Top Dimensions 同款卡片网格):
         标题行 (裸露, 不被 panel 包) - 总标题 + "+ New funnel"
         卡片网格 (sm 2 列, mobile 1 列) - 每张 FunnelCard 自带柱状图
         FunnelFormModal (创建 / 编辑)
         删除二次确认 modal
       --
       不再有 detail modal — 漏斗信息一卡呈现, hover bar 弹 tooltip
       ============================================================ -->
  <div>
    <!-- ============ 标题行 ============ -->
    <div class="mt-6 flex items-center justify-between gap-2">
      <h3 class="text-base font-semibold text-gray-900">{{ $t('funnels.title') }}</h3>
      <button
        type="button"
        class="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50"
        @click="onCreate"
      >
        <NuxtIcon name="ri:add-line" class="size-4" />
        {{ $t('funnels.new') }}
      </button>
    </div>

    <!-- ============ 列表态: loading / empty / grid ============
         骨架走 FunnelCard skeleton mode, 与真实卡片同结构 → 同高度,
         切换/刷新零跳动 -->
    <div v-if="listLoading" class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <FunnelCard v-for="i in 2" :key="i" :skeleton="true" />
    </div>

    <div v-else-if="!funnels.length" class="mt-3 rounded-xl border border-dashed border-gray-200 px-6 py-10 text-center">
      <NuxtIcon name="ri:funnel-line" class="mx-auto size-8 text-gray-300" />
      <div class="mt-3 text-sm font-semibold text-gray-900">{{ $t('funnels.empty') }}</div>
      <div class="mt-1 text-xs text-gray-500">{{ $t('funnels.empty_desc') }}</div>
      <button
        type="button"
        class="mt-4 inline-flex items-center gap-1 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-text hover:opacity-90"
        @click="onCreate"
      >
        {{ $t('funnels.create_cta') }}
      </button>
    </div>

    <div v-else class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <FunnelCard
        v-for="f in funnels"
        :key="f.funnel_key"
        :funnel="f"
        :result="resultMap[f.funnel_key] || null"
        :loading="resultsLoading"
        @edit="onEdit(f)"
        @delete="askDelete(f)"
      />
    </div>

    <!-- ============ 创建/编辑 弹窗 ============ -->
    <FunnelFormModal
      :visible="formVisible"
      :mode="formMode"
      :project-key="projectKey"
      :funnel="formMode === 'edit' ? activeFunnel : null"
      :page-suggestions="pageSuggestions"
      :event-suggestions="eventSuggestions"
      @close="formVisible = false"
      @saved="onSaved"
    />

    <!-- ============ 删除二次确认 ============ -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div
          v-if="deletingKey"
          class="fixed inset-0 z-[80] flex items-center justify-center bg-black/20 p-4 backdrop-blur-[3px]"
          @click.self="deletingKey = ''"
        >
          <div class="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 class="text-base font-semibold text-gray-900">{{ $t('funnels.delete_confirm_title') }}</h3>
            <p class="mt-2 text-sm text-gray-500">
              {{ $t('funnels.delete_confirm_desc', { name: deletingName }) }}
            </p>
            <div class="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                class="rounded-full px-4 py-1.5 text-sm text-gray-500 hover:bg-gray-50"
                @click="deletingKey = ''"
              >
                {{ $t('common.cancel') }}
              </button>
              <button
                type="button"
                class="rounded-full bg-red-500 px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                :disabled="deletePending"
                @click="onConfirmDelete"
              >
                {{ deletePending ? $t('common.saving') : $t('common.delete') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
/* ============================================================
   FunnelSection - 卡片网格模式 (无 detail modal)
   --
   关键设计:
     1) 列表态加载完立刻并发预拉所有 funnel result (Promise.all,
        单失败不阻塞), 卡片直接显示真实柱状图.
     2) 每张 FunnelCard 是完整信息卡 (Header + Bars), 不再有"点开详情",
        hover bar 弹 tooltip 看 dropped 等细节.
     3) period 改变 → 清 resultMap → 并发重拉 (后端 60s cache).
     4) 编辑通过卡片三点菜单触发 FormModal; 删除走二次确认 modal.
     5) disabled=true 时清空本地状态且不发 API.
   --
   defineExpose: 暴露 reload() 给父组件, 顶部全局 RefreshButton
                 触发时一并强制重拉漏斗.
   ============================================================ */

import { computed, ref, watch } from 'vue'
import FunnelCard from './FunnelCard.vue'
import FunnelFormModal from './FunnelFormModal.vue'
import { withMinLoading } from '~/utils/min-loading'

const props = defineProps({
  projectKey:       { type: String,  default: '' },
  disabled:         { type: Boolean, default: false },
  pageSuggestions:  { type: Array,   default: () => [] },
  eventSuggestions: { type: Array,   default: () => [] },
  /* period 由父级 ([projectKey].vue) 单源控制, 漏斗结果跟随站点全局 period */
  period:           { type: String,  default: '7days' },
  /* filters: 跟 metrics 同款全局筛选, 漏斗结果也按 filter 切片 */
  filters:          { type: Array,   default: () => [] },
})

const { t } = useI18n()
const { fetchList, remove, fetchResults } = useFunnels()
const { show: showToast } = useToast()

/* ---- 列表 + 结果 ---- */
const funnels = ref([])
const listLoading = ref(false)

const activeKey = ref('')           // 编辑/删除时定位用
const resultMap = ref({})           // funnel_key -> result payload
const resultsLoading = ref(false)   // 所有 funnel result 拉中

const activeFunnel = computed(() => funnels.value.find((f) => f.funnel_key === activeKey.value) || null)

/* ---- 创建/编辑 弹窗 ---- */
const formVisible = ref(false)
const formMode = ref('create')

/* ---- 删除确认 ---- */
const deletingKey = ref('')
const deletingName = ref('')
const deletePending = ref(false)

/* ============================================================
   加载列表 + 并发预拉所有 funnel results
   ============================================================ */
async function load() {
  if (props.disabled) {
    funnels.value = []
    resultMap.value = {}
    return
  }
  if (!props.projectKey) return
  /* 切站点时 list 可能命中 DB 缓存秒返回, minLoading 让骨架节奏一致 */
  await withMinLoading((v) => { listLoading.value = v }, async () => {
    try {
      const res = await fetchList(props.projectKey)
      funnels.value = res?.code === 200 ? (res.data?.list || []) : []
    } catch {
      funnels.value = []
    }
  })
  if (funnels.value.length) await loadAllResults()
}

async function loadAllResults({ force = false } = {}) {
  if (props.disabled) return
  if (!funnels.value.length) {
    resultMap.value = {}
    return
  }
  /* 最小 loading 保护: 漏斗 60s cache 命中时会闪, withMinLoading 强制
     至少 500ms 骨架屏, 跟 SummaryCards / TimeseriesChart / BarList 同款节奏 */
  return withMinLoading((v) => { resultsLoading.value = v }, async () => {
    const tasks = funnels.value.map(async (f) => {
      try {
        const res = await fetchResults(f.funnel_key, props.period, { force, filters: props.filters })
        return [f.funnel_key, res?.code === 200 ? res.data : null]
      } catch {
        return [f.funnel_key, null]
      }
    })
    const entries = await Promise.all(tasks)
    const map = {}
    for (const [k, v] of entries) if (v) map[k] = v
    resultMap.value = map
  })
}

/* ============================================================
   动作
   ============================================================ */
function onCreate() {
  activeKey.value = ''
  formMode.value = 'create'
  formVisible.value = true
}
function onEdit(f) {
  if (!f) return
  activeKey.value = f.funnel_key
  formMode.value = 'edit'
  formVisible.value = true
}

async function onSaved(payload) {
  formVisible.value = false
  /* load() 内 await loadAllResults(force=false), 期间 resultsLoading=true,
     所有 FunnelCard 显示骨架 → 拉完一起切到真实数据, 零跳动.
     编辑场景: 后端 update 时已清该 funnel cache, force=false 也命中 GA4 拿新数据
     新建场景: 后端从未有该 funnel cache, force=false 同样调 GA4 拿初始数据
     无需额外 fetchResults force=true (之前的"防御保底"反而引起 result=null 闪烁) */
  await load()
}

/* ---- 删除 ---- */
function askDelete(f) {
  if (!f) return
  deletingKey.value = f.funnel_key
  deletingName.value = f.name || t('funnels.untitled')
}
async function onConfirmDelete() {
  if (!deletingKey.value || deletePending.value) return
  if (props.disabled) {
    showToast(t('common.login_required'), { type: 'info' })
    deletingKey.value = ''
    return
  }
  deletePending.value = true
  try {
    const res = await remove(deletingKey.value)
    if (res?.code === 200) {
      showToast(t('funnels.delete_success'), { type: 'success' })
      delete resultMap.value[deletingKey.value]
      deletingKey.value = ''
      await load()
    } else {
      showToast(res?.msg || t('common.error'), { type: 'error' })
    }
  } catch (err) {
    showToast(err?.message || t('common.error'), { type: 'error' })
  } finally {
    deletePending.value = false
  }
}

/* ============================================================
   生命周期 + 监听
   ============================================================ */
/* 切站点 / disabled 变化: 重新装填 */
watch(
  () => [props.projectKey, props.disabled],
  () => {
    activeKey.value = ''
    resultMap.value = {}
    load()
  },
  { immediate: true },
)

/* period / filters 变化: 清 resultMap, 并发重拉
   filters 用 deep watch 比对内容 (而不是引用), 哥 onAddFilter spread 新数组
   每次 push 都是新引用, 但兜底用 deep 监听数组内变化更稳 */
watch(
  () => props.period,
  () => {
    resultMap.value = {}
    loadAllResults()
  },
)
watch(
  () => props.filters,
  () => {
    resultMap.value = {}
    loadAllResults()
  },
  { deep: true },
)

/* ============================================================
   defineExpose: 父组件可通过 ref 调用 reload(force=true)
   场景: 顶部全局 RefreshButton 触发 manualRefresh 时, 把 funnels
        也带上一起刷新
   ============================================================ */
async function reload(force = true) {
  await load()
  if (force && funnels.value.length) {
    resultMap.value = {}
    await loadAllResults({ force: true })
  }
}
defineExpose({ reload })
</script>
