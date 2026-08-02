/* ===========================================================
   useTheme - 主题色管理
   职责: 将站点配置的色值注入 CSS 变量
   设计: SSR + CSR 双通道注入，消灭 FOUC

   SSR 通道: buildThemeStyle() → useHead <style> 注入
   CSR 通道: applyTheme() → document.documentElement 热更新
   =========================================================== */

/* ---- CSS 变量映射表: 配置键 → CSS 变量名 ---- */
export const COLOR_MAP = {
  primary: '--ct-primary',
  primaryText: '--ct-primary-text',
  secondary: '--ct-secondary',
  secondaryText: '--ct-secondary-text',
  accent: '--ct-accent',
  accentText: '--ct-accent-text',
}

/* ---- 从 colors 对象提取有效的 CSS 变量键值对 ---- */
function resolveVars(colors) {
  if (!colors) return []
  const pairs = []
  for (const [key, cssVar] of Object.entries(COLOR_MAP)) {
    /* 同时兼容 camelCase (primaryText) 和 snake_case (primary_text) */
    const snakeKey = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
    const value = colors[key] || colors[snakeKey]
    if (value) pairs.push([cssVar, value])
  }
  return pairs
}

export function useTheme() {

  /* ===========================================================
     buildThemeStyle - 生成内联 CSS 字符串 (SSR 用)
     输出: ":root{--ct-primary:#00704A;--ct-secondary:#0C2F1E}"
     用于 useHead({ style }) 注入，第一帧即正确颜色
     =========================================================== */
  function buildThemeStyle(colors) {
    const pairs = resolveVars(colors)
    if (!pairs.length) return ''
    return `:root{${pairs.map(([k, v]) => `${k}:${v}`).join(';')}}`
  }

  /* ===========================================================
     applyTheme - 客户端热更新 CSS 变量
     场景: 运行时主题切换 (罕见但保留能力)
     =========================================================== */
  function applyTheme(colors) {
    if (!colors || !import.meta.client) return
    const root = document.documentElement
    for (const [cssVar, value] of resolveVars(colors)) {
      root.style.setProperty(cssVar, value)
    }
  }

  return { applyTheme, buildThemeStyle }
}
