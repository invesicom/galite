<template>
  <div class="rounded-lg border border-gray-200 bg-white p-4">
    <div class="text-xs font-medium text-gray-500">{{ label }}</div>
    <div v-if="loading" class="mt-3 h-7 w-24 animate-pulse rounded bg-gray-100" />
    <div v-else class="mt-2 text-2xl font-semibold text-gray-900">{{ formatted }}</div>
  </div>
</template>

<script setup>
const props = defineProps({
  label: { type: String, required: true },
  value: { type: [Number, String], default: 0 },
  format: { type: String, default: 'number' },
  loading: { type: Boolean, default: false },
})

const formatted = computed(() => {
  const value = Number(props.value) || 0
  if (props.format === 'percent') return `${(value * 100).toFixed(1)}%`
  if (props.format === 'duration') {
    if (value < 60) return `${Math.round(value)}s`
    const minutes = Math.floor(value / 60)
    const seconds = Math.round(value % 60)
    return `${minutes}m ${seconds}s`
  }
  return Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
})
</script>
