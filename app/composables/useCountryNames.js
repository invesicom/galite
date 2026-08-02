/* ===========================================================
   useCountryNames - 按当前 locale 加载国家名映射
   --
   素材: /public/country/{bcp47}.json  (来自 ga-lite, 50+ locales)
   缓存: 模块级 Map (per locale 一次, useState 共享 SSR)
   降级: 当前 locale -> en-US -> 原始 ISO code
   --
   GA Lite i18n locale (小写) -> BCP47 文件名映射:
     en       -> en-US
     zh-cn    -> zh-CN
     zh-tw    -> zh-TW
     ja       -> ja-JP
     ko       -> ko-KR
     de       -> de-DE
     ...
   =========================================================== */

const LOCALE_TO_BCP47 = {
  en:      'en-US',
  'zh-cn': 'zh-CN',
  'zh-tw': 'zh-TW',
  ja:      'ja-JP',
  ko:      'ko-KR',
  de:      'de-DE',
  es:      'es-ES',
  fr:      'fr-FR',
  ru:      'ru-RU',
  it:      'it-IT',
  ar:      'ar-SA',
  'pt-pt': 'pt-PT',
  nl:      'nl-NL',
  cs:      'cs-CZ',
  uk:      'uk-UA',
  hi:      'hi-IN',
  tr:      'tr-TR',
  fa:      'fa-IR',
  id:      'id-ID',
  th:      'th-TH',
  bn:      'bn-BD',
  ur:      'ur-PK',
  vi:      'vi-VN',
  pl:      'pl-PL',
}

/* ---- 模块级缓存: 同一 locale 只 fetch 一次 ---- */
const cache = new Map() /* bcp47 -> Promise<{[code]: name}> */

async function loadLocale(bcp47) {
  if (cache.has(bcp47)) return cache.get(bcp47)
  const p = $fetch(`/country/${bcp47}.json`).catch(() => ({}))
  cache.set(bcp47, p)
  return p
}

export function useCountryNames() {
  const { locale } = useI18n()

  /* ---- 共享 state: 当前 locale 的国家名表 (SSR 友好) ---- */
  const names = useState('country-names', () => ({}))

  async function ensureLoaded() {
    const code = String(locale.value || 'en').toLowerCase()
    const bcp47 = LOCALE_TO_BCP47[code] || 'en-US'
    const map = await loadLocale(bcp47)
    /* fallback: 当前 locale 缺时合并 en-US */
    if (bcp47 !== 'en-US' && Object.keys(map).length === 0) {
      const en = await loadLocale('en-US')
      names.value = en
    } else {
      names.value = map
    }
  }

  /* ---- 同步取名: 表里有就返本地, 没有 fallback 到原 code ---- */
  function nameOf(code) {
    if (!code) return ''
    const upper = String(code).toUpperCase()
    return names.value[upper] || upper
  }

  return { ensureLoaded, nameOf }
}
