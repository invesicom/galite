<template>
  <div :class="floating ? 'pointer-events-none fixed inset-x-0 top-4 z-[60]' : 'mb-2 flex justify-end'">
    <div :class="floating ? 'mx-auto flex max-w-6xl justify-end gap-2 px-4 sm:px-6' : 'flex justify-end gap-2'">
      <button
        type="button"
        class="pointer-events-auto inline-flex size-9 items-center justify-center rounded-full border border-gray-200 bg-white/95 text-gray-600 backdrop-blur hover:bg-white hover:text-gray-900"
        :aria-label="t('lang.switch_language')"
        v-tooltip.bottom="t('lang.switch_language')"
        @click="openLanguage"
      >
        <NuxtIcon name="ri:translate-2" class="size-4" />
      </button>
      <button
        type="button"
        class="pointer-events-auto inline-flex size-9 items-center justify-center rounded-full border border-gray-200 bg-white/95 text-gray-600 backdrop-blur hover:bg-white hover:text-gray-900"
        :aria-label="t('common.share')"
        v-tooltip.bottom="t('common.share')"
        @click="openShare"
      >
        <NuxtIcon name="ri:share-forward-line" class="size-4" />
      </button>
    </div>
  </div>

  <LanguageModal
    :visible="languageOpen"
    :show-branding="showBranding"
    @close="languageOpen = false"
  />
  <ShareModal
    :visible="shareOpen"
    :share-url="shareUrl"
    :share-title="shareTitle"
    :show-branding="showBranding"
    @close="shareOpen = false"
  />
</template>

<script setup>
import LanguageModal from '~/components/layout/LanguageModal.vue'
import ShareModal from '~/components/layout/ShareModal.vue'

const props = defineProps({
  title: { type: String, default: '' },
  floating: { type: Boolean, default: true },
  showBranding: { type: Boolean, default: true },
})

const { t, locale } = useI18n()
const route = useRoute()
const configStore = useConfigStore()
const { publicOrigin } = useSiteConfig()
const languageOpen = ref(false)
const shareOpen = ref(false)

const resolvedConfig = computed(() => configStore.getTranslated(locale.value))
const siteName = computed(() => String(resolvedConfig.value.site_name || configStore.siteName || 'GA Lite'))
const shareUrl = computed(() => `${publicOrigin.value}${route.path || '/'}`)
const shareTitle = computed(() => props.title || siteName.value)

function openLanguage() {
  languageOpen.value = true
}

function openShare() {
  shareOpen.value = true
}
</script>
