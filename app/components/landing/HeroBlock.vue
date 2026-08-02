<template>
  <!-- ============================================================
       HeroBlock — 居中叙事 + 大产品截图
       让首屏信息先收束到 CTA, 再把产品画面完整展开
       ============================================================ -->
  <section class="border-b border-gray-100 bg-white">
    <div class="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:py-28">
      <!-- ============ 文案 + CTA ============ -->
      <div class="mx-auto max-w-4xl text-center">
        <h1
          class="text-3xl font-semibold leading-[1.15] tracking-tight text-gray-900 sm:text-5xl lg:text-6xl"
        >
          {{ $t('landing.hero.title') }}
        </h1>
        <p class="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-gray-700 sm:mt-6 sm:text-xl">
          {{ $t('landing.hero.subtitle') }}
        </p>

        <!-- 已登录: 直接进控制台. 未登录: 唯一 CTA 弹登录 -->
        <div class="mt-8 flex justify-center sm:mt-10">
          <NuxtLink
            v-if="isLoggedIn"
            :to="localePath('/projects')"
            class="inline-flex h-12 items-center justify-center rounded-full bg-primary px-7 text-base font-semibold text-primary-text transition-opacity hover:opacity-90 sm:h-14 sm:px-9 sm:text-lg"
          >
            {{ $t('landing.hero.cta_dashboard') }}
          </NuxtLink>
          <button
            v-else
            type="button"
            class="inline-flex h-12 items-center justify-center rounded-full bg-primary px-7 text-base font-semibold text-primary-text transition-opacity hover:opacity-90 sm:h-14 sm:px-9 sm:text-lg"
            @click="openLogin"
          >
            {{ $t('landing.hero.cta_primary') }}
          </button>
        </div>
      </div>

      <!-- ============ 产品截图 (Dashboard 全貌) ============ -->
      <!-- 去 shadow-2xl + macOS 圆点装饰: 用 1px 边框 + URL bar 做轻量"窗口感",
           信息密度更低, 与全站克制风格一致 -->
      <div class="mx-auto mt-14 max-w-6xl sm:mt-16">
        <div class="overflow-hidden rounded-2xl border border-gray-200 bg-white sm:rounded-3xl">
          <div class="flex h-10 items-center justify-center border-b border-gray-200 bg-gray-50 px-4 sm:h-11 sm:px-5">
            <div class="inline-flex h-7 max-w-sm items-center gap-1.5 rounded-md bg-white px-3 text-sm text-gray-600 sm:max-w-md">
              <NuxtIcon name="ri:lock-line" class="size-3.5 shrink-0" />
              <span class="truncate">{{ browserDomain }}</span>
            </div>
          </div>
          <img
            src="/images/landing/hero.png"
            alt="Dashboard preview — every site in one screen"
            width="1440"
            height="804"
            class="block w-full"
            loading="eager"
            fetchpriority="high"
          />
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
const localePath = useLocalePath()
const openLogin = inject('openLogin', () => {})
const { isLoggedIn } = useAuth()
const { publicOrigin } = useSiteConfig()

const browserDomain = computed(() => {
  try {
    return new URL(publicOrigin.value).host
  } catch {
    return publicOrigin.value
  }
})
</script>
