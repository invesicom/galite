/* ===================================================================
 * Nitro Plugin · API 错误消息消毒 (error hook in-place transform)
 *
 * 为什么用 hook 而不是 nitro.errorHandler config:
 *   nitro.errorHandler 是个"完全 override Nuxt 内置 errorHandler"的开关.
 *   Nuxt 3 在 Cloudflare module preset 下, error.vue (用户友好的 HTML
 *   错误页) 就是通过它自己的 nitro.errorHandler 渲染的. 我们若设自定义
 *   errorHandler 等于砸了 Nuxt 整个 error.vue 渲染链.
 *
 *   `error` hook 是"transform 通道", 跑在 Nuxt 内置 errorHandler 之前.
 *   在这里 in-place 改写 error.message → 后续 JSON renderer 拿到的就是
 *   sanitized error. /api/* 强制 JSON 由 server/middleware/00.api-json.js 负责.
 *
 * 行为:
 *   - /api/*  路径: 5xx → 'Internal Server Error'; 4xx → cleanMessage
 *   - 其他路径 (浏览器 page): 不动 — 用户友好的 statusMessage (e.g. 'Page not found')
 *     仍然原样进入 error.vue 渲染, UX 更好
 * =================================================================== */

import { safeErrorMessage } from '../utils/error-sanitize'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('error', (error, ctx) => {
    const event = ctx?.event
    const path = String(event?.path || '')
    if (!path.startsWith('/api/')) return /* 仅 /api/* 消毒 */

    const statusCode = Number(error?.statusCode) || 500
    /* 服务端完整日志 (出 worker 前唯一保留原始 message 的地方) */
    console.error(`[${statusCode}] ${path}:`, error?.message || error)

    /* in-place 改写 error.message + statusMessage → Nuxt renderer 拿到的就是 cleaned */
    const safe = safeErrorMessage(statusCode, error?.message || error?.statusMessage)
    try {
      error.message = safe
      if (error.statusMessage) error.statusMessage = safe
      error.stack = undefined
    } catch {
      /* 某些 error 对象 message 是 getter (createError 内部用 defineProperty)
         无法直接写, 此时只能依赖 Nuxt 默认 fallback 不输出原始 message */
    }
  })
})
