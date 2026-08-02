<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>

<script setup>
/* ===========================================================
   GA Lite - 根组件
   职责: 主题色注入 + 全局 SEO 默认值 + SSR 注水 (siteConfig / user)
   =========================================================== */

const { locale, localeProperties, t } = useI18n()
const configStore = useConfigStore()
const userStore = useUserStore()
const { applyTheme, buildThemeStyle } = useTheme()
const { publicOrigin } = useSiteConfig()
const { productLinks } = useAppConfig()
const route = useRoute()

const HOSTED_CANONICAL_PATHS = new Set(['/', '/about', '/api-docs'])

/* ---- SSR 注水: 站点配置 + 用户登录态 ---- */
const siteBootstrap = useState('site-config-bootstrap', () => {
  const event = import.meta.server ? useRequestEvent() : null
  return normalizeSiteBootstrap(event?.context?.siteConfigPublic, event?.context?.siteId)
})

const userBootstrap = useState('user-bootstrap', () => {
  if (!import.meta.server) return null
  const event = useRequestEvent()
  return event?.context?.user || null
})

if (userBootstrap.value && !userStore.isLoggedIn) {
  userStore.setUser(userBootstrap.value)
}

onMounted(async () => {
  if (!userStore.isLoggedIn) await userStore.fetchUser()
})

configStore.setConfig(siteBootstrap.value)

const resolvedConfig = computed(() => configStore.getTranslated(locale.value))
const siteName = computed(() => String(resolvedConfig.value.site_name || configStore.siteName || 'GA Lite'))
const siteDescription = computed(() => String(resolvedConfig.value.site_description || ''))
const logo = computed(() => resolvedConfig.value.logo || {})
const themeColors = computed(() => resolvedConfig.value.theme_colors || {})

/* ---- 站长验证 Meta: 配置只描述 meta, 不能借此注入任意 HTML ---- */
const META_TAG_PATTERN = /<meta\b([^>]*)>/gi
const META_ATTRIBUTE_PATTERN = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g
const META_ATTRIBUTE_NAMES = new Set(['name', 'content', 'property', 'http-equiv'])

function parseMetaTag(source, key) {
  const meta = { key }
  for (const match of String(source).matchAll(META_ATTRIBUTE_PATTERN)) {
    const name = match[1].toLowerCase()
    if (META_ATTRIBUTE_NAMES.has(name)) meta[name] = match[2] ?? match[3] ?? match[4] ?? ''
  }
  return meta.content && (meta.name || meta.property || meta['http-equiv']) ? meta : null
}

function parseMetaConfig(items) {
  return (Array.isArray(items) ? items : []).flatMap((item, itemIndex) => {
    if (item?.enabled === false) return []
    return [...String(item?.code || '').matchAll(META_TAG_PATTERN)]
      .map((match, tagIndex) => parseMetaTag(match[1], `site-meta-${itemIndex}-${tagIndex}`))
      .filter(Boolean)
  })
}

const homepageMetaTags = computed(() =>
  route.path === '/' ? parseMetaConfig(configStore.unchanged?.meta_config) : [],
)

/* ---- 默认 OG 卡片: 固定产品封面 + 当前语言的主站同款文案 ---- */
const defaultOgConfig = computed(() => {
  const raw = resolvedConfig.value.og_config
  return raw && typeof raw === 'object' ? raw : {}
})
const defaultOgTitle = computed(() =>
  defaultOgConfig.value.title || t('landing.meta.title') || siteName.value,
)
const defaultOgDescription = computed(() =>
  defaultOgConfig.value.description || t('landing.meta.description') || siteDescription.value,
)

watchEffect(() => {
  applyTheme(themeColors.value)
})

const themeStyleTag = computed(() => buildThemeStyle(themeColors.value))

/* ---- SEO 路径: 固定营销内容归一到在线版，实例独有内容留在当前域名 ---- */
function stripLocalePrefix(path, supportedLangs, defaultLang) {
  const localePrefix = supportedLangs.find(lang =>
    lang !== defaultLang && (path === `/${lang}` || path.startsWith(`/${lang}/`)),
  )
  return localePrefix ? path.slice(localePrefix.length + 1) || '/' : path
}

function getOrigin(value, fallback) {
  try {
    return new URL(String(value || '')).origin
  } catch {
    return fallback
  }
}

function localizeSeoPath(path, lang, defaultLang) {
  if (lang === defaultLang) return path
  return path === '/' ? `/${lang}/` : `/${lang}${path}`
}

const localeFreePath = computed(() => {
  const cfg = resolvedConfig.value
  const supportedLangs = cfg.supported_langs || []
  const defaultLang = cfg.default_lang || 'en'
  return stripLocalePrefix(route.path, supportedLangs, defaultLang)
})

const usesHostedCanonical = computed(() => HOSTED_CANONICAL_PATHS.has(localeFreePath.value))
const canonicalOrigin = computed(() => usesHostedCanonical.value
  ? getOrigin(productLinks.hosted, publicOrigin.value)
  : publicOrigin.value,
)

const canonicalUrl = computed(() => {
  const path = usesHostedCanonical.value
    ? localizeSeoPath(localeFreePath.value, locale.value || 'en', 'en')
    : route.path
  return `${canonicalOrigin.value}${path}`
})

/* ---- 多语言 hreflang ---- */
const hreflangs = computed(() => {
  const cfg = resolvedConfig.value
  const supportedLangs = cfg.supported_langs || []
  const defaultLang = cfg.default_lang || 'en'
  if (!supportedLangs.length) return []

  const origin = canonicalOrigin.value
  const canonical = localeFreePath.value
  const canonicalDefaultLang = usesHostedCanonical.value ? 'en' : defaultLang

  const links = []
  for (const lang of supportedLangs) {
    if (lang === canonicalDefaultLang) continue
    const href = `${origin}${localizeSeoPath(canonical, lang, canonicalDefaultLang)}`
    links.push({ rel: 'alternate', hreflang: lang, href })
  }
  const defaultHref = `${origin}${localizeSeoPath(canonical, canonicalDefaultLang, canonicalDefaultLang)}`
  links.push({ rel: 'alternate', hreflang: canonicalDefaultLang, href: defaultHref })
  links.push({ rel: 'alternate', hreflang: 'x-default', href: defaultHref })
  return links
})

useHead(() => ({
  htmlAttrs: {
    lang: locale.value || 'en',
    dir: localeProperties.value.dir || 'ltr',
  },
  titleTemplate: (title) => {
    const brand = siteName.value
    if (!title) return brand
    return brand && !String(title).includes(brand) ? `${title} - ${brand}` : title
  },
  link: [
    { rel: 'canonical', href: canonicalUrl.value },
    ...hreflangs.value,
    ...(logo.value.logo_32 ? [{ rel: 'icon', type: 'image/png', href: logo.value.logo_32, sizes: '32x32' }] : []),
    ...(logo.value.logo_64 ? [{ rel: 'icon', type: 'image/png', href: logo.value.logo_64, sizes: '64x64' }] : []),
    ...(logo.value.logo_192 ? [{ rel: 'apple-touch-icon', href: logo.value.logo_192, sizes: '192x192' }] : []),
  ],
  style: themeStyleTag.value ? [{ children: themeStyleTag.value }] : [],
  meta: [
    ...(themeColors.value.primary ? [{ name: 'theme-color', content: themeColors.value.primary }] : []),
    ...homepageMetaTags.value,
  ],
}))

/* ---- og:url 绝对地址: 规范 origin + path (不含 query 参数);
        随路由响应式更新, 各语种页面回链各自地址 ---- */
/* ===========================================================
   全局 SEO / OG meta
     - title / description: og_config 优先, 退回当前语言的产品 SEO 文案
     - url: 当前页绝对地址, 社媒分享卡片回链用
     - image: 单实例配置固定为在线版同款产品封面
   =========================================================== */
useSeoMeta({
  applicationName: () => siteName.value,
  appleMobileWebAppTitle: () => siteName.value,
  description: () => defaultOgDescription.value || undefined,
  ogTitle: () => defaultOgTitle.value || undefined,
  ogDescription: () => defaultOgDescription.value || undefined,
  ogImage: () => defaultOgConfig.value.image || undefined,
  ogSiteName: () => siteName.value,
  ogUrl: () => canonicalUrl.value,
  ogType: 'website',
  twitterCard: 'summary_large_image',
  twitterTitle: () => defaultOgTitle.value || undefined,
  twitterDescription: () => defaultOgDescription.value || undefined,
  twitterImage: () => defaultOgConfig.value.image || undefined,
})

function normalizeSiteBootstrap(rawConfig, siteId) {
  const source = isPlainObject(rawConfig) ? rawConfig : {}
  const unchanged = isPlainObject(source.unchanged) ? source.unchanged : source
  const translated = isPlainObject(source.translated) ? source.translated : {}

  return {
    siteId: String(siteId || ''),
    siteName: String(unchanged.site_name || 'GA Lite'),
    unchanged,
    translated,
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
</script>
