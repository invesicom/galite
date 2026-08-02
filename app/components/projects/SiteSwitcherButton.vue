<template>
  <!-- ============================================================
       SiteSwitcherButton - 工具栏上的站点切换器触发按钮
       --
       视觉: 跟 PeriodSwitcher / FilterAddDropdown 同款 dropdown 风格
         h-9 md:h-10, 圆角边框白底, 内含 favicon + 名字 + ▼
       --
       PC (≥ md): [🌐 站点名 ▼]
       移动 (< md): [🌐 ▼]   -- 名字隐藏, 节省横向空间
       --
       点击 emit('open'), 由父组件控制现有 SiteSwitcherModal 显隐.
       本组件只是触发器, 不持有 modal 状态 — 单一职责.
       --
       props.faviconUrl: favicon URL (可空), 加载失败自动回退 globe 图标
       props.name:       站点显示名
       emits: open
       ============================================================ -->
  <button
    type="button"
    class="inline-flex h-9 max-w-full items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 text-sm text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50 md:h-10 md:gap-2 md:px-2.5"
    @click="emit('open')"
  >
    <!-- favicon: bg-gray-100 占位 + onerror 兜底 → globe icon
         切站点 (faviconUrl 变化) 时 broken 复位, 避免上一站点的破图状态污染 -->
    <span class="flex size-5 shrink-0 items-center justify-center overflow-hidden rounded bg-gray-100">
      <img
        v-if="faviconUrl && !broken"
        :src="faviconUrl"
        class="size-full object-cover"
        referrerpolicy="no-referrer"
        alt=""
        @error="broken = true"
      />
      <NuxtIcon v-else name="ri:global-line" class="size-3 text-gray-400" />
    </span>

    <!-- 站点名: PC 显示, mobile 隐藏 (favicon 已足够辨识当前站) -->
    <span class="hidden min-w-0 max-w-[180px] truncate font-medium text-gray-900 md:inline">
      {{ name || '—' }}
    </span>

    <!-- ▼ 三角: 透露"可切换"语义, 跟 PeriodSwitcher 下拉视觉一致.
         mobile 隐藏 (只显 favicon, 节省横向空间 — favicon 自带"代表当前站点"的视觉, 边框已足够暗示可点) -->
    <NuxtIcon name="ri:arrow-down-s-line" class="hidden size-3.5 shrink-0 text-gray-400 md:inline" />
  </button>
</template>

<script setup>
/* ============================================================
   SiteSwitcherButton - dropdown 形态触发器
   --
   逻辑: 纯触发, 不弹层. 弹层由父组件用现有 SiteSwitcherModal 接管
   ============================================================ */

import { ref, watch } from 'vue'

const props = defineProps({
  faviconUrl: { type: String, default: '' },
  name:       { type: String, default: '' },
})

const emit = defineEmits(['open'])

/* faviconUrl 变化时 broken 复位 (站点切换场景: 旧站破图态不应污染新站) */
const broken = ref(false)
watch(() => props.faviconUrl, () => { broken.value = false })
</script>
