/* ===================================================================
 * 密码哈希工具 - PBKDF2-SHA256 (packed 单字段存储)
 * --
 * 把 salt + hash 打包成一个字符串存到公开项目密码字段，
 * 不需要额外 schema 列. 格式:
 *
 *   pbkdf2$v1$<salt_base64>$<hash_base64>
 *
 *   - 前缀 "pbkdf2$" 明确算法, 跟 legacy 明文密码 / 其他算法可区分
 *   - "v1" 算法版本号, 未来换 argon2 时直接 v2 老 hash 仍可验证
 *   - salt 16 字节 → 24 base64 字符
 *   - hash 32 字节 → 44 base64 字符
 *   - 总长 ~79 字符, varchar(255) 装得下
 *
 * 设计:
 *   - Web Crypto API 原生 PBKDF2, 兼容 Workers, 不引依赖
 *   - 100k 迭代 / 32 字节输出 / 16 字节随机 salt (OWASP 推荐下限)
 *   - 常量时间比较防 timing attack
 *   - 不存明文, 不可逆, 验证靠重新派生比对
 * =================================================================== */

const PBKDF2_ITERATIONS = 100000
const HASH_BYTES = 32
const SALT_BYTES = 16
const MIN_PASSWORD_LEN = 6

const ALGO = 'pbkdf2'
const VERSION = 'v1'

/* ---- Uint8Array ↔ base64 ---- */

function bytesToBase64(bytes) {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function base64ToBytes(b64) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/* ---- 核心派生: plaintext + salt → hash bytes ---- */

async function deriveBits(plaintext, saltBytes) {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(plaintext),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  )
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    HASH_BYTES * 8,
  )
}

/* ===========================================================
 *  hashPassword - 返回可直接持久化的 packed 字符串
 * =========================================================== */
export async function hashPassword(plaintext) {
  if (typeof plaintext !== 'string' || plaintext.length < MIN_PASSWORD_LEN) {
    throw new Error('weak_password')
  }
  const saltBytes = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const bits = await deriveBits(plaintext, saltBytes)
  const salt = bytesToBase64(saltBytes)
  const hash = bytesToBase64(new Uint8Array(bits))
  return `${ALGO}$${VERSION}$${salt}$${hash}`
}

/* ===========================================================
 *  verifyPassword - 比对明文密码与 packed 字符串
 *
 *  返回:
 *    true  - 密码正确
 *    false - 密码错 / packed 格式不识别 / 算法版本不支持
 *
 *  专门拒绝 legacy 明文密码 (没有 pbkdf2$ 前缀的) - 强制走新流程
 * =========================================================== */
export async function verifyPassword(plaintext, packed) {
  if (!plaintext || !packed) return false
  const parts = String(packed).split('$')
  if (parts.length !== 4)         return false
  if (parts[0] !== ALGO)          return false
  if (parts[1] !== VERSION)       return false
  const [, , saltB64, hashB64] = parts
  if (!saltB64 || !hashB64)       return false

  try {
    const saltBytes = base64ToBytes(saltB64)
    const bits = await deriveBits(plaintext, saltBytes)
    const got = bytesToBase64(new Uint8Array(bits))
    /* ---- 常量时间比较 (避免 timing attack) ---- */
    if (got.length !== hashB64.length) return false
    let diff = 0
    for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ hashB64.charCodeAt(i)
    return diff === 0
  } catch {
    return false
  }
}
