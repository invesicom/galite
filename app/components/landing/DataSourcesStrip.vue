<template>
  <!-- ============================================================
       DataSourcesStrip — 数据源一句话露出
       无卡片、无边框, 让 provider 图标承担识别成本
       ============================================================ -->
  <section class="bg-white">
    <div class="mx-auto flex max-w-5xl flex-col items-center gap-5 px-4 py-8 sm:flex-row sm:justify-center sm:px-6 sm:py-10">
      <p class="text-sm font-medium text-gray-500 sm:text-base">
        {{ $t('landing.sources.lead') }}
      </p>

      <div class="flex flex-wrap items-center justify-center gap-x-7 gap-y-4 sm:gap-x-9">
        <div
          v-for="source in sources"
          :key="source.name"
          class="flex items-center gap-2.5 text-sm font-medium text-gray-800 sm:text-base"
        >
          <img
            :src="source.icon"
            :alt="source.name"
            class="size-6 shrink-0 sm:size-7"
            loading="lazy"
          />
          <span>{{ source.name }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
const sources = [
  { name: 'Google Analytics 4', icon: '/images/icon/google-analytics.svg' },
  { name: 'Search Console',     icon: '/images/icon/google-search-console.svg' },
  { name: 'Bing Webmaster',     icon: '/images/icon/bing-webmaster.svg' },
]
</script>
