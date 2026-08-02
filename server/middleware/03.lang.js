/* ===================================================================
 * 语言检测中间件
 * 优先级: URL 路径前缀 > ct_lang Cookie > Accept-Language > default_lang
 * =================================================================== */

const SUPPORTED_LOCALES = new Set([
  'en', 'zh-cn', 'zh-tw', 'ja', 'ko',
  'es', 'fr', 'de', 'pt-pt', 'ru',
  'ar', 'hi', 'tr', 'vi', 'th',
  'id', 'bn', 'fa', 'ur', 'pl',
  'nl', 'uk', 'it', 'cs', 'uz',
])

const BUILD_DEFAULT_LOCALE = process.env.DEFAULT_LOCALE || 'en'

export default defineEventHandler((event) => {
  const siteConfig = event.context.siteConfig
  const DEFAULT_LOCALE = String(siteConfig?.unchanged?.default_lang || '').toLowerCase() || BUILD_DEFAULT_LOCALE

  const path = event.path || ''

  const pathSegment = path.split('/')[1]?.toLowerCase() || ''
  if (pathSegment && SUPPORTED_LOCALES.has(pathSegment)) {
    event.context.lang = pathSegment
    return
  }

  const cookieLang = getCookie(event, 'ct_lang')
  if (cookieLang && SUPPORTED_LOCALES.has(cookieLang.toLowerCase())) {
    event.context.lang = cookieLang.toLowerCase()
    return
  }

  const acceptLang = getHeader(event, 'accept-language')
  if (acceptLang) {
    const detected = parseAcceptLanguage(acceptLang)
    if (detected) {
      event.context.lang = detected
      return
    }
  }

  event.context.lang = DEFAULT_LOCALE
})

function parseAcceptLanguage(header) {
  const entries = header
    .split(',')
    .map((part) => {
      const [lang, qPart] = part.trim().split(';')
      const q = qPart ? parseFloat(qPart.replace('q=', '')) : 1.0
      return { lang: lang.trim().toLowerCase(), q }
    })
    .sort((a, b) => b.q - a.q)

  for (const { lang } of entries) {
    if (SUPPORTED_LOCALES.has(lang)) return lang
    const normalized = lang.replace('_', '-')
    if (SUPPORTED_LOCALES.has(normalized)) return normalized
    const primary = lang.split('-')[0]
    if (SUPPORTED_LOCALES.has(primary)) return primary
  }

  return null
}
