<template>
  <!-- ============================================================
       FilterAddModal - 筛选第二步: 输入匹配规则
       --
       前提: 父组件已经选好维度 (props.dim), 弹出此 modal 只收 match + value
       --
       结构:
         Header: 标题 + 已选维度名 + ✕
         Body:
           [Match 自定义下拉]  (跟 FunnelStepRow Match 同款风格)
           [Value 输入 + 候选下拉]  (跟 FunnelStepRow Value 同款风格)
         Footer: 取消 / 添加
       --
       自定义 dropdown 替代原生 select/datalist:
         - 视觉跟项目内 FunnelStepRow / data-sources GA 账号选择器一致
         - hover/focus 反馈精确可控
       ============================================================ -->
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="visible"
        class="fixed inset-0 z-[60] flex items-center justify-center bg-black/20 p-4 backdrop-blur-[3px]"
      >
        <div class="w-full max-w-md overflow-visible rounded-2xl bg-white shadow-xl">
          <!-- ============ Header ============ -->
          <div class="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-3.5">
            <div class="min-w-0">
              <h3 class="text-base font-semibold text-gray-900">
                {{ initial ? $t('filters.edit_title') : $t('filters.add_title') }}
              </h3>
              <div v-if="dim" class="mt-0.5 truncate text-xs text-gray-500">
                {{ $t(dimTitleKey(dim)) }}
              </div>
            </div>
            <button
              type="button"
              class="flex size-8 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              @click="onClose"
            >
              <NuxtIcon name="ri:close-line" class="size-4" />
            </button>
          </div>

          <!-- ============ Body ============ -->
          <div class="px-5 py-4">
            <div class="flex items-center gap-2">

              <!-- Match 自定义下拉 (eventName / searchProvider 时禁用, 仅 exact 可选) -->
              <div ref="matchRef" class="relative shrink-0">
                <button
                  type="button"
                  :disabled="isExactOnlyDim"
                  :class="[
                    'flex h-9 w-28 items-center justify-between gap-1 rounded-md border bg-white px-2 text-xs transition-colors',
                    matchOpen
                      ? 'border-primary text-primary'
                      : 'border-gray-200 text-gray-700 hover:border-gray-300',
                    isExactOnlyDim ? 'cursor-not-allowed bg-gray-50' : '',
                  ]"
                  @click="toggleMatch"
                >
                  <!-- 触发按钮显示当前选中 match: 走 matchOpKey() 跟选项列表同源,
                       覆盖 not_* 系列 (funnels.match.* 仅有正向 4 个, not_equals 等
                       不存在, 旧拼接会显示 raw key "funnels.mat...") -->
                  <span class="truncate">{{ $t(matchOpKey(form.match)) }}</span>
                  <NuxtIcon
                    name="ri:arrow-down-s-line"
                    :class="['size-3.5 shrink-0 text-gray-400 transition-transform', matchOpen ? 'rotate-180' : '']"
                  />
                </button>
                <Transition name="modal-fade">
                  <div
                    v-if="matchOpen"
                    class="absolute left-0 top-full z-30 mt-1 w-36 overflow-hidden rounded-md border border-gray-200 bg-white py-1 shadow-lg"
                  >
                    <button
                      v-for="m in MATCH_OPTS"
                      :key="m"
                      type="button"
                      :class="[
                        'block w-full px-3 py-1.5 text-left text-xs transition-colors',
                        form.match === m ? 'bg-primary/10 text-primary' : 'text-gray-700 hover:bg-gray-50',
                      ]"
                      @click="selectMatch(m)"
                    >
                      {{ $t(matchOpKey(m)) }}
                    </button>
                  </div>
                </Transition>
              </div>

              <!-- Value 输入 + 候选下拉 (自定义 panel, 不用 datalist) -->
              <div ref="valueRef" class="relative min-w-0 flex-1">
                <input
                  ref="valueInputRef"
                  :value="inputDisplayValue"
                  type="text"
                  :placeholder="$t('filters.value_placeholder')"
                  :readonly="dim === 'searchProvider'"
                  :class="[
                    'h-9 w-full min-w-0 rounded-md border border-gray-200 px-2 text-xs text-gray-900 placeholder:text-gray-400 focus:border-primary focus:outline-none',
                    dim === 'searchProvider' ? 'cursor-pointer bg-white' : '',
                  ]"
                  maxlength="500"
                  autocomplete="off"
                  @input="onValueInput"
                  @focus="openValuePanel"
                  @keydown.enter="onSubmit"
                  @keydown.escape="valuePanelOpen = false"
                />
                <Transition name="modal-fade">
                  <div
                    v-if="valuePanelOpen && filteredSuggestions.length"
                    class="absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg"
                  >
                    <!-- 候选: 显示翻译, 选中时填入原值 (GA4 查询契约要求原值)
                         country 维度特殊: 国旗 + 中文国名, 跟 BarList country slot 同款体验 -->
                    <button
                      v-for="s in filteredSuggestions"
                      :key="s"
                      type="button"
                      class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-700 transition-colors hover:bg-gray-50"
                      @mousedown.prevent="pickValue(s)"
                    >
                      <CountryFlag v-if="dim === 'country'" :code="s" :size="14" />
                      <span class="truncate">
                        {{ dim === 'country' ? displayCountryValue(s) : displayValue(s) }}
                      </span>
                    </button>
                  </div>
                </Transition>
              </div>
            </div>
          </div>

          <!-- ============ Footer ============ -->
          <div class="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3">
            <button
              type="button"
              class="rounded-full px-4 py-1.5 text-sm text-gray-500 hover:bg-gray-50"
              @click="onClose"
            >
              {{ $t('common.cancel') }}
            </button>
            <button
              type="button"
              class="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-text hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="!canSubmit"
              @click="onSubmit"
            >
              {{ initial ? $t('common.save') : $t('filters.add_action') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
/* ============================================================
   FilterAddModal - 筛选第二步: 收 match + value
   --
   props:
     visible    - 显隐 (父组件控制)
     dim        - 维度 key (FilterBar 选定后传入)
     dimsMap    - 上方 Top Dimensions rows map, 给 value 候选用
   emits:
     close      - 关闭
     add({ dim, match, value }) - 提交单条 filter
   --
   交互细节:
     dim=eventName 时强制 match=exact, Match 触发器禁用
     Value focus / 输入时弹候选, 列表项 mousedown.prevent + emit
       (mousedown 在 blur 之前, prevent 阻止 input blur 让点击命中)
     回车 = 提交
     dropdown 外部点击关闭 (跟 FunnelStepRow 同款)
   ============================================================ */

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { dimTitleKey, matchOpKey } from '~/utils/filters'
import { localizeDimensionValue } from '~/utils/dimension-i18n'
import CountryFlag from './CountryFlag.vue'

const { t } = useI18n()
const countryNames = useCountryNames()
onMounted(() => countryNames.ensureLoaded())

/* 把 GA4 原值 (如 "(direct)") 翻译为本地化字符串 ("直接访问") 仅给候选 label 用,
   pickValue 仍用原值传给后端 — 数据层契约不污染 */
function displayValue(raw) {
  if (props.dim === 'searchProvider') return providerLabel(raw)
  if (!props.dim) return raw
  return localizeDimensionValue(props.dim, raw, t)
}

function providerLabel(provider) {
  const key = `integrations.provider.${provider}`
  const label = t(key)
  return label === key ? provider : label
}

/* country 维度专属翻译: 优先用 countryNames (US -> 美国), fallback 通用 i18n
   ((not set) -> 未知 / (other) -> 其他), 都不命中返原 code */
function displayCountryValue(raw) {
  return countryNames.nameOf(raw) || displayValue(raw) || raw
}

const props = defineProps({
  visible: { type: Boolean, default: false },
  dim:     { type: String,  default: '' },
  /* initial: 编辑模式传 { match, value } 初始化表单; null=添加模式 */
  initial: { type: Object,  default: null },
  dimsMap: { type: Object,  default: () => ({}) },
  /* 以下三项支持"按需拉无自身 filter 候选" (编辑场景看全集) */
  projectKey: { type: String, default: '' },
  period:     { type: String, default: '7days' },
  allFilters: { type: Array,  default: () => [] },
  searchProviders: { type: Array, default: () => [] },
})

const emit = defineEmits(['close', 'add'])

/* 8 个 match 操作符: 正向 / 反向 交错排列, 用户找配对最快.
   not_* 系列后端走 GA4 notExpression 包装, 实现"排除"语义 */
const MATCH_OPTS = [
  'exact',       'not_equals',
  'contains',    'not_contains',
  'starts_with', 'not_starts_with',
  'ends_with',   'not_ends_with',
]

/* dim-specific 默认 match:
     searchQuery (GSC 搜索关键词) → contains, 关键词天然适合模糊匹配,
       用户从搜索行为视角想的就是"含某个词", 默认 exact 反而不符合直觉
     其他维度 → exact, 精确匹配最安全 (避免误命中过多) */
function defaultMatchFor(dim) {
  if (dim === 'searchProvider') return 'exact'
  if (dim === 'searchQuery') return 'contains'
  return 'exact'
}
function freshForm() {
  return { match: defaultMatchFor(props.dim), value: '' }
}

const form = ref(freshForm())

const matchRef = ref(null)
const matchOpen = ref(false)

const valueRef = ref(null)
const valueInputRef = ref(null)
const valuePanelOpen = ref(false)

const isExactOnlyDim = computed(() => props.dim === 'eventName' || props.dim === 'searchProvider')
const providerSuggestions = computed(() => {
  const providers = (props.searchProviders || []).map((p) => String(p || '').trim()).filter(Boolean)
  return providers.length ? providers : ['gsc', 'bing']
})
const inputDisplayValue = computed(() =>
  props.dim === 'searchProvider' ? providerLabel(form.value.value) : form.value.value,
)

/* ---- 打开 modal: 初始化 form ----
   编辑模式 (initial 非空): 用 initial 填表
   添加模式 (initial=null): freshForm()
   eventName 始终强制 exact (GA4 funnelEventFilter 限制)
   不自动 focus 输入框 (避免抢焦点 / 移动端弹键盘) */
watch(
  () => props.visible,
  (v) => {
    if (!v) {
      /* 关闭时清本地候选, 下次打开重新拉 (避免上次的候选误显示给新 dim) */
      suggestionsLocal.value = []
      return
    }
    form.value = props.initial
      ? { match: props.initial.match || 'exact', value: props.initial.value || '' }
      : freshForm()
    if (isExactOnlyDim.value) form.value.match = 'exact'
    matchOpen.value = false
    valuePanelOpen.value = false
    /* 异步拉无自身 filter 的全候选 (编辑场景能看到其他选项, 不被自身 filter 切到只剩当前值) */
    fetchSuggestionsForDim()
  },
)

/* ---- Match 自定义下拉 ---- */
function toggleMatch() {
  if (isExactOnlyDim.value) return
  matchOpen.value = !matchOpen.value
  valuePanelOpen.value = false
}
function selectMatch(m) {
  form.value.match = m
  matchOpen.value = false
}

/* ---- Value 候选源: 优先用本地 fetch (无自身 filter 全集), 兜底父级 dimsMap ----
   场景:
     添加 (该 dim 无 filter): dimsMap 即全集, fetch 也能命中 60s cache, 等价
     编辑 (该 dim 有 filter): dimsMap 被自身 filter 切到只剩当前值, 需重新拉
   suggestionsLocal 异步填充, fetch 期间 fallback 父 dimsMap 让 UI 不空 */
const api = useApi()
const suggestionsLocal = ref([])

async function fetchSuggestionsForDim() {
  if (!props.dim || !props.projectKey) return
  if (props.dim === 'searchProvider') return
  /* 排除当前编辑的 dim filter, 拿"该 dim 在其他切片下的全候选" */
  const otherFilters = (props.allFilters || []).filter((f) => f.dim !== props.dim)
  const fParts = otherFilters.map((f) =>
    `&f=${encodeURIComponent(`${f.dim}:${f.match}:${f.value}`)}`,
  ).join('')
  try {
    const res = await api.get(
      `/api/metrics/${props.projectKey}/dimension?period=${props.period}&dimension=${props.dim}${fParts}`,
    )
    if (res?.code === 200) {
      suggestionsLocal.value = (res.data?.rows || []).map((r) => r.value).filter(Boolean)
    }
  } catch {
    /* fetch 失败保持 suggestionsLocal=[], 下面 computed 自动 fallback dimsMap */
  }
}

const suggestions = computed(() => {
  if (props.dim === 'searchProvider') return providerSuggestions.value
  if (suggestionsLocal.value.length) return suggestionsLocal.value
  if (!props.dim) return []
  const rows = props.dimsMap?.[props.dim] || []
  return rows.map((r) => r.value).filter(Boolean)
})

const filteredSuggestions = computed(() => {
  if (props.dim === 'searchProvider') return suggestions.value
  const q = String(form.value.value || '').trim().toLowerCase()
  const list = suggestions.value
  if (!q) return list.slice(0, 30)
  return list.filter((s) => String(s).toLowerCase().includes(q)).slice(0, 30)
})

function openValuePanel() {
  if (suggestions.value.length === 0) return
  matchOpen.value = false
  valuePanelOpen.value = true
}
function onValueInput() {
  if (props.dim === 'searchProvider') return
  form.value.value = valueInputRef.value?.value || ''
  if (suggestions.value.length && !valuePanelOpen.value) valuePanelOpen.value = true
}
function pickValue(s) {
  form.value.value = s
  valuePanelOpen.value = false
}

/* ---- 外部点击关闭 dropdown (modal 内部 absolute, 不需要 Teleport) ---- */
function onClickOutside(e) {
  if (matchOpen.value && matchRef.value && !matchRef.value.contains(e.target)) {
    matchOpen.value = false
  }
  if (valuePanelOpen.value && valueRef.value && !valueRef.value.contains(e.target)) {
    valuePanelOpen.value = false
  }
}
onMounted(()   => { if (import.meta.client) document.addEventListener('pointerdown', onClickOutside) })
onUnmounted(() => { if (import.meta.client) document.removeEventListener('pointerdown', onClickOutside) })

/* ---- 校验 + 提交 ---- */
const canSubmit = computed(() => {
  if (!props.dim || !form.value.value.trim()) return false
  if (props.dim === 'searchProvider') return providerSuggestions.value.includes(form.value.value)
  return true
})

function onSubmit() {
  if (!canSubmit.value) return
  emit('add', {
    dim: props.dim,
    match: form.value.match,
    value: form.value.value.trim(),
  })
  emit('close')
}

function onClose() {
  matchOpen.value = false
  valuePanelOpen.value = false
  emit('close')
}
</script>
