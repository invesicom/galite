/* ===================================================================
 * JWT 工具 - 纯 Web Crypto API 实现
 * - HMAC-SHA256 签名/验证, 零外部依赖
 * - 运行于 Cloudflare Workers / Node.js / 任何支持 SubtleCrypto 的环境
 * =================================================================== */

/* ---- Base64url 编解码 ---- */

function textToArrayBuffer(str) {
  const buf = new Uint8Array(str.length)
  for (let i = 0; i < str.length; i++) {
    buf[i] = str.charCodeAt(i)
  }
  return buf
}

function arrayBufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function base64UrlToArrayBuffer(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '')
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

function textToBase64Url(str) {
  const encoded = new TextEncoder().encode(str)
  const binary = String.fromCharCode(...encoded)
  return btoa(binary)
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function decodeBase64UrlPayload(raw) {
  try {
    const b64 = raw.replace(/-/g, '+').replace(/_/g, '/')
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const text = new TextDecoder('utf-8').decode(bytes)
    return JSON.parse(text)
  } catch {
    return null
  }
}

/* ---- HMAC Key 导入 ---- */

const ALGORITHM = { name: 'HMAC', hash: { name: 'SHA-256' } }

async function importHmacKey(secret, usages, purpose) {
  const source = new TextEncoder().encode(`galite:jwt:v1:${purpose}:${String(secret ?? '')}`)
  const keyBytes = await crypto.subtle.digest('SHA-256', source)
  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    ALGORITHM,
    false,
    usages,
  )
}

/* ---- 核心 API ---- */

export async function signJwt(payload, secret, expiresIn, purpose = 'owner-session') {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  if (!payload.iat) payload.iat = now
  if (expiresIn && !payload.exp) payload.exp = now + expiresIn

  const encodedHeader = textToBase64Url(JSON.stringify(header))
  const encodedPayload = textToBase64Url(JSON.stringify(payload))
  const partialToken = `${encodedHeader}.${encodedPayload}`

  const key = await importHmacKey(secret, ['sign'], purpose)
  const signature = await crypto.subtle.sign(
    ALGORITHM,
    key,
    textToArrayBuffer(partialToken),
  )

  return `${partialToken}.${arrayBufferToBase64Url(signature)}`
}

export async function verifyJwt(token, secret, clockTolerance = 0, purpose = 'owner-session') {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return false

    const header = decodeBase64UrlPayload(parts[0])
    if (!header || header.alg !== 'HS256') return false

    const payload = decodeBase64UrlPayload(parts[1])
    if (!payload) return false

    const now = Math.floor(Date.now() / 1000)
    if (payload.nbf && payload.nbf > now + clockTolerance) return false
    if (payload.exp && payload.exp <= now - clockTolerance) return false

    const key = await importHmacKey(secret, ['verify'], purpose)
    return crypto.subtle.verify(
      ALGORITHM,
      key,
      base64UrlToArrayBuffer(parts[2]),
      textToArrayBuffer(`${parts[0]}.${parts[1]}`),
    )
  } catch {
    return false
  }
}

export function decodeJwt(token) {
  const parts = token.split('.')
  return {
    header: decodeBase64UrlPayload(parts[0]),
    payload: decodeBase64UrlPayload(parts[1]),
  }
}
