/* ===================================================================
 * 认证守卫 - API handler 级别的权限校验
 * - 中间件只解析 token, 不拦截
 * - 需要认证的 handler 调用 requireAuth() 主动检查
 * =================================================================== */

export function requireAuth(event) {
  if (!event.context.user) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      message: 'Authentication required',
    })
  }
  return event.context.user
}
