/* ===================================================================
 * D1 数据库入口
 *
 * Nitro internal $fetch 不传播 Cloudflare platform context，MCP 复合工具仍需
 * AsyncLocalStorage 显式携带 env 与已认证 owner。数据库只接受 DB binding。
 * =================================================================== */

import { AsyncLocalStorage } from 'node:async_hooks'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../database/schema'

const ambientEnvStorage = new AsyncLocalStorage()
const ambientUserStorage = new AsyncLocalStorage()

export function runWithAmbientEnv(env, fn) {
  return env ? ambientEnvStorage.run(env, fn) : fn()
}

export function getAmbientEnv() {
  return ambientEnvStorage.getStore()
}

export function runWithAmbientUser(user, fn) {
  return user ? ambientUserStorage.run(user, fn) : fn()
}

export function getAmbientUser() {
  return ambientUserStorage.getStore()
}

export function createDbFromEnv(env) {
  if (!env?.DB) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Database binding missing',
      message: 'd1_binding_missing',
    })
  }
  return drizzle(env.DB, { schema })
}

export function useDb(event) {
  const env = event?.context?.cloudflare?.env || ambientEnvStorage.getStore()
  return createDbFromEnv(env)
}

export async function getFirst(queryPromise) {
  const results = await queryPromise
  return results.length > 0 ? results[0] : null
}

/* D1 单条 SQL 最多 100 个绑定参数。统一留出固定 WHERE 条件的余量，
 * 让任意数量的 Google 账号 / 站点都不会把 inArray 推过平台上限。 */
export async function selectInBatches(values, selectChunk, batchSize = 80) {
  const uniqueValues = [...new Set((Array.isArray(values) ? values : []).filter((value) => value !== undefined && value !== null))]
  const rows = []
  for (let offset = 0; offset < uniqueValues.length; offset += batchSize) {
    rows.push(...await selectChunk(uniqueValues.slice(offset, offset + batchSize)))
  }
  return rows
}

export async function runInBatches(values, runChunk, batchSize = 80) {
  const uniqueValues = [...new Set((Array.isArray(values) ? values : []).filter((value) => value !== undefined && value !== null))]
  for (let offset = 0; offset < uniqueValues.length; offset += batchSize) {
    await runChunk(uniqueValues.slice(offset, offset + batchSize))
  }
}
