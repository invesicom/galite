<template>
  <!-- ============================================================
       ShowcaseBlock — 通用图文对照
       --
       kind 决定文案与截图; 未映射素材时自然落到骨架态
       ============================================================ -->
  <section class="border-t border-gray-100 bg-white">
    <div class="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24 lg:py-28">
      <div class="grid grid-cols-1 items-center gap-10 sm:gap-12 lg:grid-cols-2 lg:gap-20">
        <!-- 文字侧 -->
        <div :class="['order-2', mediaSide === 'left' ? 'lg:order-2' : 'lg:order-1']">
          <h2 class="text-3xl font-semibold tracking-tight text-gray-900 sm:text-4xl lg:text-5xl">
            {{ $t(`landing.showcase.${kind}.title`) }}
          </h2>
          <p class="mt-5 text-base leading-relaxed text-gray-700 sm:mt-6 sm:text-lg">
            {{ $t(`landing.showcase.${kind}.desc`) }}
          </p>
          <ul class="mt-6 space-y-3 sm:mt-8 sm:space-y-4">
            <li
              v-for="i in 3"
              :key="i"
              class="flex items-start gap-3 text-sm text-gray-700 sm:text-base"
            >
              <NuxtIcon name="ri:check-line" class="mt-0.5 size-5 shrink-0 text-primary" />
              <span>{{ $t(`landing.showcase.${kind}.bullets.${i - 1}`) }}</span>
            </li>
          </ul>
        </div>

        <!-- 媒体侧: 截图优先, 骨架兜底 -->
        <div :class="['order-1', mediaSide === 'left' ? 'lg:order-1' : 'lg:order-2']">
          <img
            v-if="mediaSrc"
            :src="mediaSrc"
            :alt="$t(`landing.showcase.${kind}.title`)"
            width="1216"
            height="804"
            class="w-full rounded-2xl border border-gray-200"
            loading="lazy"
          />
          <div
            v-else
            class="relative aspect-[1216/804] overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 p-5 sm:p-6"
            role="img"
            :aria-label="$t(`landing.showcase.${kind}.title`)"
          >
            <div class="h-full animate-pulse rounded-xl border border-gray-200 bg-white/70 p-4 sm:p-5">
              <div class="flex items-center justify-between gap-4">
                <div class="h-4 w-1/3 rounded bg-gray-200" />
                <div class="h-3 w-20 rounded bg-gray-200" />
              </div>

              <div class="mt-6 grid grid-cols-3 gap-3 sm:gap-4">
                <div v-for="i in 3" :key="i" class="rounded-lg border border-gray-200 bg-white p-3">
                  <div class="h-3 w-2/3 rounded bg-gray-200" />
                  <div class="mt-4 h-6 w-1/2 rounded bg-gray-200" />
                </div>
              </div>

              <div class="mt-5 grid h-[58%] grid-cols-5 gap-3 sm:mt-6 sm:gap-4">
                <div class="col-span-3 rounded-xl bg-gray-200" />
                <div class="col-span-2 space-y-3">
                  <div class="h-[46%] rounded-xl bg-gray-200" />
                  <div class="h-[46%] rounded-xl bg-gray-200" />
                </div>
              </div>
            </div>

            <div class="absolute inset-0 flex items-center justify-center">
              <span class="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-500">
                {{ $t('landing.showcase.placeholder') }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
const props = defineProps({
  kind: { type: String, required: true },
  mediaSide: { type: String, default: 'right' },
})

/* kind -> 截图路径映射; 未命中时走骨架兜底 */
const MEDIA_MAP = {
  connect:  '/images/landing/connect.png',
  unified:  '/images/landing/unified.png',
  realtime: '/images/landing/realtime.png',
  sharing:  '/images/landing/sharing.png',
  funnels:  '/images/landing/funnels.png',
}

const mediaSrc = computed(() => MEDIA_MAP[props.kind] || '')
</script>
