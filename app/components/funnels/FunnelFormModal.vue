<template>
  <!-- ============================================================
       FunnelFormModal - 创建 / 编辑 漏斗
       --
       props:
         visible    - 显隐
         mode       - 'create' | 'edit'
         projectKey - 创建时归属哪个 project
         funnel     - edit 模式下源数据 (含 steps[])
       emits:
         close
         saved (传回新/更新对象, 让父组件 patch list)
       --
       结构 (对齐 ProjectFormModal):
         Header  - 标题 + 关闭 X
         Body    - Name 输入 + Steps 列表 (FunnelStepRow × N) + "+ 添加步骤"
         Footer  - 取消 + 保存
       ============================================================ -->
  <Teleport to="body">
    <Transition name="modal-fade">
      <!-- 表单态 modal: 蒙版不响应点击关闭, 防止误触丢失未保存输入;
           用户必须显式点 ✕ / Cancel 关闭 (ESC 留给 FunnelStepRow 内
           的 Value 候选 dropdown 用, 不跟 modal 关闭抢) -->
      <div
        v-if="visible"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4 backdrop-blur-[3px]"
      >
        <!-- max-w-3xl: 比 2xl 宽 96px, Value input 长 URL 时更宽松
             max-h-[92vh]: 极限利用 viewport, 5 步漏斗也能不滚动完整显示 -->
        <div class="w-full max-w-3xl max-h-[92vh] overflow-hidden rounded-2xl bg-white shadow-xl">

          <!-- ============ Header ============ -->
          <div class="flex items-center justify-between gap-3 border-b border-gray-100 px-6 py-4">
            <h3 class="text-base font-semibold text-gray-900">
              {{ mode === 'edit' ? $t('funnels.edit_title') : $t('funnels.create_title') }}
            </h3>
            <button
              type="button"
              class="flex size-8 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              @click="$emit('close')"
            >
              <NuxtIcon name="ri:close-line" class="size-4" />
            </button>
          </div>

          <!-- ============ Body ============
               max-h: 用 calc 锁到 modal 外层 max-h-[92vh] 减去 Header/Footer 高度,
               5 个 step 也能完整显示无需滚动; 极端情况 (小屏 / 长内容) 兜底滚动 -->
          <div class="max-h-[calc(92vh-9rem)] space-y-5 overflow-y-auto px-6 py-5">

            <!-- Name -->
            <div>
              <div class="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
                {{ $t('funnels.name_label') }}
              </div>
              <input
                v-model="form.name"
                type="text"
                class="w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-primary focus:outline-none"
                :placeholder="$t('funnels.name_placeholder')"
                maxlength="80"
              />
            </div>

            <!-- Steps -->
            <div>
              <!-- label + "+ 添加步骤" 按钮同行 (GitHub/Linear 列表编辑器标准)
                   去掉右侧描述文本: step row 自身已自明结构, 描述是冗余安抚 -->
              <div class="mb-3 flex items-center justify-between gap-2">
                <span class="text-xs font-medium uppercase tracking-wide text-gray-500">
                  {{ $t('funnels.steps_label') }}
                </span>
                <button
                  type="button"
                  :disabled="form.steps.length >= 5"
                  class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-500"
                  @click="onAddStep"
                >
                  <NuxtIcon name="ri:add-line" class="size-3.5" />
                  {{ $t('funnels.add_step') }}
                </button>
              </div>

              <!-- steps: 完全无边框/分隔线, 纯靠 space-y 间距区分 step
                   step row 本身两行 (备注 + 控件) 已自成结构, gap 5 (20px)
                   足够明示"这是下一步" — 减一切多余视觉负担 -->
              <ul class="space-y-5">
                <li v-for="(step, i) in form.steps" :key="i">
                  <FunnelStepRow
                    :step="step"
                    :index="i"
                    :is-first="i === 0"
                    :is-last="i === form.steps.length - 1"
                    :can-remove="form.steps.length > 2"
                    :suggestions="suggestionsFor(step.kind)"
                    @update:step="(s) => onUpdateStep(i, s)"
                    @remove="onRemoveStep(i)"
                    @move-up="onMoveStep(i, -1)"
                    @move-down="onMoveStep(i, +1)"
                  />
                </li>
              </ul>

            </div>

            <!-- 校验错误提示 -->
            <div
              v-if="errorMsg"
              class="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800"
            >
              {{ errorMsg }}
            </div>
          </div>

          <!-- ============ Footer ============ -->
          <div class="flex items-center justify-end gap-2 border-t border-gray-100 px-6 py-4">
            <button
              type="button"
              class="rounded-full px-4 py-1.5 text-sm text-gray-500 hover:bg-gray-50"
              @click="$emit('close')"
            >
              {{ $t('common.cancel') }}
            </button>
            <button
              type="button"
              class="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-text hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="!canSubmit || saving"
              @click="onSubmit"
            >
              {{ saving ? $t('common.saving') : $t('common.save') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
/* ============================================================
   FunnelFormModal - 创建/编辑双模式 (单组件复用)
   --
   form.steps 是本地 reactive 数组, edit 模式打开时从 props.funnel 拷贝.
   提交时校验 + 调 API + emit saved.
   ============================================================ */

import { computed, ref, watch } from 'vue'
import FunnelStepRow from './FunnelStepRow.vue'

const props = defineProps({
  visible:          { type: Boolean, default: false },
  mode:             { type: String,  default: 'create' },
  projectKey:       { type: String,  default: '' },
  funnel:           { type: Object,  default: null },
  /* 候选: 来自上方 Top Dimensions 已查到的真实值, 供 Value 输入框 datalist 补全
     pageSuggestions[]   <- pagePath 维度 rows.map(r => r.value)
     eventSuggestions[]  <- eventName 维度 rows.map(r => r.value)
     不传 / 空数组时 input 退化为普通文本框 */
  pageSuggestions:  { type: Array,   default: () => [] },
  eventSuggestions: { type: Array,   default: () => [] },
})

const emit = defineEmits(['close', 'saved'])

const { t } = useI18n()
const { create, update } = useFunnels()
const { show: showToast } = useToast()

/* ---- 候选查表: kind -> suggestions[] (取代 if/else) ---- */
function suggestionsFor(kind) {
  return kind === 'event' ? props.eventSuggestions : props.pageSuggestions
}

/* ---- 默认初始 form ---- */
function freshForm() {
  return {
    name: '',
    steps: [
      { name: '', kind: 'page', match: 'exact', value: '' },
      { name: '', kind: 'page', match: 'exact', value: '' },
    ],
  }
}

const form = ref(freshForm())
const saving = ref(false)
const errorMsg = ref('')

/* ---- 打开时初始化 ---- */
watch(
  () => props.visible,
  (v) => {
    if (!v) return
    errorMsg.value = ''
    saving.value = false
    if (props.mode === 'edit' && props.funnel) {
      form.value = {
        name: props.funnel.name || '',
        steps: (props.funnel.steps || []).map((s) => ({
          name:  s?.name  || '',
          kind:  s?.kind  || 'page',
          match: s?.match || 'exact',
          value: s?.value || '',
        })),
      }
      /* 防御: 上限 5 / 下限 2 */
      if (form.value.steps.length < 2) {
        while (form.value.steps.length < 2) {
          form.value.steps.push({ name: '', kind: 'page', match: 'exact', value: '' })
        }
      }
      if (form.value.steps.length > 5) form.value.steps = form.value.steps.slice(0, 5)
    } else {
      form.value = freshForm()
    }
  },
  { immediate: true },
)

/* ---- 步骤操作 ---- */
function onUpdateStep(i, patch) {
  const next = [...form.value.steps]
  next[i] = patch
  form.value.steps = next
}
function onAddStep() {
  if (form.value.steps.length >= 5) return
  form.value.steps.push({ name: '', kind: 'page', match: 'exact', value: '' })
}
function onRemoveStep(i) {
  if (form.value.steps.length <= 2) return
  form.value.steps.splice(i, 1)
}
function onMoveStep(i, delta) {
  const j = i + delta
  if (j < 0 || j >= form.value.steps.length) return
  const arr = [...form.value.steps]
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
  form.value.steps = arr
}

/* ---- 校验 ---- */
const canSubmit = computed(() => {
  if (form.value.steps.length < 2 || form.value.steps.length > 5) return false
  for (const s of form.value.steps) {
    if (!s.value || !String(s.value).trim()) return false
  }
  return true
})

/* ---- 提交 ---- */
async function onSubmit() {
  if (!canSubmit.value || saving.value) return
  errorMsg.value = ''
  saving.value = true
  try {
    const payload = {
      name: form.value.name.trim(),
      steps: form.value.steps.map((s) => ({
        name:  String(s.name  || '').trim(),
        kind:  s.kind,
        match: s.match,
        value: String(s.value || '').trim(),
      })),
    }

    const res = props.mode === 'edit' && props.funnel?.funnel_key
      ? await update(props.funnel.funnel_key, payload)
      : await create(props.projectKey, payload)

    if (res?.code === 200) {
      showToast(
        props.mode === 'edit' ? t('funnels.update_success') : t('funnels.create_success'),
        { type: 'success' },
      )
      emit('saved', res.data)
      emit('close')
    } else {
      const key = res?.msg || 'save_failed'
      /* 把后端 i18n-key 形态错误映射到本地化文案; 找不到 key 时 fallback 原文 */
      const candidate = t(`funnels.error.${key}`)
      errorMsg.value = candidate.startsWith('funnels.error.')
        ? (res?.msg || t('common.error'))
        : candidate
    }
  } catch (err) {
    errorMsg.value = err?.message || t('common.error')
  } finally {
    saving.value = false
  }
}
</script>
