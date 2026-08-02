<template>
  <!-- ============================================================
       Nuxt 错误页 (root-level, 不走 pages/* 路由系统)
       --
       职责: 当路由匹配失败 / 任意页面抛 createError 时, Nuxt 渲染此页.
             默认行为是返一段 JSON, 用户看到的是裸机器消息, 体验断裂.
             这里套 landing layout (有 header + footer) 让 404 / 500
             跟站点视觉一致, 错误也是产品体验的一部分.
       --
       状态码: 由 error.statusCode 决定 (4xx / 5xx), Nuxt 自动写到 HTTP 响应.
       --
       注意: error.vue 是 root, 不在 NuxtLayout 链路里, 必须手动套 layout.
       ============================================================ -->
  <NuxtLayout name="landing">
    <div class="mx-auto flex w-full max-w-2xl flex-col items-center px-6 py-24 text-center sm:py-32">
      <!-- 大号状态码 - 视觉锚点 -->
      <div class="text-7xl font-bold tracking-tight text-gray-900 sm:text-8xl">
        {{ error?.statusCode || 404 }}
      </div>

      <h1 class="mt-6 text-2xl font-bold text-gray-900 sm:text-3xl">
        {{ title }}
      </h1>
      <p class="mt-3 max-w-md text-base text-gray-500">
        {{ desc }}
      </p>

      <button
        type="button"
        class="mt-8 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-text transition-opacity hover:opacity-90"
        @click="onHome"
      >
        <NuxtIcon name="ri:arrow-left-line" class="size-4" />
        {{ backLabel }}
      </button>
    </div>
  </NuxtLayout>
</template>

<script setup>
/* Nuxt 把错误对象作 prop 注入: { statusCode, statusMessage, message, ... } */
const props = defineProps({
  error: { type: Object, default: () => ({}) },
})

const { t, te, locale, setLocale } = useI18n()
const localePath = useLocalePath()
const requestURL = useRequestURL()
const nuxtApp = useNuxtApp()
const requestEvent = import.meta.server ? useRequestEvent() : null
const errorMessages = Object.fromEntries(
  Object.entries(import.meta.glob('../i18n/locales/*.json', { eager: true, import: 'default' }))
    .map(([path, messages]) => [path.split('/').pop().replace('.json', ''), messages]),
)

function detectRouteLocale() {
  let dataPath = ''
  try {
    const data = typeof props.error?.data === 'string' ? JSON.parse(props.error.data) : props.error?.data
    dataPath = data?.path || ''
  } catch {
    dataPath = ''
  }
  const errorPath = String(props.error?.statusMessage || props.error?.message || '').match(/\/[^\s?#]*/)?.[0]
  const raw = String(
    dataPath
    || requestEvent?.path
    || requestEvent?.node?.req?.url
    || nuxtApp.ssrContext?.url
    || nuxtApp.payload?.path
    || errorPath
    || props.error?.url
    || requestURL.pathname
    || '',
  )
  const pathname = new URL(raw, requestURL.origin).pathname
  const first = pathname.split('/').filter(Boolean)[0]?.toLowerCase()
  return first && errorMessages[first] ? first : ''
}

const initialRouteLocale = detectRouteLocale()
if (initialRouteLocale && locale.value !== initialRouteLocale) {
  await setLocale(initialRouteLocale)
}

/* ---- 文案: i18n 优先, 缺 key 用静态 fallback (错误页要绝对鲁棒) ----
   te(key) 检测翻译是否存在; 不存在时走兜底, 避免显示 raw key 像 "error.404.title" */
const is404 = computed(() => Number(props.error?.statusCode) === 404)
const routeLocale = computed(detectRouteLocale)

watchEffect(() => {
  if (routeLocale.value && locale.value !== routeLocale.value) {
    locale.value = routeLocale.value
  }
})

function readMessage(localeCode, key) {
  const message = errorMessages[localeCode]?.[key]
  if (typeof message === 'string') return message

  /* i18n 生产构建会把 JSON 文案编译成 AST; 错误页只读纯文本节点 */
  const tokens = message?.b?.i
  if (!Array.isArray(tokens)) return ''

  return tokens
    .map((token) => token.s || token.v || '')
    .join('')
}

function tr(key, fallback) {
  const targetLocale = routeLocale.value || locale.value
  const message = readMessage(targetLocale, key) || readMessage(locale.value, key)
  if (message) return message

  return te(key) ? t(key) : fallback
}

const title = computed(() => {
  if (is404.value) return tr('error.404.title', 'Page not found')
  return tr('error.generic.title', props.error?.statusMessage || 'Something went wrong')
})
const desc = computed(() => {
  if (is404.value) return tr(
    'error.404.desc',
    "The page you're looking for doesn't exist or has been moved.",
  )
  return tr('error.generic.desc', props.error?.message || 'An unexpected error occurred. Please try again.')
})
const backLabel = computed(() => tr('error.back_home', 'Back to home'))

/* clearError + redirect: 清错误态再跳, 避免 navigateTo 后页面仍是 error 状态 */
function onHome() {
  clearError({ redirect: localePath('/') })
}
</script>
