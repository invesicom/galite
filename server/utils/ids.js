/* ===================================================================
 * 业务 ID 生成器 - 统一出处, 同算法不同字符集/语义的随机串
 *
 *   generateUnionId()    - 18 位数字 (首位 1~9, 防 0 前导)
 *                          用途: user.union_id / funnel_key
 *   generateProjectKey() - 18 位 base62 (A-Za-z0-9), 大小写混合
 *                          用途: project_list.project_key (URL 可见, 字母风格)
 *   generateUnionCode(n) - n 位 base36 (a-z + 0-9)
 *                          用途: 邀请码 / 短引用
 *
 * 设计意图: 业务侧只需"足够稀疏的随机串", 不需要密码学强度.
 * 碰撞兜底由调用方自行重试 (见 auto-sync-projects.js / funnels.post.js).
 * =================================================================== */

const DIGITS = '0123456789'
const FIRST  = '123456789'                     // 首位非 0, 保持 18 位整宽
const BASE36 = 'abcdefghijklmnopqrstuvwxyz0123456789'
const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/* ---- 18 位整数串, 首位 1~9 ---- */
export function generateUnionId() {
  let result = FIRST[Math.floor(Math.random() * FIRST.length)]
  for (let i = 1; i < 18; i++) {
    result += DIGITS[Math.floor(Math.random() * DIGITS.length)]
  }
  return result
}

/* ---- 18 位 base62 (大小写字母+数字), project_key 专用 ---- */
export function generateProjectKey(length = 18) {
  let result = ''
  for (let i = 0; i < length; i++) {
    result += BASE62[Math.floor(Math.random() * BASE62.length)]
  }
  return result
}

/* ---- 任意长度 base36 短码 ---- */
export function generateUnionCode(length = 6) {
  let result = ''
  for (let i = 0; i < length; i++) {
    result += BASE36[Math.floor(Math.random() * BASE36.length)]
  }
  return result
}
