<template>
  <!-- ============================================================
       Index Page — Landing
       接入 -> 看数 -> 实时 -> 分享 -> 漏斗 -> AI
       ============================================================ -->
  <div class="bg-white">
    <LandingHeroBlock />
    <LandingDataSourcesStrip />
    <LandingFeaturesBlock />
    <LandingShowcaseBlock kind="connect" media-side="right" />
    <LandingShowcaseBlock kind="unified" media-side="left" />
    <LandingShowcaseBlock kind="realtime" media-side="right" />
    <LandingShowcaseBlock kind="sharing" media-side="left" />
    <LandingShowcaseBlock kind="funnels" media-side="right" />
    <LandingIntegrationsBlock />

    <LandingFaqBlock />
    <LandingFinalCta />
  </div>
</template>

<script setup>
definePageMeta({ layout: 'landing' })

const { t } = useI18n()
const { current } = useSiteConfig()

/* ===========================================================
   首页 SEO
     - title / description 优先取实例 og_config
     - 开源默认值来自 i18n landing.meta.*, 与在线版逐语言保持一致
     - OG/Twitter 卡片由 app.vue 统一注入同款文案与产品封面
   =========================================================== */
const og = computed(() => current.value?.og_config || {})

useSeoMeta({
  title: () => og.value.title || t('landing.meta.title'),
  description: () => og.value.description || t('landing.meta.description'),
})
</script>
