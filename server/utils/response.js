/* ===================================================================
 * 标准响应格式 - 供站内 API 与 MCP 转发共用
 * code: 200 成功 / 0 失败
 * =================================================================== */

export function reqSuccess(data = null, msg = 'success') {
  return { code: 200, msg, data }
}

export function reqFail(msg = 'error') {
  return { code: 0, msg }
}
