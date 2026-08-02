<template>
  <!-- ============================================================
       前台页面 404
       --
       职责: 只处理浏览器页面路由未命中. API 404 由 Nitro /api/*
             JSON 通道处理, 不进入这里。
       --
       设计: catch-all 是正常 page route, 因此天然拥有 i18n route
             context; 比从 Nuxt error.vue 反推原始 URL 更稳定。
       ============================================================ -->
  <div class="mx-auto flex w-full max-w-2xl flex-col items-center px-6 py-24 text-center sm:py-32">
    <div class="text-7xl font-bold tracking-tight text-gray-900 sm:text-8xl">
      404
    </div>

    <h1 class="mt-6 text-2xl font-bold text-gray-900 sm:text-3xl">
      {{ t('error.404.title') }}
    </h1>
    <p class="mt-3 max-w-md text-base text-gray-500">
      {{ t('error.404.desc') }}
    </p>

    <NuxtLink
      :to="homePath"
      class="mt-8 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-text transition-opacity hover:opacity-90"
    >
      <NuxtIcon name="ri:arrow-left-line" class="size-4" />
      {{ t('error.back_home') }}
    </NuxtLink>
  </div>
</template>

<script setup>
definePageMeta({ layout: 'landing' })

const { t } = useI18n()
const localePath = useLocalePath()

setResponseStatus(404)
useHead(() => ({ title: t('error.404.title') }))

const homePath = computed(() => localePath('/'))
</script>
