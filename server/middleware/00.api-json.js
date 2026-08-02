/* ===================================================================
 * API Accept 归一
 *
 * 浏览器直接打开 /api/* 时会带 Accept:text/html; Nuxt 默认会尝试渲染
 * HTML 错误页。API 的契约是机器接口, 不存在 HTML 降级。
 * =================================================================== */

export default defineEventHandler((event) => {
  const path = event.path || ''
  if (!path.startsWith('/api/')) return

  const accept = String(getHeader(event, 'accept') || '').toLowerCase()
  if (accept.includes('text/html')) {
    event.node.req.headers.accept = 'application/json'
  }
})
