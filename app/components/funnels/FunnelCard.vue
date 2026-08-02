<template>
  <!-- ============================================================
       FunnelCard - 漏斗卡片 (Header + 内嵌柱状图)
       --
       props:
         funnel    - { funnel_key, name, step_count, steps[] }
         result    - GA4 执行结果 (含 steps[].users / drop_rate / ...) | null
         loading   - 列表已到 funnel 元数据, 但 result 未到 → Header 真实
                     + FunnelBars 骨架 (用户能看到 funnel name 而非空白)
         skeleton  - funnel 列表本身还没到 → 整张卡走骨架 (Header + Bars)
       --
       emits: edit / delete
       --
       高度严格对齐: skeleton 与真实状态用同一组容器/边距, 高度由浏览器
       按相同结构计算, 切换/刷新时零跳动. text 元素显式加 leading 锁行高.
       ============================================================ -->
  <div class="group rounded-xl border border-gray-200 bg-white p-4">
    <!-- ============ Header: name + summary + 三点菜单 ============ -->
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0 flex-1">
        <!-- name 行: h-6 (text-base leading-6) -->
        <template v-if="skeleton">
          <div class="h-6 w-2/3 animate-pulse rounded bg-gray-200" />
        </template>
        <h4 v-else class="truncate text-base font-semibold leading-6 text-gray-900">
          {{ funnel?.name || $t('funnels.untitled') }}
        </h4>
        <!-- summary 行: h-5 (text-sm leading-5), mt-0.5 -->
        <template v-if="skeleton">
          <div class="mt-0.5 h-5 w-1/3 animate-pulse rounded bg-gray-100" />
        </template>
        <div v-else class="mt-0.5 truncate text-sm leading-5 text-gray-500">
          {{ summaryText }}
        </div>
      </div>
      <!-- 三点菜单 (skeleton 时只占位 size-6 维持 Header 等高) -->
      <div v-if="skeleton || !actions" class="size-6 shrink-0" aria-hidden="true"></div>
      <div v-else ref="menuRef" class="relative shrink-0">
        <button
          type="button"
          class="flex size-6 items-center justify-center rounded text-gray-400 transition-opacity hover:bg-gray-100 hover:text-gray-700 md:opacity-0 md:group-hover:opacity-100"
          @click.stop="menuOpen = !menuOpen"
        >
          <NuxtIcon name="ri:more-2-fill" class="size-4" />
        </button>
        <Transition name="modal-fade">
          <div
            v-if="menuOpen"
            class="absolute right-0 top-full z-10 mt-1 w-28 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
            @click.stop
          >
            <button
              type="button"
              class="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
              @click="onEdit"
            >
              {{ $t('common.edit') }}
            </button>
            <button
              type="button"
              class="block w-full px-3 py-1.5 text-left text-sm text-red-500 hover:bg-red-50"
              @click="onDelete"
            >
              {{ $t('common.delete') }}
            </button>
          </div>
        </Transition>
      </div>
    </div>

    <!-- ============ Bars: 骨架 (loading 或 skeleton) ↔ 真实, 容器永远等高 ============ -->
    <div class="mt-4">
      <FunnelBars
        :data="result"
        :loading="loading || skeleton"
        :expected-steps="funnel?.steps || []"
      />
    </div>
  </div>
</template>

<script setup>
/* ============================================================
   FunnelCard - 单漏斗卡片
   --
   双 loading 维度:
     skeleton: funnel 列表自身骨架 (funnels API 还没返); Header + Bars 全骨架
     loading:  funnel 元数据已到, 单条 result 还在拉; Header 真实, Bars 骨架
   --
   summaryText: 真实状态 "{n}-step · {x}% conversion"
                loading 或 error 退化为 "{n}-step · —"
   ============================================================ */

import { computed, onMounted, onUnmounted, ref } from 'vue'
import FunnelBars from './FunnelBars.vue'

const props = defineProps({
  funnel:   { type: Object,  default: null },
  result:   { type: Object,  default: null },
  loading:  { type: Boolean, default: false },
  skeleton: { type: Boolean, default: false },
  actions:  { type: Boolean, default: true },
})

const emit = defineEmits(['edit', 'delete'])

const { t } = useI18n()

const summaryText = computed(() => {
  const stepCount = props.funnel?.step_count || (props.funnel?.steps?.length || 0)
  const stepLabel = t('funnels.step_count_short', { n: stepCount })
  /* 无数据态: loading / error / 第一步 users=0 (没人进入漏斗)
     都退化为 "{n}步 · —", 不显示 "0.00% 转化率" — 数学上是 0% 没错,
     但用户读"0.00% 转化率"会误以为是"算出来的真实低转化", 实则是"没数据".
     em-dash 跟柱状图区的"暂无数据"语义对齐, 用户一眼看出"这漏斗无数据" */
  const firstUsers = Number(props.result?.steps?.[0]?.users || 0)
  if (props.loading || !props.result || props.result.error || firstUsers === 0) {
    return `${stepLabel} · —`
  }
  const r = Number(props.result.overall_conversion_rate || 0)
  const fixed = Math.abs(r) >= 0.1 ? 1 : 2
  const pct = `${(r * 100).toFixed(fixed)}%`
  return `${stepLabel} · ${pct} ${t('funnels.conversion_short')}`
})

/* ---- 三点菜单 ---- */
const menuRef = ref(null)
const menuOpen = ref(false)
function onEdit()   { menuOpen.value = false; emit('edit') }
function onDelete() { menuOpen.value = false; emit('delete') }

function onClickOutside(e) {
  if (menuRef.value && !menuRef.value.contains(e.target)) menuOpen.value = false
}
onMounted(()   => { if (import.meta.client) document.addEventListener('pointerdown', onClickOutside) })
onUnmounted(() => { if (import.meta.client) document.removeEventListener('pointerdown', onClickOutside) })
</script>
