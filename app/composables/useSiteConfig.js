/* ===========================================================
   useSiteConfig - 站点配置访问层
   职责: 封装 configStore，提供带 locale 的配置读取
   设计: unchanged 是骨架，translated 是皮肤
   核心: getTranslated 按 key 级别精准读取
   =========================================================== */

export function useSiteConfig() {

  const configStore = useConfigStore()
  const { locale: currentLocale } = useI18n()
  const requestURL = useRequestURL()

  /* ===========================================================
     Computed - 直通 store 引用
     =========================================================== */

  const unchanged = computed(() => configStore.unchanged)
  const translated = computed(() => configStore.translated)
  const loaded = computed(() => configStore.loaded)
  const current = computed(() => configStore.getTranslated(currentLocale.value))
  const publicOrigin = computed(() => {
    const configured = String(configStore.unchanged?.site_url || '').trim()
    if (!configured) return requestURL.origin

    try {
      const url = new URL(configured)
      return ['http:', 'https:'].includes(url.protocol) ? url.origin : requestURL.origin
    } catch {
      return requestURL.origin
    }
  })

  /* ===========================================================
     getTranslated - 按 key 读取翻译配置
     优先级: translated[locale][key] → unchanged[key] → null
     参数: key 配置键名, locale 可选语言覆盖
     =========================================================== */

  function getTranslated(key, locale) {
    const lang = locale || currentLocale.value
    const merged = configStore.getTranslated(lang)
    return merged?.[key] ?? null
  }

  function getSiteName(locale) {
    return String(getTranslated('site_name', locale) || configStore.siteName || 'AI Studio')
  }

  /* ===========================================================
     getSupportedLocales - 后台配置的可用语言列表
     优先级: unchanged.supported_langs → 全量 i18n locales
     设计: 后台控制展示哪些语言，i18n 提供显示名称
     =========================================================== */

  const { locales: i18nLocales } = useI18n()

  function getSupportedLocales() {
    const backendLangs = configStore.unchanged?.supported_langs
    const allLocales = i18nLocales.value || []
    const current = currentLocale.value

    /* ---- 后台未配置: 返回全量 ---- */
    if (!Array.isArray(backendLangs) || backendLangs.length === 0) {
      return allLocales
    }

    /* ---- 后台已配置: 默认语言 + supported_langs，去重 ---- */
    const defaultLang = configStore.unchanged?.default_lang || 'en'
    const localeMap = new Map(allLocales.map(l => [l.code, l]))

    const seen = new Set()
    const result = []

    for (const code of [defaultLang, ...backendLangs]) {
      if (!code || seen.has(code)) continue
      seen.add(code)
      const loc = localeMap.get(code)
      if (loc) result.push(loc)
    }

    return result
  }

  return {
    unchanged,
    translated,
    current,
    publicOrigin,
    getTranslated,
    getSiteName,
    getSupportedLocales,
    loaded,
  }
}
