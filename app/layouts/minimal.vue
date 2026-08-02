<template>
  <!-- ========================================
       Minimal Layout - 极简
       - 居中卡片场景 (error 等)
       - 仅保留 ToastContainer + LanguageGuide + provide
       ======================================== -->
  <div class="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
    <slot />

    <!-- 共享 modals (page 内部可能 inject openLogin) -->
    <LoginModal :visible="loginModalVisible" closable @close="loginModalVisible = false" />
    <LanguageModal :visible="langModalVisible" @close="langModalVisible = false" />
    <ToastContainer />
  </div>
</template>

<script setup>
/* ===========================================================================
   Minimal Layout
   只保最小必要 (toast + 登录/语言 modal), 不带顶栏 / sidebar / footer
   =========================================================================== */

import LoginModal from '~/components/layout/LoginModal.vue'
import LanguageModal from '~/components/layout/LanguageModal.vue'
import ToastContainer from '~/components/layout/ToastContainer.vue'

const loginModalVisible = ref(false)
const langModalVisible = ref(false)

provide('openLogin', () => { loginModalVisible.value = true })
provide('openLanguage', () => { langModalVisible.value = true })
</script>
