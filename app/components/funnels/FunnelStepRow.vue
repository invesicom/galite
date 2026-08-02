<template>
  <!-- ============================================================
       FunnelStepRow - 单步编辑行 (仅 FormModal 内部使用)
       --
       props.step: { name?, kind:'page'|'event', match, value }
       props.suggestions: string[]  当前 kind 对应的候选值列表
                                    (上方 Top Dimensions 已查到的真实
                                     pagePath / eventName, 父组件透传)
       --
       结构: 编号圆 + 右侧两行 (备注在上, 主控件在下)
         编号圆: 外层 flex items-center, 相对整 step row 垂直居中
         右侧:
           行 1: [可选备注 input, max-w-xs] (浅边框, 不 100% 宽)
           行 2: [Kind 分段] [Match] [Value] [↑↓⊖]
       --
       两个 dropdown (Match / Value 候选) 统一用 Teleport 渲染到 body,
       fixed 定位 + 上下方向自适应, 跳出 modal 任意层 overflow 截断.
       ============================================================ -->
  <div class="flex items-center gap-2">
    <!-- step 编号圆 (外层左侧, items-center 让它相对整 step row 垂直居中) -->
    <div class="flex size-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[11px] font-bold text-white tabular-nums">
      {{ index + 1 }}
    </div>

    <!-- 右侧两行容器 (flex-1 占满剩余) -->
    <div class="min-w-0 flex-1 space-y-1.5">
      <!-- 行 1: 可选备注 + 操作组 (始终同行, 桌面移动一致)
           备注 flex-1 撑剩余, sm:max-w-md (448px) 桌面端封顶不过宽
           全部控件统一 h-9 (36px) / size-9, 两行视觉等高 -->
      <div class="flex items-center gap-2">
        <input
          type="text"
          :value="step.name"
          :placeholder="$t('funnels.name_optional_placeholder')"
          class="h-9 min-w-0 flex-1 rounded-md border border-gray-100 bg-transparent px-2 text-xs text-gray-700 placeholder:text-gray-400 hover:border-gray-200 focus:border-primary focus:bg-white focus:outline-none sm:max-w-xs"
          maxlength="80"
          autocomplete="off"
          @input="emit('update:step', { ...step, name: $event.target.value })"
        />
        <!-- 操作组 (size-9 跟其他控件等高, ml-auto 让操作组贴右不留空) -->
        <div class="ml-auto flex shrink-0 items-center">
          <button
            type="button"
            :disabled="isFirst"
            class="flex size-9 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-30"
            @click="emit('move-up')"
          >
            <NuxtIcon name="ri:arrow-up-line" class="size-3.5" />
          </button>
          <button
            type="button"
            :disabled="isLast"
            class="flex size-9 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-30"
            @click="emit('move-down')"
          >
            <NuxtIcon name="ri:arrow-down-line" class="size-3.5" />
          </button>
          <button
            v-if="canRemove"
            type="button"
            class="flex size-9 items-center justify-center rounded text-gray-400 hover:bg-red-50 hover:text-red-500"
            @click="emit('remove')"
          >
            <NuxtIcon name="ri:close-line" class="size-3.5" />
          </button>
        </div>
      </div>

      <!-- 行 2: Kind 分段 + Match + Value
           移动端 (<sm): flex-wrap, Value basis-full 换行独占
           桌面端 (sm+): 全部一行, Value flex-1 占剩余 -->
      <div class="flex flex-wrap items-center gap-2">

    <!-- Kind 分段控件 (Page | Event) — 外层 h-9 + items-stretch 让 button 自动填 -->
    <div class="flex h-9 shrink-0 rounded-md bg-gray-100 p-0.5">
      <button
        v-for="opt in KIND_OPTS"
        :key="opt.value"
        type="button"
        :class="[
          'whitespace-nowrap rounded px-3 text-xs font-medium transition-colors',
          step.kind === opt.value
            ? 'bg-white text-gray-900 shadow-sm'
            : 'text-gray-500 hover:text-gray-700',
        ]"
        @click="onKindChange(opt.value)"
      >
        {{ $t(opt.labelKey) }}
      </button>
    </div>

    <!-- Match 触发器 (仅 Page 显示, Event 强制 exact) -->
    <button
      v-if="step.kind === 'page'"
      ref="matchBtnRef"
      type="button"
      class="flex h-9 w-28 shrink-0 items-center justify-between gap-1 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-700 hover:border-gray-300 focus:border-primary focus:outline-none"
      @click="toggleMatch"
    >
      <span class="truncate">{{ $t(`funnels.match.${step.match}`) }}</span>
      <NuxtIcon name="ri:arrow-down-s-line" :class="['size-3.5 shrink-0 text-gray-400 transition-transform', matchPanel.open ? 'rotate-180' : '']" />
    </button>

    <!-- Value 输入框 (focus / 输入时弹候选下拉)
         移动端: basis-full → 跟 Kind/Match 同容器内自动换行独占
         桌面端: sm:basis-0 + grow → 撑剩余空间 -->
    <input
      ref="valueInputRef"
      type="text"
      :value="step.value"
      :placeholder="step.kind === 'event' ? $t('funnels.value_placeholder_event') : $t('funnels.value_placeholder_page')"
      class="h-9 min-w-0 basis-full grow shrink rounded-md border border-gray-200 px-2 text-xs text-gray-900 placeholder:text-gray-400 focus:border-primary focus:outline-none sm:basis-0"
      maxlength="500"
      autocomplete="off"
      @input="onValueInput"
      @focus="onValueFocus"
      @keydown.escape="valuePanel.open = false"
    />
      </div>
      <!-- close: 行 2 控件容器 -->
    </div>
    <!-- close: 右侧两行容器 -->
  </div>
  <!-- close: 外层 flex -->

  <!-- ============================================================
       Teleported dropdowns - 渲染到 body, fixed 定位
       --
       z-[100] 高于 modal (z-50) 一个量级, 永远在最上层
       data-funnel-panel 属性给 onGlobalPointerDown 用于"点 panel 内不关"
       ============================================================ -->
  <Teleport to="body">
    <!-- Match 下拉 -->
    <Transition name="modal-fade">
      <div
        v-if="matchPanel.open"
        data-funnel-panel="match"
        class="z-[100] overflow-hidden rounded-md border border-gray-200 bg-white py-1 shadow-lg"
        :style="matchPanel.style"
      >
        <button
          v-for="m in MATCH_OPTS"
          :key="m"
          type="button"
          :class="[
            'block w-full px-3 py-1.5 text-left text-xs transition-colors',
            step.match === m ? 'bg-primary/10 text-primary' : 'text-gray-700 hover:bg-gray-50',
          ]"
          @click="onMatchChange(m)"
        >
          {{ $t(`funnels.match.${m}`) }}
        </button>
      </div>
    </Transition>

    <!-- Value 候选下拉 (suggestions) -->
    <Transition name="modal-fade">
      <div
        v-if="valuePanel.open && filteredSuggestions.length"
        data-funnel-panel="value"
        class="z-[100] overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg"
        :style="valuePanel.style"
      >
        <button
          v-for="s in filteredSuggestions"
          :key="s"
          type="button"
          class="block w-full truncate px-3 py-1.5 text-left text-xs text-gray-700 transition-colors hover:bg-gray-50"
          @mousedown.prevent="onPickValue(s)"
        >
          {{ s }}
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
/* ============================================================
   FunnelStepRow - 子组件
   --
   关键决策:
     1) 两个 dropdown (Match / Value) 统一抽成 `panel` 模型,
        Teleport 到 body, fixed + viewport 坐标定位, 上下方向自适应,
        彻底跳出 modal 任意层 overflow 截断
     2) Value 输入框抛弃 <datalist> tooltip 风, 改成与 Match 同款
        自定义 dropdown, 风格统一 + 完整可控样式
     3) 选候选项用 @mousedown.prevent 而非 @click — mousedown 在
        input blur 之前触发, prevent 阻止 blur, 避免下拉被关掉
     4) 任何祖先滚动 (capture) / 外部点击 -> 自动关闭 panel,
        消除 fixed dropdown 跟随滚动错位的视觉 bug
   ============================================================ */

import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'

const props = defineProps({
  step:        { type: Object,  required: true },
  index:       { type: Number,  default: 0 },
  isFirst:     { type: Boolean, default: false },
  isLast:      { type: Boolean, default: false },
  canRemove:   { type: Boolean, default: false },
  suggestions: { type: Array,   default: () => [] },
})

const emit = defineEmits(['update:step', 'remove', 'move-up', 'move-down'])

/* ---- 选项查表 (替代分支) ---- */
const KIND_OPTS = [
  { value: 'page',  labelKey: 'funnels.kind.page' },
  { value: 'event', labelKey: 'funnels.kind.event' },
]
const MATCH_OPTS = ['exact', 'contains', 'starts_with', 'ends_with']

/* ============================================================
   step 字段更新
   ============================================================ */
function onKindChange(next) {
  if (next === props.step.kind) return
  const patch = { ...props.step, kind: next }
  if (next === 'event') patch.match = 'exact'   /* GA4 funnelEventFilter 仅支持 exact */
  emit('update:step', patch)
  /* kind 切换 -> 候选源变了, 关掉旧 value panel */
  valuePanel.open = false
}

function onMatchChange(next) {
  matchPanel.open = false
  emit('update:step', { ...props.step, match: next })
}

function onValueInput(e) {
  emit('update:step', { ...props.step, value: e.target.value })
  /* 输入时保持 panel 打开 (用户边敲边看候选过滤效果) */
  if (props.suggestions.length && !valuePanel.open) openValuePanel()
}

function onValueFocus() {
  if (props.suggestions.length) openValuePanel()
}

function onPickValue(s) {
  emit('update:step', { ...props.step, value: s })
  valuePanel.open = false
}

/* ---- 候选过滤: 按当前 value 模糊包含, top 30 ---- */
const filteredSuggestions = computed(() => {
  const q = String(props.step?.value || '').trim().toLowerCase()
  const list = props.suggestions || []
  if (!q) return list.slice(0, 30)
  return list.filter((s) => String(s).toLowerCase().includes(q)).slice(0, 30)
})

/* ============================================================
   Panel 统一模型: open + style (fixed 定位 + 自适应方向)
   --
   positionPanel(panel, anchorEl):
     - 算 anchorEl 在 viewport 的 rect
     - 比较下方/上方剩余空间, 选方向
     - 拼 fixed style (top|bottom + left + width + maxHeight)
   ============================================================ */
const matchPanel = reactive({ open: false, style: {}, estHeight: 170 })
const valuePanel = reactive({ open: false, style: {}, estHeight: 240 })

const matchBtnRef   = ref(null)
const valueInputRef = ref(null)

function positionPanel(panel, anchorEl) {
  if (!anchorEl || typeof window === 'undefined') return
  const rect = anchorEl.getBoundingClientRect()
  const spaceBelow = window.innerHeight - rect.bottom
  const spaceAbove = rect.top
  /* 下方放得下 → down; 否则比较上下哪边更大, 给空间更大的一边 */
  const goDown = spaceBelow >= panel.estHeight || spaceBelow >= spaceAbove

  const common = {
    position: 'fixed',
    left:     `${rect.left}px`,
    width:    `${rect.width}px`,
    zIndex:   100,
  }
  if (goDown) {
    panel.style = {
      ...common,
      top:        `${rect.bottom + 4}px`,
      maxHeight: `${Math.max(120, spaceBelow - 16)}px`,
    }
  } else {
    panel.style = {
      ...common,
      bottom:     `${window.innerHeight - rect.top + 4}px`,
      maxHeight: `${Math.max(120, spaceAbove - 16)}px`,
    }
  }
  panel.open = true
}

async function toggleMatch() {
  if (matchPanel.open) { matchPanel.open = false; return }
  /* 打开 match 前先关 value, 同时只有一个 panel 在飞 */
  valuePanel.open = false
  await nextTick()
  positionPanel(matchPanel, matchBtnRef.value)
}

async function openValuePanel() {
  if (!props.suggestions.length) return
  if (valuePanel.open) return
  matchPanel.open = false
  await nextTick()
  positionPanel(valuePanel, valueInputRef.value)
}

/* ============================================================
   全局监听: 外部点击 / 任何祖先滚动 -> 关闭 panel
   --
   capture: true 让 modal body 滚动也能被捕获 (滚动事件不冒泡)
   ============================================================ */
function onGlobalPointerDown(e) {
  const target = e.target
  if (matchPanel.open) {
    const insideTrigger = matchBtnRef.value && matchBtnRef.value.contains(target)
    const insidePanel   = target.closest && target.closest('[data-funnel-panel="match"]')
    if (!insideTrigger && !insidePanel) matchPanel.open = false
  }
  if (valuePanel.open) {
    const insideTrigger = valueInputRef.value && valueInputRef.value.contains(target)
    const insidePanel   = target.closest && target.closest('[data-funnel-panel="value"]')
    if (!insideTrigger && !insidePanel) valuePanel.open = false
  }
}
function onGlobalScroll(e) {
  /* fixed 定位的 panel 不会跟随祖先容器滚动, 祖先一滚就关避免视觉错位.
     但 panel 自身的 overflow-y-auto 也会冒出 scroll 事件, 必须排除掉,
     否则用户在长候选列表里上下翻看时整个 dropdown 会被自己关掉.
     resize (无 target) 一律关. */
  const target = e?.target
  if (target && target.closest && target.closest('[data-funnel-panel]')) return
  if (matchPanel.open) matchPanel.open = false
  if (valuePanel.open) valuePanel.open = false
}

onMounted(() => {
  if (!import.meta.client) return
  document.addEventListener('pointerdown', onGlobalPointerDown, true)
  document.addEventListener('scroll',      onGlobalScroll, true)
  window.addEventListener('resize',        onGlobalScroll)
})
onUnmounted(() => {
  if (!import.meta.client) return
  document.removeEventListener('pointerdown', onGlobalPointerDown, true)
  document.removeEventListener('scroll',      onGlobalScroll, true)
  window.removeEventListener('resize',        onGlobalScroll)
})

/* ---- kind 切换 / suggestions 数组身份变化时关闭 value panel ---- */
watch(() => props.step.kind, () => { valuePanel.open = false })
watch(() => props.suggestions, () => { valuePanel.open = false })
</script>
