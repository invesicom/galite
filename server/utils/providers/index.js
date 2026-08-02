/* ===================================================================
 * Provider Registry - 数据源服务接入点
 *
 *  调用方:
 *    providerOf('ga4').exchangeCode(...)   // 返回完整 helper, 已实现
 *    providerOf('gsc').listProperties(...)  // Google Search Console
 *    providerOf('bing').listProperties(...) // Bing Webmaster API Key
 *
 *  铁律:
 *    白名单进出, 未注册 provider -> 400
 * =================================================================== */

import * as ga4 from './ga4-oauth'
import * as gsc from './gsc'
import * as bing from './bing'

function registerProvider(name, adapter) {
  return Object.freeze({ ...adapter, name })
}

const REGISTRY = Object.freeze({
  ga4: registerProvider('ga4', ga4),
  gsc: registerProvider('gsc', gsc),
  bing: registerProvider('bing', bing),
})

export function providerOf(name) {
  const p = REGISTRY[name]
  if (!p) throw createError({ statusCode: 400, message: `unknown provider: ${name}` })
  return p
}

export const ENABLED_PROVIDERS = Object.keys(REGISTRY)
