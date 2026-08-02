<template>
  <!-- ============================================================
       FilterBar - 已添加筛选条件 chip 展示 (+ 超出折叠下拉)
       --
       "+ 筛选" 入口已拆到 FilterAddDropdown 独立组件 (父组件灵活放置).
       本组件仅负责 "已有筛选" 的 chip 视觉 + 删除 / 清除全部交互.
       --
       UI (desktop, ≥ md):
         [chip 1 ✕] [chip 2 ✕] [chip 3 ✕] [⋯ +N]
       超出 maxVisible 时, 多余 chip 折叠到 ⋯ popover 下拉, 底部"清除全部"
       --
       UI (mobile, < md):
         [⋯ +N]                  -- 所有 chip 全部进折叠菜单 (节省横向空间)
       折叠菜单走 Teleport 全屏 modal, 替代 popover dropdown —
         popover 在窄屏会被屏幕右边缘截断, modal 居中卡片永不溢出
       --
       props.maxVisible: 默认 3 (跟 Plausible 一致). mobile 自动覆盖为 0.
       ============================================================ -->
  <div v-if="filters.length" class="flex flex-wrap items-center gap-1.5">
    <!-- 可见 chips: 点击主体编辑, ✕ 删除. mobile 下 visibleFilters 恒为空, 不渲染 -->
    <FilterChip
      v-for="(f, i) in visibleFilters"
      :key="i + ':' + f.dim + ':' + f.value"
      :filter="f"
      @remove="emit('remove', i)"
      @edit="emit('edit', i)"
    />

    <!-- ⋯ 折叠菜单触发按钮: mobile/desktop 共用
         按钮尺寸跟 RefreshButton 对齐: mobile size-9, md+ size-10 -->
    <div v-if="showOverflowMenu" ref="overflowRef" class="relative">
      <button
        type="button"
        class="relative inline-flex size-9 items-center justify-center rounded-full border border-dashed border-gray-300 bg-white text-gray-600 transition-colors hover:border-gray-400 hover:bg-gray-50 md:size-10"
        @click="overflowOpen = !overflowOpen"
      >
        <NuxtIcon name="ri:more-line" class="size-4" />
        <span
          v-if="overflowFilters.length"
          class="absolute -bottom-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gray-900 px-1 text-[10px] font-medium leading-none text-white"
        >
          +{{ overflowFilters.length }}
        </span>
      </button>

      <!-- ============ 桌面: popover dropdown (≥ md) ============ -->
      <Transition name="modal-fade">
        <div
          v-if="overflowOpen && !isMobile"
          :class="[
            'absolute left-1/2 top-full z-20 mt-1 -translate-x-1/2 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg',
            overflowFilters.length ? 'w-56' : 'w-32',
          ]"
        >
          <div v-if="overflowFilters.length" class="max-h-64 overflow-y-auto py-1">
            <div
              v-for="(f, i) in overflowFilters"
              :key="'o-' + i + ':' + f.dim + ':' + f.value"
              role="button"
              tabindex="0"
              class="group flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
              @click="onOverflowEdit(i)"
              @keydown.enter="onOverflowEdit(i)"
            >
              <span class="min-w-0 flex-1 truncate">
                <span class="text-gray-500">{{ $t(dimTitleKey(f.dim)) }}</span>
                <i18n-t :keypath="matchOpTplKey(f.match)" tag="span" class="mx-1 text-gray-700" scope="global">
                  <template #value>
                    <img
                      v-if="isSearchProviderFilter(f) && providerIcon(f)"
                      :src="providerIcon(f)"
                      :alt="displayFilterValue(f)"
                      :title="displayFilterValue(f)"
                      class="inline-block size-4 align-[-2px]"
                    >
                    <span v-else class="font-medium text-gray-900">{{ displayFilterValue(f) }}</span>
                  </template>
                </i18n-t>
              </span>
              <button
                type="button"
                class="flex size-5 shrink-0 items-center justify-center rounded text-gray-400 opacity-0 group-hover:opacity-100 hover:bg-gray-100 hover:text-red-500"
                @click.stop="emit('remove', visibleFilters.length + i)"
              >
                <NuxtIcon name="ri:close-line" class="size-3" />
              </button>
            </div>
          </div>
          <div :class="overflowFilters.length ? 'border-t border-gray-100' : ''">
            <button
              type="button"
              class="block w-full px-3 py-2 text-left text-xs text-red-500 hover:bg-red-50"
              @click="onClearAll"
            >
              {{ $t('filters.clear_all') }}
            </button>
          </div>
        </div>
      </Transition>
    </div>

    <!-- ============ 移动: Teleport modal (< md)
         Teleport to body 跳出 toolbar 的 overflow / sticky 上下文,
         z-[70] 跟项目内其他 modal (DimensionDetailModal) 同层, 屏幕居中
         卡片排版, 每条 filter 列大字号便于点击, 操作元素手指友好 ============ -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div
          v-if="overflowOpen && isMobile"
          class="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4 backdrop-blur-[3px]"
          @click.self="overflowOpen = false"
        >
          <div class="flex max-h-[80vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
            <!-- Header -->
            <div class="flex items-center justify-between gap-2 border-b border-gray-100 px-5 py-3.5">
              <h3 class="text-base font-semibold text-gray-900">
                {{ $t('filters.list_title') }}
              </h3>
              <button
                type="button"
                class="flex size-8 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                :aria-label="$t('common.close')"
                @click="overflowOpen = false"
              >
                <NuxtIcon name="ri:close-line" class="size-4" />
              </button>
            </div>

            <!-- Body: 完整 filter 列表 (移动端走 overflowFilters = 全部 filters) -->
            <div class="flex-1 overflow-y-auto px-2 py-2">
              <div
                v-for="(f, i) in overflowFilters"
                :key="'m-' + i + ':' + f.dim + ':' + f.value"
                role="button"
                tabindex="0"
                class="group flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-gray-50 active:bg-gray-100"
                @click="onOverflowEdit(i)"
                @keydown.enter="onOverflowEdit(i)"
              >
                <span class="min-w-0 flex-1 truncate">
                  <span class="text-gray-500">{{ $t(dimTitleKey(f.dim)) }}</span>
                  <i18n-t :keypath="matchOpTplKey(f.match)" tag="span" class="mx-1 text-gray-700" scope="global">
                    <template #value>
                      <img
                        v-if="isSearchProviderFilter(f) && providerIcon(f)"
                        :src="providerIcon(f)"
                        :alt="displayFilterValue(f)"
                        :title="displayFilterValue(f)"
                        class="inline-block size-4 align-[-2px]"
                      >
                      <span v-else class="font-medium text-gray-900">{{ displayFilterValue(f) }}</span>
                    </template>
                  </i18n-t>
                </span>
                <button
                  type="button"
                  class="flex size-7 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-red-50 hover:text-red-500"
                  :aria-label="$t('common.delete')"
                  @click.stop="emit('remove', visibleFilters.length + i)"
                >
                  <NuxtIcon name="ri:close-line" class="size-4" />
                </button>
              </div>
            </div>

            <!-- Footer: 只保留"清除全部" — 关闭走右上角 ✕ / 遮罩点击, 不重复 -->
            <div class="flex items-center justify-center border-t border-gray-100 px-5 py-3">
              <button
                type="button"
                class="rounded-md px-3 py-1.5 text-sm font-medium text-red-500 hover:bg-red-50"
                @click="onClearAll"
              >
                {{ $t('filters.clear_all') }}
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
   FilterBar - 仅 chip 显示, 入口已拆到 FilterAddDropdown
   --
   filters 空时整体不渲染 (不占布局空间).
   mobile (< md=768px) 强制 maxVisible=0, 所有 chip 走折叠菜单, 且菜单走 modal
   ============================================================ */

import { computed, onMounted, onUnmounted, ref } from 'vue'
import FilterChip from './FilterChip.vue'
import { dimTitleKey, matchOpTplKey } from '~/utils/filters'

const props = defineProps({
  filters:    { type: Array,  default: () => [] },
  maxVisible: { type: Number, default: 3 },
})

const emit = defineEmits(['remove', 'clear-all', 'edit'])
const { t } = useI18n()

const PROVIDER_ICON = {
  gsc: '/images/icon/google-search-console.svg',
  bing: '/images/icon/bing-webmaster.svg',
}

function isSearchProviderFilter(filter) {
  return filter?.dim === 'searchProvider'
}

function providerIcon(filter) {
  return PROVIDER_ICON[filter?.value] || ''
}

function displayFilterValue(filter) {
  if (!isSearchProviderFilter(filter)) return filter?.value || ''
  const key = `integrations.provider.${filter.value}`
  const label = t(key)
  return label === key ? filter.value : label
}

/* 溢出菜单 / mobile modal 内的行也支持编辑: 关菜单 + 上抛 edit(全局 index) */
function onOverflowEdit(i) {
  overflowOpen.value = false
  emit('edit', visibleFilters.value.length + i)
}

/* ---- mobile 检测 (matchMedia 比 window.innerWidth 更省事, 自动跟随旋转) ---- */
const isMobile = ref(false)
let mqList = null
function syncMobile(e) { isMobile.value = e.matches }
onMounted(() => {
  if (typeof window === 'undefined') return
  mqList = window.matchMedia('(max-width: 767px)')
  isMobile.value = mqList.matches
  mqList.addEventListener('change', syncMobile)
  document.addEventListener('pointerdown', onClickOutside)
})
onUnmounted(() => {
  if (typeof window === 'undefined') return
  mqList?.removeEventListener('change', syncMobile)
  document.removeEventListener('pointerdown', onClickOutside)
})

/* effectiveMaxVisible: mobile 强制为 0, desktop 用 props.maxVisible.
   单一查表替代分支, 避免在 visibleFilters/overflowFilters 各 if 一遍 */
const effectiveMaxVisible = computed(() => isMobile.value ? 0 : props.maxVisible)

const visibleFilters  = computed(() => props.filters.slice(0, effectiveMaxVisible.value))
const overflowFilters = computed(() => props.filters.slice(effectiveMaxVisible.value))

/* 折叠菜单显示条件:
   mobile: 有 filter 就显示 (≥1)
   desktop: ≥2 filter 时显示 (1 个 filter 直接 chip 就够了, 无需菜单兜底) */
const showOverflowMenu = computed(() =>
  isMobile.value ? props.filters.length >= 1 : props.filters.length >= 2,
)

const overflowRef = ref(null)
const overflowOpen = ref(false)

function onClearAll() {
  overflowOpen.value = false
  emit('clear-all')
}

/* click-outside 只对桌面 popover 生效, 移动 modal 用遮罩 @click.self 关闭 */
function onClickOutside(e) {
  if (!overflowOpen.value || isMobile.value) return
  if (overflowRef.value && !overflowRef.value.contains(e.target)) {
    overflowOpen.value = false
  }
}
</script>
