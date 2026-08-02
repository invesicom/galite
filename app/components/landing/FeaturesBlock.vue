<template>
  <!-- ============================================================
       FeaturesBlock — 六大能力
       ============================================================ -->
  <section class="border-t border-gray-100 bg-white">
    <div class="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24 lg:py-28">
      <h2 class="mx-auto max-w-3xl text-center text-3xl font-semibold tracking-tight text-gray-900 sm:text-4xl lg:text-5xl">
        {{ $t('landing.features.title') }}
      </h2>

      <div class="mt-10 grid grid-cols-1 gap-x-10 gap-y-10 sm:mt-16 sm:grid-cols-2 sm:gap-y-14 lg:grid-cols-3">
        <div v-for="feature in featureItems" :key="feature.index" class="flex flex-col">
          <div :class="iconBoxClass">
            <NuxtIcon :name="feature.icon" class="size-7" />
          </div>
          <h3 class="mt-6 text-xl font-semibold text-gray-900">
            {{ $t(`landing.features.f${feature.index}.title`) }}
          </h3>
          <p class="mt-3 text-base leading-relaxed text-gray-700">
            {{ $t(`landing.features.f${feature.index}.desc`) }}
          </p>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
const featureItems = [
  {
    index: 1,
    icon: 'ri:dashboard-3-line',
  },
  {
    index: 2,
    icon: 'ri:line-chart-line',
  },
  {
    index: 3,
    icon: 'ri:earth-line',
  },
  {
    index: 4,
    icon: 'ri:share-line',
  },
  {
    index: 5,
    icon: 'ri:filter-3-line',
  },
  {
    index: 6,
    icon: 'ri:robot-2-line',
  },
]

const iconBoxClass = 'flex size-14 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-blue-700'
</script>
