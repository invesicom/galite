/* ========================================================================== *
 * locale-path — 路径里的 locale 首段剥离
 *
 * 背景:
 *   - Nuxt i18n strategy = 'prefix_except_default'
 *     · 默认 locale (en): /panorama       (无前缀)
 *     · 非默认 locale:    /zh-cn/panorama (带 locale 首段)
 *
 *   - 任务创建时 route.path 自带"当时 locale"前缀. 若把它原样存进
 *     input_data.source_page_path, 后面分享页跳回"创作同款"时, 接收方读到的
 *     永远是创作者当时的语言, 而不是接收者自己的语言 — 体验裂开.
 *
 *   - 归一化路径为"裸路径"存储, 让每个消费者再按自己 locale 上 localePath()
 *     拼前缀, 才是正确的分工边界.
 *
 * API 约定:
 *   stripLocalePrefix('/zh-cn/foo', ['en','zh-cn','ko'])  → '/foo'
 *   stripLocalePrefix('/foo',        ['en','zh-cn'])      → '/foo'   (未命中)
 *   stripLocalePrefix('/en',         ['en','zh-cn'])      → '/'      (仅 locale)
 *   stripLocalePrefix('',            [...])               → '/'      (兜底)
 * ========================================================================== */

export function stripLocalePrefix(path, localeList) {
  const p = String(path || '').trim()
  if (!p.startsWith('/')) return '/'
  const codes = Array.isArray(localeList)
    ? localeList
        .map((l) => (typeof l === 'string' ? l : l?.code))
        .filter(Boolean)
    : []
  if (codes.length === 0) return p
  const m = p.match(/^\/([^/?#]+)(.*)$/)
  if (m && codes.includes(m[1])) return m[2] || '/'
  return p
}
