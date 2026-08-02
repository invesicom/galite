<template>
  <!-- ============================================================
       FilterAddDropdown - 独立 "+ 筛选" 按钮 + 维度选择下拉
       --
       拆出独立组件让父组件能灵活放置 (现在放在右侧操作群组).
       高度: mobile h-9 (36px), md+ h-10 (40px) 对齐 PeriodSwitcher.
       移动端紧凑: 隐藏文字标签, 仅保留 filter 图标.
       --
       popover 锚定: left-1/2 -translate-x-1/2 让 menu 水平居中于按钮 —
         之前 right-0 会让 menu 右边对齐按钮右边, 但 menu 宽 192 远大于按钮宽 40,
         menu 看起来"飘到按钮左下方"; 居中对齐让 menu 视觉上正确"挂在按钮下方"
       --
       第一步轻交互: 选维度 → emit('pick-dim', dimKey) → 父组件接管 FilterAddModal 收 match + value
       ============================================================ -->
  <div ref="dropdownRef" class="relative">
    <button
      type="button"
      :class="[
        'inline-flex h-9 items-center gap-1 rounded-md border bg-white px-2.5 text-sm transition-colors md:h-10 md:px-3',
        open
          ? 'border-primary/40 text-primary'
          : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50',
      ]"
      @click="open = !open"
    >
      <NuxtIcon name="ri:filter-3-line" class="size-4" />
      <span class="hidden md:inline">{{ $t('filters.add_action') }}</span>
      <NuxtIcon
        name="ri:arrow-down-s-line"
        :class="[
          'hidden size-3.5 text-gray-400 transition-transform md:inline',
          open ? 'rotate-180' : '',
        ]"
      />
    </button>

    <!-- popover 锚定:
         移动端 (按钮在 toolbar 最左 order-first) → left-0 对齐按钮左, 避免居中导致一半在屏外
         PC 端 (按钮在 toolbar 右组) → md:left-1/2 md:-translate-x-1/2 居中于按钮
         media query 接管 — 移动 left-0, md+ 时 md:left-1/2 + md:-translate-x-1/2 覆盖 -->
    <Transition name="modal-fade">
      <div
        v-if="open"
        class="absolute left-0 top-full z-20 mt-1 w-48 overflow-hidden rounded-md border border-gray-200 bg-white py-1 shadow-lg md:left-1/2 md:-translate-x-1/2"
      >
        <div class="border-b border-gray-100 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-gray-400">
          {{ $t('filters.dim_label') }}
        </div>
        <button
          v-for="d in visibleDims"
          :key="d.key"
          type="button"
          class="block w-full px-3 py-1.5 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 hover:text-gray-900"
          @click="onPickDim(d.key)"
        >
          {{ $t(d.titleKey) }}
        </button>
      </div>
    </Transition>
  </div>
</template>

<script setup>
/* ============================================================
   FilterAddDropdown - 维度选择下拉
   --
   外部点击关闭 (跟项目内其他 dropdown 同款), 单一形态 popover, 无 mobile/desktop 分支
   ============================================================ */

import { computed, onMounted, onUnmounted, ref } from 'vue'
import { filterDimsByDataSource } from '~/utils/filters'

const props = defineProps({
  /* 当前数据源: ga4 (默认) / search — 决定下拉里显示哪些维度 */
  dataSource: { type: String, default: 'ga4' },
  /* 已接入的搜索平台. 多平台时才显示 searchProvider 筛选项. */
  searchProviders: { type: Array, default: () => [] },
})

const emit = defineEmits(['pick-dim'])

const visibleDims = computed(() => filterDimsByDataSource(props.dataSource, {
  searchProviders: props.searchProviders,
}))

const dropdownRef = ref(null)
const open = ref(false)

function onPickDim(dim) {
  open.value = false
  emit('pick-dim', dim)
}

function onClickOutside(e) {
  if (!open.value) return
  if (dropdownRef.value && !dropdownRef.value.contains(e.target)) open.value = false
}
onMounted(()   => { if (import.meta.client) document.addEventListener('pointerdown', onClickOutside) })
onUnmounted(() => { if (import.meta.client) document.removeEventListener('pointerdown', onClickOutside) })
</script>
