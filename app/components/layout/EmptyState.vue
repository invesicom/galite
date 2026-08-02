<template>
  <!-- ========================================
       EmptyState — 统一的空状态/引导区块
       图标 + 标题 + 描述 + CTA (link 或 button)
       ======================================== -->
  <div class="mt-16 flex flex-col items-center justify-center px-6 text-center">
    <!-- 图标 -->
    <div
      class="mb-5 flex size-16 items-center justify-center rounded-2xl bg-gray-100 text-gray-400"
    >
      <svg
        class="size-8"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M22 12h-6l-2 3h-4l-2-3H2" />
        <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      </svg>
    </div>

    <!-- 标题 -->
    <h2 class="text-lg font-semibold text-gray-900">{{ title }}</h2>

    <!-- 描述 -->
    <p v-if="description" class="mt-2 max-w-md text-sm leading-relaxed text-gray-500">
      {{ description }}
    </p>

    <!-- CTA: 路由链接 -->
    <NuxtLink
      v-if="ctaLabel && ctaTo"
      :to="ctaTo"
      class="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-text transition-opacity hover:opacity-90"
    >
      <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
      {{ ctaLabel }}
    </NuxtLink>

    <!-- CTA: 事件按钮 -->
    <button
      v-else-if="ctaLabel"
      type="button"
      class="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-text transition-opacity hover:opacity-90"
      @click="$emit('cta')"
    >
      {{ ctaLabel }}
    </button>
  </div>
</template>

<script setup>
/* ===========================================================
   EmptyState
   统一空状态 UI — 用于未登录 / 空列表 / 错误 等场景
   =========================================================== */

defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  ctaLabel: { type: String, default: '' },
  ctaTo: { type: [String, Object], default: null },
})

defineEmits(['cta'])
</script>
