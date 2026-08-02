<template>
  <!-- ============================================================
       FaqBlock — 固定展开 FAQ
       ============================================================ -->
  <section class="border-t border-gray-100 bg-white">
    <div class="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-24 lg:py-28">
      <div class="text-center">
        <h2 class="text-3xl font-semibold tracking-tight text-gray-900 sm:text-4xl lg:text-5xl">
          {{ $t('landing.faq.title') }}
        </h2>
      </div>

      <div class="mt-10 divide-y divide-gray-200 border-y border-gray-200 sm:mt-14">
        <div v-for="i in 11" :key="i" class="py-6 sm:py-7">
          <h3 class="text-lg font-semibold text-gray-900 sm:text-xl">
            {{ $t(`landing.faq.q${i}.q`) }}
          </h3>
          <p class="mt-3 text-base leading-relaxed text-gray-700 sm:mt-4 sm:text-lg">
            {{ $t(`landing.faq.q${i}.a`) }}
          </p>
        </div>
      </div>
    </div>
  </section>
</template>
