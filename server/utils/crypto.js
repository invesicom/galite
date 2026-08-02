/* ===================================================================
 * 加解密工具 - AES-256-GCM
 * - OAuth state 加密/解密
 * - 纯 Web Crypto API, 兼容 Cloudflare Workers
 * =================================================================== */

/* ---- Base64 规范化 ---- */

function normalizeBase64(input) {
  let b64 = input.replace(/-/g, '+').replace(/_/g, '/').replace(/ /g, '+')
  while (b64.length % 4) b64 += '='
  return b64
}

/* ---- AES Key 导入 ----
 * APP_SECRET 是唯一主密钥；固定用途标签把 AES 与 JWT/HMAC 密钥空间隔离。 */

async function importAesKey(secret, keyUsages, purpose) {
  const source = new TextEncoder().encode(`galite:aes:v1:${purpose}:${String(secret ?? '')}`)
  const keyRaw = new Uint8Array(await crypto.subtle.digest('SHA-256', source))
  return crypto.subtle.importKey('raw', keyRaw, { name: 'AES-GCM' }, false, keyUsages)
}

/* ---- 核心 API ---- */

export async function encrypt(text, key, purpose = 'provider-token') {
  const aesKey = await importAesKey(key, ['encrypt'], purpose)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(text)

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    encoded,
  )

  const buf = new Uint8Array(iv.length + encrypted.byteLength)
  buf.set(iv, 0)
  buf.set(new Uint8Array(encrypted), iv.length)
  return btoa(String.fromCharCode(...buf))
}

export async function decrypt(encryptedText, key, purpose = 'provider-token') {
  try {
    const b64 = normalizeBase64(encryptedText)
    const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const iv = data.slice(0, 12)
    const ciphertext = data.slice(12)

    const aesKey = await importAesKey(key, ['decrypt'], purpose)
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      ciphertext,
    )
    return new TextDecoder().decode(decrypted)
  } catch (e) {
    console.error('Decryption failed:', e.message)
    return null
  }
}

export function generateNonce(length = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const values = crypto.getRandomValues(new Uint8Array(length))
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars[values[i] % chars.length]
  }
  return result
}

export async function createEncryptedState(data, key) {
  const stateData = {
    ...data,
    timestamp: Date.now(),
    nonce: generateNonce(),
  }
  const encrypted = await encrypt(JSON.stringify(stateData), key, 'google-oauth-state')
  return encrypted.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function parseEncryptedState(state, key, maxAgeMs = 10 * 60 * 1000) {
  try {
    const b64 = normalizeBase64(state)
    const decrypted = await decrypt(b64, key, 'google-oauth-state')
    if (!decrypted) return null

    const data = JSON.parse(decrypted)

    if (Date.now() - data.timestamp > maxAgeMs) {
      console.error('State expired')
      return null
    }

    return data
  } catch (e) {
    console.error('Parse state failed:', e.message)
    return null
  }
}
