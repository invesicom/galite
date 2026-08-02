/* ===================================================================
 * MCP Endpoint · 远程单点 (MCP 协议 2025-06-18 / 2025-03-26, Streamable HTTP)
 *
 *   POST /api/mcp     — JSON-RPC 2.0 请求 (initialize / tools/list / tools/call)
 *   GET  /api/mcp     — Server → Client 通知通道占位 (本实现无主动推送)
 *
 * 接入双轨 (任选其一):
 *   1. OAuth 2.1 + PKCE (MCP-aware client 默认): 浏览器登录授权拿 mcp_access JWT.
 *   2. 静态 sk- API Key (脚本/CI 兜底): Authorization: Bearer sk-xxx
 *
 * 鉴权策略 — EAGER (连接即鉴权):
 *   - 所有 POST (含 initialize / tools/list) 都要求合法 Bearer; 缺/坏统一 401 +
 *     WWW-Authenticate, body 为标准 JSON-RPC error. client 在"连接握手第一步"就被
 *     401 拉起 OAuth, 登录成功后整条连接带 token → "连接成功" 即 "已授权".
 *   - 对比旧版 lazy auth (initialize/tools/list 公开, 仅 tools/call 才挑战):
 *     旧版让 client 以 tools/list 成功标记"已连接"却处于未授权态 (用户上报的
 *     "显示已连接但取数 requires auth"), 故改为 eager. 代价: 放弃匿名探测 tools/list.
 *
 * 鉴权单一真相源 (philosophy_good_taste):
 *   - preflight 调 resolveUserFromToken() 在"完整 context"解析一次身份 (验签 + 查库),
 *     结果存 ctx.mcpAuth.user; tools/call 经 callTool 用 ALS 把身份下传 v1,
 *     v1 不再在残缺子 context 重验 (见 utils/api-key-guard.js + utils/db.js).
 *   - tool 调用通过 internal $fetch 转发到 /api/v1/* — 鉴权/限流/缓存全复用 v1.
 *   - 不引 @modelcontextprotocol/sdk: MCP 协议本身就是 JSON-RPC 2.0.
 * =================================================================== */

import { TOOLS, callTool } from '../../utils/mcp-tools'
import { resolveOrigin } from '../../utils/mcp-oauth'
import { resolveUserFromToken, extractBearer } from '../../utils/api-key-guard'

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26']
const SERVER_INFO = { name: 'open-galite', version: '0.1.0' }
const SERVER_INSTRUCTIONS = [
  'This MCP server is read-only.',
  'Use list_projects first to discover project_key values.',
  'For any site analysis, prefer get_site_overview before calling lower-level metric tools.',
  'Use curated tools by default because they are compact; use ga4_run_report, gsc_search_analytics, or bing_query_stats only when a skill needs native provider response shapes.',
  'Metric payloads may include fetched_at/from_cache/cache_state timestamps. Stale-but-recent data is acceptable for analysis.',
  'Periods: today, yesterday, 7days, 28days, 90days, 6months, 1year.',
  'For connection or public profile management requests, return get_connect_url links and let the user complete writes in the dashboard.',
].join('\n')

/* ===================================================================
 *  HTTP 入口 — 只 dispatch HTTP method, 业务逻辑下沉
 * =================================================================== */
export default defineEventHandler(async (event) => {
  const method = event.method

  /* ---- CORS 预检 ---- */
  if (method === 'OPTIONS') {
    setCorsHeaders(event)
    return ''
  }
  setCorsHeaders(event)

  /* ---- GET = SSE 通知通道 (无主动推送, 立即结束 stream) ---- */
  if (method === 'GET') {
    return openSseStream(event)
  }
  if (method !== 'POST') {
    setResponseStatus(event, 405)
    return { error: 'method_not_allowed' }
  }

  const body = await readBody(event)

  /* ---- 鉴权: 在完整 context 解析一次身份, 存入 ctx.mcpAuth ---- */
  await preflightAuth(event)

  /* ---- EAGER 门禁 (哨兵式单点): 未授权 → 401, 所有方法一视同仁 ----
   *  client 收到 401 + WWW-Authenticate 即拉起 OAuth (no_token)
   *  或 refresh_token 续期 (invalid_token). 这是"连接即授权"的关键一步.
   */
  const a = event.context.mcpAuth
  if (a.kind !== 'authed') {
    send401(event, a.kind === 'invalid' ? 'invalid_token' : 'no_token')
    const errBody = authErrorBody(event, body, a.kind)
    return errBody === null ? '' : errBody
  }

  const responses = await dispatchRpc(event, body)

  /* ---- 通知 (无 id) 不返回内容, 协议要求 204 ---- */
  if (responses === null) {
    setResponseStatus(event, 204)
    return ''
  }
  return responses
})

/* ===================================================================
 *  Preflight: token → 身份 (完整 context, 验签 + 查库一次到位)
 *
 *    none    — 无 Bearer
 *    invalid — 有 Bearer 但验不过 / 用户不存在 / 状态异常
 *    authed  — { user } 已解析的统一身份, 经 ALS 下传 v1 复用
 *
 *  与旧版只验签不查库不同: 这里直接产出可下传的完整 user, 让 v1 零重验.
 * =================================================================== */
async function preflightAuth(event) {
  const token = extractBearer(event)
  if (!token) {
    event.context.mcpAuth = { kind: 'none' }
    return
  }
  const user = await resolveUserFromToken(event, token)
  event.context.mcpAuth = user
    ? { kind: 'authed', user, token }
    : { kind: 'invalid' }
}

/* ===================================================================
 *  401 + WWW-Authenticate — 让 MCP client 发现 OAuth metadata
 *
 *  RFC 6750 §3 Bearer challenge + RFC 9728 resource_metadata 指针.
 *    - no_token (未带凭证)     → 不写 error 参数, client 视为首次连接走完整 OAuth
 *    - invalid_token (坏/过期) → error="invalid_token", client 优先 refresh 续期
 * =================================================================== */
function send401(event, reason = 'invalid_token') {
  const origin = resolveOrigin(event)
  const parts = ['Bearer realm="mcp"']
  if (reason === 'invalid_token') {
    parts.push('error="invalid_token"')
    parts.push('error_description="access token expired or invalid"')
  }
  parts.push(`resource_metadata="${origin}/.well-known/oauth-protected-resource"`)
  setHeader(event, 'WWW-Authenticate', parts.join(', '))
  setResponseStatus(event, 401)
}

/* ===================================================================
 *  鉴权失败的 JSON-RPC body — 单 / 批 / 通知各自成形
 *
 *  HTTP 状态已是 401; body 再给一条自解释的 -32001, 让不自动跳浏览器的
 *  client (如 Claude Code) 能把文案用自然语言转告用户.
 * =================================================================== */
function authErrorBody(event, payload, kind) {
  const origin = resolveOrigin(event)
  const msg = kind === 'invalid'
    ? 'Access token expired or invalid. The client should refresh via the refresh_token grant; '
      + 'if refresh fails, re-authorize by opening the OAuth flow in the browser.'
    : 'Authorization required. This MCP server uses OAuth 2.1 — your client should open the browser '
      + `to sign in (e.g. run "/mcp" in Claude Code). Metadata: ${origin}/.well-known/oauth-protected-resource`
  const one = (req) => (req?.id === undefined || req?.id === null)
    ? null
    : { jsonrpc: '2.0', id: req.id, error: { code: -32001, message: msg } }
  if (Array.isArray(payload)) {
    const arr = payload.map(one).filter(Boolean)
    return arr.length ? arr : null
  }
  return one(payload)
}

/* ===================================================================
 *  JSON-RPC dispatch — 支持单 / 批
 * =================================================================== */
async function dispatchRpc(event, payload) {
  if (Array.isArray(payload)) {
    const results = await Promise.all(payload.map((req) => handleOne(event, req)))
    const filtered = results.filter((r) => r !== null)
    return filtered.length ? filtered : null
  }
  return handleOne(event, payload)
}

async function handleOne(event, req) {
  /* ---- 通知: 无 id, 不需要响应 (initialized / cancelled 等) ---- */
  const isNotification = req?.id === undefined || req?.id === null
  try {
    const result = await routeRpc(event, req)
    if (isNotification) return null
    return { jsonrpc: '2.0', id: req.id, result }
  } catch (err) {
    if (isNotification) return null
    return {
      jsonrpc: '2.0',
      id: req?.id ?? null,
      error: {
        code: err?.rpcCode || -32603,
        message: err?.message || 'internal_error',
      },
    }
  }
}

/* ===================================================================
 *  方法路由 — 到这里身份已鉴权 (eager 门禁保证), 各方法不再各自验权
 * =================================================================== */
async function routeRpc(event, req) {
  const m = req?.method
  if (m === 'initialize') {
    return {
      protocolVersion: negotiateProtocolVersion(req?.params?.protocolVersion),
      serverInfo: SERVER_INFO,
      capabilities: { tools: {} },
      instructions: SERVER_INSTRUCTIONS,
    }
  }
  if (m === 'ping') return {}
  if (m === 'tools/list') {
    return {
      tools: TOOLS.map(({ name, description, inputSchema, outputSchema, annotations }) => ({
        name,
        description,
        inputSchema,
        outputSchema,
        annotations,
      })),
    }
  }
  if (m === 'tools/call') {
    const { name, arguments: args } = req.params || {}
    try {
      const data = await callTool(event, name, args || {})
      return toolResult(data)
    } catch (err) {
      if (err?.rpcCode) throw err
      return toolResult({
        error: err?.message || 'tool_call_failed',
        status: err?.status || 0,
      }, true)
    }
  }
  /* ---- notifications/* 系列直接吞掉 (initialized / cancelled / progress) ---- */
  if (typeof m === 'string' && m.startsWith('notifications/')) return {}

  const e = new Error(`method not found: ${m}`)
  e.rpcCode = -32601
  throw e
}

function negotiateProtocolVersion(clientVersion) {
  const requested = String(clientVersion || '')
  return SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
    ? requested
    : SUPPORTED_PROTOCOL_VERSIONS[0]
}

function toolResult(data, isError = false) {
  const value = data ?? null
  const structuredContent = data && typeof data === 'object' && !Array.isArray(data)
    ? data
    : { value }
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    structuredContent,
    ...(isError ? { isError: true } : {}),
  }
}

/* ===================================================================
 *  SSE 通道 — GET 入口, 当前不推送, 立即结束
 *  保留入口的好处: 标准 MCP client 在握手时探测 GET 不会拿到 405
 * =================================================================== */
function openSseStream(event) {
  setHeader(event, 'Content-Type', 'text/event-stream')
  setHeader(event, 'Cache-Control', 'no-cache, no-transform')
  setHeader(event, 'Connection', 'keep-alive')
  /* ---- 发一个 retry 提示后立即结束, 客户端会按需重连 ---- */
  return ': GA Lite mcp idle\n\nretry: 30000\n\n'
}

/* ---- CORS: MCP client (尤其 web-based) 直连需要 ---- */
function setCorsHeaders(event) {
  setHeader(event, 'Access-Control-Allow-Origin', '*')
  setHeader(event, 'Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  setHeader(event, 'Access-Control-Allow-Headers', 'Authorization, Content-Type, Mcp-Session-Id')
  setHeader(event, 'Access-Control-Expose-Headers', 'Mcp-Session-Id')
}
