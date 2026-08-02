<script setup>
/* ===========================================================
   LanguageModal - 语言选择弹窗
   职责: 展示可用语言列表，点击切换站点语言
   设计: 全屏遮罩 + 居中面板，ESC / × / 点击背景关闭
   =========================================================== */

const props = defineProps({
  visible: { type: Boolean, default: false },
  showBranding: { type: Boolean, default: true },
})

const emit = defineEmits(['close'])

const { t, locale, setLocale } = useI18n()
const switchLocalePath = useSwitchLocalePath()
const { getSupportedLocales } = useSiteConfig()

/* ---- 可用语言列表 ---- */
const langList = computed(() => getSupportedLocales())

/* ---- 站点徽标 (品牌曝光, 与 LoginModal 语义一致) ---- */
const configStore = useConfigStore()
const resolvedConfig = computed(() => configStore.getTranslated(locale.value))
const siteName = computed(() => String(resolvedConfig.value.site_name || configStore.siteName || 'AI Studio'))
const logo = computed(() => resolvedConfig.value.logo || {})

/* ---- 切换语言 ---- */
function switchLang(code) {
  if (code === locale.value) { emit('close'); return }
  /* ---- 语言切换统一整页跳转:
   *   站点内容不只来自 i18n 文案, 还来自 SSR 数据、后台翻译配置与页面区块配置.
   *   全页请求让 locale 成为单一入口, 避免 SPA 局部 patch 后内容半新半旧. ---- */
  const target = switchLocalePath(code)
  if (import.meta.client && target) {
    window.location.assign(target)
    return
  }
  setLocale(code)
  emit('close')
}

/* ---- ESC 关闭 ---- */
function onKeydown(e) { if (e.key === 'Escape') emit('close') }

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="visible"
        class="fixed inset-0 z-[80] flex items-center justify-center bg-black/20 p-4 backdrop-blur-[3px]"
        @click.self="emit('close')"
      >
        <div class="relative flex max-h-[70vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">

          <!-- 头部 -->
          <div class="flex items-center justify-between border-b border-gray-100 px-6 py-4">
            <h2 class="text-lg font-bold text-gray-900">{{ t('lang.switch_language') }}</h2>
            <button
              class="flex size-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              @click="emit('close')"
            >
              <svg class="size-5" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
              </svg>
            </button>
          </div>

          <!-- 语言网格 (flex-1 吃掉剩余高度, 内部滚动, 让底部徽标栏常驻) -->
          <div class="grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-y-auto p-4 sm:grid-cols-3 md:grid-cols-4 sm:gap-3 sm:p-6">
            <button
              v-for="loc in langList"
              :key="loc.code"
              class="rounded-xl border px-3 py-3 text-center text-sm transition-all duration-150"
              :class="loc.code === locale
                ? 'border-primary bg-primary/10 font-semibold text-primary'
                : 'border-gray-200 text-gray-700 hover:border-primary/30 hover:bg-gray-50'"
              @click="switchLang(loc.code)"
            >
              {{ loc.name }}
            </button>
          </div>

          <!-- 站点徽标 (品牌曝光: logo + 名字, 与 LoginModal 一致) -->
          <div
            v-if="props.showBranding && (logo.logo_64 || siteName)"
            class="flex items-center justify-center gap-2 border-t border-gray-100 px-6 py-4"
          >
            <img v-if="logo.logo_64" :src="logo.logo_64" class="size-6 rounded-md" :alt="siteName" />
            <div class="text-base font-bold text-gray-900">{{ siteName }}</div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
