<template>
  <!-- ============================================================
       HideToggle - 隐藏名字图标 toggle (眼睛 / 划线眼睛)
       受控: v-model:boolean
       --
       两种状态共用灰色 outline 样式, 仅图标切换 (eye-line ↔ eye-off-line).
       不再用 primary 高亮选中态 — 视觉过重, 让一个偶尔切换的"展示偏好"
       开关跟操作类按钮 (filter / refresh) 视觉权重一致即可.
       图标本身已能传达状态 (闭眼 = 已隐藏), 颜色多余.
       ============================================================ -->
  <button
    type="button"
    v-tooltip="modelValue ? $t('toolbar.show_names') : $t('toolbar.hide_names')"
    class="inline-flex size-9 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700"
    @click="$emit('update:modelValue', !modelValue)"
  >
    <NuxtIcon :name="modelValue ? 'ri:eye-off-line' : 'ri:eye-line'" class="size-5" />
  </button>
</template>

<script setup>
/* ============================================================
   HideToggle - 共享脱敏 toggle
   props.modelValue: 当前是否隐藏 (true = 隐藏)
   emits: update:modelValue
   ============================================================ */

defineProps({
  modelValue: { type: Boolean, default: false },
})

defineEmits(['update:modelValue'])
</script>
