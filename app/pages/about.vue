<template>
  <!-- ============================================================
       /about — 单栏叙事 (痛点 → 我们做的 → outro)
       --
       重构要点:
         - 去掉 quote 灰色背景 section (避免视觉"卡片化"切换)
         - quote 用左边线 italic 内嵌在段落后, 跟随上下文叙事
         - eyebrow 改用 text-primary (强对比), 弃 uppercase tracking
         - 段落字号 base/lg 双档, 行高 1.75 提高长文易读性
       ============================================================ -->
  <div class="bg-white">
    <!-- ============ Hero ============ -->
    <section>
      <div class="mx-auto max-w-3xl px-4 pb-10 pt-16 text-center sm:px-6 sm:pb-14 sm:pt-28">
        <h1 class="text-3xl font-semibold leading-[1.15] tracking-tight text-gray-900 sm:text-5xl">
          {{ $t('about.hero.title') }}
        </h1>
        <p class="mx-auto mt-5 max-w-xl text-base leading-relaxed text-gray-700 sm:mt-6 sm:text-lg">
          {{ $t('about.hero.subtitle') }}
        </p>
      </div>
    </section>

    <!-- ============ 现状 (痛点) ============ -->
    <section class="border-t border-gray-100">
      <div class="mx-auto max-w-2xl px-4 py-14 sm:px-6 sm:py-20">
        <p class="mb-5 text-sm font-medium text-primary">
          {{ $t('about.section.status_quo') }}
        </p>
        <div class="space-y-5 text-base leading-[1.75] text-gray-700 sm:text-lg">
          <p>{{ $t('about.body.p1') }}</p>
          <p>{{ $t('about.body.p2') }}</p>
          <p>{{ $t('about.body.p3') }}</p>
        </div>

        <!-- quote 内嵌, 不另起 section. border-l 一根细线代替灰底 -->
        <blockquote class="mt-10 border-l-2 border-primary pl-5 text-lg italic leading-snug text-gray-900 sm:text-xl">
          “{{ $t('about.body.quote_1') }}”
        </blockquote>
      </div>
    </section>

    <!-- ============ 我们做的 ============ -->
    <section class="border-t border-gray-100">
      <div class="mx-auto max-w-2xl px-4 py-14 sm:px-6 sm:py-20">
        <p class="mb-5 text-sm font-medium text-primary">
          {{ $t('about.section.what_we_built') }}
        </p>
        <div class="space-y-5 text-base leading-[1.75] text-gray-700 sm:text-lg">
          <p>{{ $t('about.body.p4') }}</p>
          <p>{{ $t('about.body.p5') }}</p>
        </div>

        <blockquote class="mt-10 border-l-2 border-primary pl-5 text-lg italic leading-snug text-gray-900 sm:text-xl">
          “{{ $t('about.body.quote_2') }}”
        </blockquote>

        <p class="mt-8 text-base leading-relaxed text-gray-700 sm:text-lg">
          {{ $t('about.body.outro') }}
        </p>
      </div>
    </section>

    <LandingFinalCta />
  </div>
</template>

<script setup>
definePageMeta({ layout: 'landing' })

const { t } = useI18n()
const { getSiteName } = useSiteConfig()

useHead({
  title: () => `${t('landing.nav.about')} · ${getSiteName()}`,
  meta: [
    { name: 'description', content: t('about.meta.description') },
  ],
})
</script>
