<template>
  <!-- ============================================================
       SortDropdown - 通用排序下拉
       受控 v-model + 选项数组
       点击外部自动关闭 (pointerdown 监听 root)
       ============================================================ -->
  <div ref="rootRef" class="relative">
    <!-- 触发按钮 — mobile 仅图标 (size-9 方形, 跟 RefreshButton 移动尺寸对齐),
         desktop 显 图标+文字+▼ (横向空间充足, 一眼看清当前排序方式).
         mobile 给当前 label 挂 v-tooltip.bottom 兜底信息, 长按/hover 可看. -->
    <button
      type="button"
      v-tooltip.bottom="currentLabel"
      :class="[
        'inline-flex h-9 items-center justify-center rounded-md border border-gray-200 bg-white text-sm text-gray-700 hover:bg-gray-50',
        'w-9 md:w-auto md:gap-1 md:px-3.5',
      ]"
      @click="open = !open"
    >
      <NuxtIcon name="ri:sort-desc" class="size-4 shrink-0 text-gray-500 md:hidden" />
      <span class="hidden md:inline">{{ currentLabel }}</span>
      <NuxtIcon name="ri:arrow-down-s-line" class="hidden size-4 text-gray-400 md:inline" />
    </button>

    <Transition name="modal-fade">
      <div
        v-if="open"
        class="absolute right-0 top-full z-30 mt-1 min-w-[180px] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
      >
        <template v-for="(opt, i) in options" :key="opt.value || ('div-' + i)">
          <!-- 分组分隔线 (opt.divider): 把 GA4 指标组 / GSC 指标组分开 -->
          <div v-if="opt.divider" class="my-1 border-t border-gray-100" />
          <button
            v-else
            type="button"
            :class="[
              'block w-full px-3.5 py-2 text-left text-sm',
              modelValue === opt.value ? 'bg-primary/10 text-primary' : 'text-gray-700 hover:bg-gray-50',
            ]"
            @click="onPick(opt.value)"
          >
            {{ opt.label }}
          </button>
        </template>
      </div>
    </Transition>
  </div>
</template>

<script setup>
/* ============================================================
   SortDropdown - 通用排序选择
   props.modelValue: 当前选中 value
   props.options:    [{ value, label }]
   emits: update:modelValue
   ============================================================ */

import { computed, onMounted, onUnmounted, ref } from 'vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  options: { type: Array, default: () => [] },
})

const emit = defineEmits(['update:modelValue'])

const rootRef = ref(null)
const open = ref(false)

const currentLabel = computed(() => {
  const found = props.options.find((o) => o.value === props.modelValue)
  return found ? found.label : ''
})

function onPick(v) {
  emit('update:modelValue', v)
  open.value = false
}

function onOutside(e) {
  if (rootRef.value && !rootRef.value.contains(e.target)) open.value = false
}

onMounted(() => document.addEventListener('pointerdown', onOutside))
onUnmounted(() => document.removeEventListener('pointerdown', onOutside))
</script>
