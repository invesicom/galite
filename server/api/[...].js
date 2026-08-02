/* ===================================================================
 * API 404 catch-all
 *
 * /api/* 是机器接口契约, 未命中也必须返回 JSON。否则前台 catch-all
 * 页面会把浏览器直开的未知 API 渲染成 HTML 404。
 * =================================================================== */

export default defineEventHandler((event) => {
  const url = getRequestURL(event)

  setResponseStatus(event, 404)
  return {
    error: true,
    url: url.href,
    statusCode: 404,
    statusMessage: 'Not Found',
    message: `API route not found: ${event.path}`,
  }
})
