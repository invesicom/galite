/* ===================================================================
 * 错误消息消毒
 *
 * 用于在错误响应出 worker 之前, 把可能含敏感信息的 message 替换成
 * 通用文案. 保留业务语义 (比如 "invalid_period"), 滤掉技术细节.
 *
 * 调用者: server/plugins/clean-api-errors.js (nitro `error` hook)
 *         在 Nuxt 内置 errorHandler 渲染前对 /api/* 错误 in-place 改写
 *
 * 5xx: 一律返 'Internal Server Error' (生产环境绝不暴露任何细节)
 * 4xx: cleanMessage 过 toxic regex, 命中则降级 'Bad Request'
 * =================================================================== */

const TOXIC_PATTERNS = [
  /failed query/i,
  /insert into/i,
  /select\s.+\sfrom/i,
  /update\s.+\sset/i,
  /delete\sfrom/i,
  /params:/i,
  /node_modules/i,
  /\/Users\//i,
  /\/home\//i,
  /\.js:\d+/i,
  /at\s\w+\s\(/i,
  /ECONNREFUSED/i,
  /drizzle/i,
]

export function cleanMessage(msg) {
  if (!msg || typeof msg !== 'string') return 'Bad Request'
  for (const re of TOXIC_PATTERNS) {
    if (re.test(msg)) return 'Bad Request'
  }
  return msg.length > 300 ? msg.slice(0, 300) : msg
}

/* ---- 按状态码挑选要返给客户端的安全 message ---- */
export function safeErrorMessage(statusCode, rawMessage) {
  if (statusCode >= 500) return 'Internal Server Error'
  return cleanMessage(rawMessage || 'Bad Request')
}
