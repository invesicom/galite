<template>
  <!-- ============================================================
       FinalCta — 极简最终 CTA (大字版)
       ============================================================ -->
  <section class="border-t border-gray-100 bg-white">
    <div class="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6 sm:py-28 lg:py-32">
      <h2 class="text-3xl font-semibold tracking-tight text-gray-900 sm:text-4xl lg:text-5xl">
        {{ $t('landing.final.title') }}
      </h2>
      <p class="mx-auto mt-5 max-w-xl text-base text-gray-700 sm:mt-6 sm:text-lg">
        {{ $t('landing.final.subtitle') }}
      </p>

      <div class="mt-8 sm:mt-12">
        <NuxtLink
          v-if="isLoggedIn"
          :to="localePath('/projects')"
          class="inline-flex h-12 items-center rounded-full bg-primary px-7 text-base font-semibold text-primary-text transition-opacity hover:opacity-90 sm:h-14 sm:px-9 sm:text-lg"
        >
          {{ $t('landing.final.primary_dashboard') }}
        </NuxtLink>
        <button
          v-else
          type="button"
          class="inline-flex h-12 items-center rounded-full bg-primary px-7 text-base font-semibold text-primary-text transition-opacity hover:opacity-90 sm:h-14 sm:px-9 sm:text-lg"
          @click="onPrimary"
        >
          {{ $t('landing.final.primary') }}
        </button>
      </div>
    </div>
  </section>
</template>

<script setup>
const localePath = useLocalePath()
const openLogin = inject('openLogin', () => {})
const { isLoggedIn } = useAuth()

function onPrimary() {
  openLogin()
}
</script>
