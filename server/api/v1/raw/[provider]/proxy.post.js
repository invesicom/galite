/* ===================================================================
 * v1 · Provider Raw Proxy (开放 API · 高级用例)
 *
 * POST /api/v1/raw/[provider]/proxy
 *   body: { endpoint, method?, body?, auth_id? }
 *      or { endpoint, method?, body?, project_key, resource_id? }
 *
 * 设计意图:
 *   把 provider 原生 API 透明转发给已授权 sk- key 的持有者, 让 AI / Skill /
 *   MCP 可以执行 GA4 任意 runReport 组合, 而无需在我们这层提前枚举所有维度.
 *
 * 安全 (CRITICAL):
 *   - provider/path 白名单严格匹配查询类端点
 *   - endpoint 必须是 path (不允许传完整 URL), 我们手动拼前缀
 *   - auth_id 或 project_key/resource_id 必须属于当前 user
 *   - access_token 服务端解密后注入 Authorization, 不回明文给客户端
 *   - 失败 401 才把 data_source_auth.status 置 99；403 保持资源级错误
 *
 *   - GSC/Bing 只放行查询类端点, 不开放任何写入路径
 * =================================================================== */

import { and, eq } from 'drizzle-orm'
import { data_source_auth, project_data_source } from '../../../../database/schema'
import { getProviderCredential } from '../../../../utils/data-source-token'
import { getFirst, useDb } from '../../../../utils/db'
import { getAppSecret } from '../../../../utils/self-hosted'

/* ---- provider → 查询类端点白名单. 不开 wildcard ---- */
const PROVIDERS = {
  ga4: {
    base: 'https://analyticsdata.googleapis.com/v1beta/',
    auth: 'bearer',
    allow: (endpoint) => /^properties\/[^/]+:(runReport|runRealtimeReport)$/.test(endpoint),
  },
  gsc: {
    base: 'https://searchconsole.googleapis.com/webmasters/v3/',
    auth: 'bearer',
    allow: (endpoint) => endpoint === 'sites' || /^sites\/[^/]+\/searchAnalytics\/query$/.test(endpoint),
  },
  bing: {
    base: 'https://ssl.bing.com/webmaster/api.svc/json/',
    auth: 'api_key_query',
    allow: (endpoint) => new Set([
      'GetUserSites',
      'GetQueryStats',
      'GetPageStats',
      'GetRankAndTrafficStats',
    ]).has(endpoint),
  },
}

/* ---- HTTP method 白名单. 不允许 DELETE / PATCH 等破坏性动词 ---- */
const ALLOWED_METHODS = new Set(['GET', 'POST'])

export default defineEventHandler(async (event) => {
  const user = await guardV1(event)
  const provider = getRouterParam(event, 'provider')
  const config = PROVIDERS[provider]
  if (!config) {
    return reqFail(`unsupported provider: ${provider}`)
  }

  const body = await readBody(event)
  let endpoint = String(body?.endpoint || '').trim()
  const method = String(body?.method || 'POST').toUpperCase()
  const payload = body?.body

  /* ---- 入参校验 ---- */
  if (!endpoint) return reqFail('endpoint required')
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    return reqFail('endpoint must be a path under provider base url, not absolute url')
  }
  if (endpoint.includes('..')) return reqFail('endpoint cannot contain ..')
  if (!ALLOWED_METHODS.has(method)) return reqFail(`method not allowed: ${method}`)

  const db = await useDb(event)
  const { ds, auth } = await resolveAuth({ db, user, provider, body })
  if (ds?.resource_id) {
    endpoint = endpoint
      .replaceAll('{resource_id}', ds.resource_id)
      .replaceAll('{resource_id_encoded}', encodeURIComponent(ds.resource_id))
  }
  if (!config.allow(endpoint.replace(/^\/+/, ''))) return reqFail('endpoint not allowed')

  if (!auth) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found', message: 'auth not found' })
  }
  if (!assertEndpointMatchesResource(provider, endpoint.replace(/^\/+/, ''), ds)) {
    return reqFail('endpoint resource does not match mounted resource')
  }
  if (auth.status !== 1) {
    return reqFail('auth disabled or token revoked, please re-authorize')
  }
  /* ---- 解密 / 刷新 provider credential (OAuth access_token 或 Bing api key) ---- */
  const appSecret = getAppSecret(event)
  if (!appSecret) {
    throw createError({ statusCode: 500, statusMessage: 'Server Misconfigured', message: 'app_secret_missing' })
  }
  let credential = ''
  try {
    credential = await getProviderCredential(db, auth, appSecret, event.context.siteConfig || {})
  } catch {
    return reqFail('token decrypt failed, please re-authorize')
  }

  /* ---- 转发到 provider, 严格拼 base + path ---- */
  let targetUrl = config.base + endpoint.replace(/^\/+/, '')
  const headers = { 'Content-Type': 'application/json' }
  if (config.auth === 'bearer') {
    headers.Authorization = `Bearer ${credential}`
  } else if (config.auth === 'api_key_query') {
    const url = new URL(targetUrl)
    url.searchParams.set('apikey', credential)
    const params = {
      ...(payload?.query || payload?.params || {}),
    }
    if (ds?.resource_id) params.siteUrl = ds.resource_id
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
    }
    targetUrl = url.toString()
    headers.Accept = 'application/json'
    delete headers['Content-Type']
  }
  const upstream = await fetch(targetUrl, {
    method,
    headers,
    body: method === 'GET' || config.auth === 'api_key_query' ? undefined : JSON.stringify(payload ?? {}),
  })

  const text = await upstream.text()

  /* ---- 只有 401 代表凭证失效；403 是单资源权限问题，不能污染账号级状态 ---- */
  if (upstream.status === 401) {
    const now = Math.floor(Date.now() / 1000)
    await db.update(data_source_auth)
      .set({ status: 99, updated_at: now })
      .where(eq(data_source_auth.id, auth.id))
      .catch(() => {})
    return reqFail('token invalid, please re-authorize')
  }
  if (upstream.status === 403) {
    return reqFail('provider permission denied for this resource')
  }
  if (upstream.status === 429 || upstream.status === 503) {
    setHeader(event, 'Retry-After', upstream.headers.get('retry-after') || '60')
    return reqFail('rate_limited, retry later')
  }
  if (!upstream.ok) {
    return reqFail(`provider error: ${upstream.status}`)
  }

  /* ---- 原样透传 JSON 响应 ---- */
  let json = null
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  return reqSuccess({
    provider,
    endpoint,
    project_key: ds?.project_key || '',
    resource_id: ds?.resource_id || '',
    response: json,
  })
})

async function resolveAuth({ db, user, provider, body }) {
  const authId = Number(body?.auth_id)
  if (authId) {
    const auth = await getFirst(
      db.select().from(data_source_auth)
        .where(and(
          eq(data_source_auth.id, authId),
          eq(data_source_auth.project_id, user.project_id),
          eq(data_source_auth.union_id, user.union_id),
          eq(data_source_auth.provider, provider),
        ))
        .limit(1),
    )
    return { ds: null, auth }
  }

  const projectKey = String(body?.project_key || '').trim()
  if (!projectKey) return { ds: null, auth: null }

  const conds = [
    eq(project_data_source.project_id, user.project_id),
    eq(project_data_source.union_id, user.union_id),
    eq(project_data_source.project_key, projectKey),
    eq(project_data_source.provider, provider),
    eq(project_data_source.status, 1),
  ]
  const resourceId = String(body?.resource_id || '').trim()
  if (resourceId) conds.push(eq(project_data_source.resource_id, resourceId))

  const ds = await getFirst(
    db.select().from(project_data_source)
      .where(and(...conds))
      .limit(1),
  )
  if (!ds) return { ds: null, auth: null }

  const auth = await getFirst(
    db.select().from(data_source_auth)
      .where(and(
        eq(data_source_auth.id, ds.auth_id),
        eq(data_source_auth.project_id, user.project_id),
        eq(data_source_auth.union_id, user.union_id),
        eq(data_source_auth.provider, provider),
      ))
      .limit(1),
  )
  return { ds, auth }
}

function assertEndpointMatchesResource(provider, endpoint, ds) {
  if (!ds?.resource_id) return true
  if (provider === 'ga4') return endpoint.startsWith(`${ds.resource_id}:`)
  if (provider === 'gsc') {
    if (endpoint === 'sites') return true
    return endpoint === `sites/${encodeURIComponent(ds.resource_id)}/searchAnalytics/query`
  }
  return true
}
