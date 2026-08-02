<template>
  <!-- ============================================================
       RefreshButton - 手动刷新 icon button
       size: mobile size-9 (36px), md+ size-10 (40px)
       loading 时禁用 + 旋转
       ============================================================ -->
  <button
    type="button"
    :disabled="loading"
    v-tooltip="$t('toolbar.refresh')"
    :class="[
      'inline-flex size-9 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 transition-colors md:size-10',
      loading ? 'cursor-not-allowed opacity-60' : 'hover:bg-gray-50',
    ]"
    @click="$emit('refresh')"
  >
    <NuxtIcon
      name="ri:refresh-line"
      :class="['size-4 md:size-5', loading ? 'animate-spin' : '']"
    />
  </button>
</template>

<script setup>
/* ============================================================
   RefreshButton - 共享刷新按钮
   props.loading: true 时禁用 + 旋转动画
   emits: refresh
   ============================================================ */

defineProps({
  loading: { type: Boolean, default: false },
})

defineEmits(['refresh'])
</script>
