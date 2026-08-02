/* ============================================================ *
 * v-tooltip — 全局 tooltip 指令
 *
 * 用法:
 *   <button v-tooltip="t('xxx')">
 *   <span v-tooltip.overflow="name"> 仅内容被截断时显示
 *
 * 实现哲学:
 *   - 单一全局 tooltip element 浮在 body 末尾, fixed 定位 → 脱离任何
 *     祖先 overflow 上下文 (CSS-only ::after tooltip 会被 overflow:auto
 *     的滚动容器裁掉, 这是踩过的坑)
 *   - mouseenter / focusin → 显示并按 trigger rect 计算位置
 *   - 触发器是 disabled 按钮时不显示 (灰按钮已传达"不可用"语义)
 *   - 上方空间不足自动翻转下方; 水平边缘 clamp 在视口内
 *
 * 不复杂, 不引入第三方库; 视觉与之前 CSS-only 版本一致.
 * ============================================================ */

let tooltipEl = null
let styleEl = null

/* ---- 全局追踪最近一次输入类型: mouse / touch / pen / keyboard
       目的: 触屏 tap 同时触发 pointerenter (能 filter pointerType) 和 focusin
             (focus 事件没有 pointerType, 无法直接区分), 需要靠这个全局
             状态判断 focusin 是不是因触屏点击触发, 是的话跳过 tooltip */
let lastInteraction = ''

function ensureInteractionTracking() {
  if (typeof document === 'undefined') return
  if (document.__tipInteractionTracked) return
  document.__tipInteractionTracked = true
  document.addEventListener('pointerdown', (e) => {
    lastInteraction = e.pointerType || 'mouse'
  }, { capture: true, passive: true })
  document.addEventListener('keydown', () => {
    lastInteraction = 'keyboard'
  }, { capture: true, passive: true })
}

function ensureStyle() {
  if (styleEl) return
  styleEl = document.createElement('style')
  styleEl.dataset.app = 'v-tooltip'
  styleEl.textContent = `
    .app-tooltip {
      position: fixed;
      padding: 6px 10px;
      font-size: 12px;
      line-height: 1.4;
      color: #fff;
      background: rgba(0, 0, 0, 0.85);
      border-radius: 4px;
      /* 长文本自动换行: nowrap 与 max-width 同存会让超长内容被硬裁; 去掉 nowrap
         让短文本仍单行 (天然不会换), 长文本在 max-width 内换行兜底.
         pre-line: 单行字符串行为同 normal (零影响), 含 \n 时按字面换行,
         给调用方"多行 tooltip"的可控点. */
      max-width: 280px;
      white-space: pre-line;
      word-break: break-word;
      pointer-events: none;
      opacity: 0;
      transform: translateY(2px);
      transition: opacity 160ms ease, transform 160ms ease;
      z-index: 90;
    }
    .app-tooltip.is-visible {
      opacity: 1;
      transform: translateY(0);
    }
  `
  document.head.appendChild(styleEl)
}

function ensureEl() {
  if (tooltipEl) return tooltipEl
  ensureStyle()
  tooltipEl = document.createElement('div')
  tooltipEl.className = 'app-tooltip'
  tooltipEl.setAttribute('role', 'tooltip')
  document.body.appendChild(tooltipEl)
  return tooltipEl
}

/* ============================================================ *
 * 渲染 tooltip 内容 - 支持两种形态:
 *   - string: textContent 直出 (默认, 含 \n 换行)
 *   - object: { title, rows: [{ color, icon, label, value, pct }] }
 *             结构化表格, 行级 icon/dot + label + value + pct
 *
 * object 模式用纯 DOM API 创建 (不用 innerHTML, 杜绝 XSS),
 * 行间用 grid 布局对齐, 视觉密度高且无需额外 CSS class.
 * ============================================================ */
function renderContent(el, value) {
  el.replaceChildren()
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    el.textContent = String(value || '')
    return
  }
  /* ---- title (可选) ---- */
  if (value.title) {
    const title = document.createElement('div')
    title.textContent = String(value.title)
    title.style.cssText = 'font-weight: 600; padding-bottom: 6px; margin-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.18); white-space: nowrap;'
    el.appendChild(title)
  }
  /* ---- rows (数组, 每行: icon/dot · label? · value · pct?) ---- */
  const rows = Array.isArray(value.rows) ? value.rows : []
  for (const r of rows) {
    const hasLabel = r.label != null && String(r.label) !== ''
    const hasPct = r.pct != null && String(r.pct) !== ''
    const columns = hasLabel
      ? (hasPct ? '14px 1fr auto auto' : '14px 1fr auto')
      : (hasPct ? '14px auto auto' : '14px auto')
    const row = document.createElement('div')
    row.style.cssText = `display: grid; grid-template-columns: ${columns}; align-items: center; gap: 8px; line-height: 1.5;`

    if (r.icon) {
      const icon = document.createElement('img')
      icon.src = String(r.icon)
      icon.alt = String(r.alt || '')
      icon.style.cssText = 'width: 14px; height: 14px; object-fit: contain; border-radius: 3px;'
      row.appendChild(icon)
    } else {
      const dot = document.createElement('span')
      /* color: 'primary' 用 GA Lite 主色, 'muted' 灰色 */
      const dotColor = r.color === 'primary' ? '#3b82f6' : '#9ca3af'
      dot.style.cssText = `width: 8px; height: 8px; border-radius: 50%; background: ${dotColor}; justify-self: center;`
      row.appendChild(dot)
    }

    if (hasLabel) {
      const label = document.createElement('span')
      label.textContent = String(r.label || '')
      row.appendChild(label)
    }

    const val = document.createElement('span')
    val.textContent = String(r.value ?? '')
    val.style.cssText = 'font-weight: 600; font-variant-numeric: tabular-nums;'
    row.appendChild(val)

    if (hasPct) {
      const pct = document.createElement('span')
      pct.textContent = String(r.pct ?? '')
      pct.style.cssText = 'opacity: 0.6; font-variant-numeric: tabular-nums;'
      row.appendChild(pct)
    }

    el.appendChild(row)
  }
}

/* ============================================================ *
 * 定位 tooltip - 四种模式:
 *   target (默认): 锚在 target 元素顶部上方 6px, 上方空间不足翻下方
 *   cursor:        锚在鼠标位置上方 14px, 上方空间不足翻下方; 移动跟随
 *   right:         锚在 target 元素右侧 8px, 垂直居中; 右侧空间不足翻左侧
 *   bottom:        锚在 target 元素底部下方 6px, 下方空间不足翻上方
 * 模式选用:
 *   - 高度大的 target (如柱状图 bar h-44) → cursor
 *   - 折叠 sidebar 里的 icon button → right
 *   - 顶部页面元素 (target 上方已经是 header / 视口顶) → bottom
 *   - 其余 → target
 * ============================================================ */
function positionTip(target) {
  if (!tooltipEl || !target) return
  const tipRect = tooltipEl.getBoundingClientRect()
  let top, left

  if (target.__tipMode === 'cursor' && target.__tipMousePos) {
    const m = target.__tipMousePos
    top = m.y - tipRect.height - 14
    if (top < 4) top = m.y + 18                    /* 上方不足翻鼠标下方 */
    left = m.x - tipRect.width / 2
  } else if (target.__tipMode === 'right') {
    const tr = target.getBoundingClientRect?.()
    if (!tr) return
    /* 垂直居中于 target, 水平靠右 8px */
    top = tr.top + tr.height / 2 - tipRect.height / 2
    left = tr.right + 8
    /* 右侧空间不足翻左侧 */
    if (left + tipRect.width + 4 > window.innerWidth) {
      left = tr.left - tipRect.width - 8
    }
    /* 垂直 clamp (target 太靠近上下边缘时) */
    top = Math.max(4, Math.min(top, window.innerHeight - tipRect.height - 4))
    tooltipEl.style.left = `${Math.round(left)}px`
    tooltipEl.style.top = `${Math.round(top)}px`
    return
  } else if (target.__tipMode === 'bottom') {
    const tr = target.getBoundingClientRect?.()
    if (!tr) return
    /* 水平居中于 target, 锚 target 底部下方 6px */
    top = tr.bottom + 6
    /* 下方空间不足翻上方 */
    if (top + tipRect.height + 4 > window.innerHeight) {
      top = tr.top - tipRect.height - 6
    }
    left = tr.left + tr.width / 2 - tipRect.width / 2
  } else {
    const tr = target.getBoundingClientRect?.()
    if (!tr) return
    top = tr.top - tipRect.height - 6
    if (top < 4) top = tr.bottom + 6
    left = tr.left + tr.width / 2 - tipRect.width / 2
  }
  /* 水平边缘 clamp 在视口内 */
  left = Math.max(4, Math.min(left, window.innerWidth - tipRect.width - 4))
  tooltipEl.style.left = `${Math.round(left)}px`
  tooltipEl.style.top = `${Math.round(top)}px`
}

function show(target, content, event) {
  if (!content || !target) return
  const el = ensureEl()
  renderContent(el, content)
  /* 先离屏 measure, 渲染完后 positionTip 算位置 */
  el.style.left = '-9999px'
  el.style.top = '-9999px'
  el.classList.add('is-visible')
  /* cursor 模式: 记录初始鼠标位置, 后续 pointermove 会更新 */
  if (target.__tipMode === 'cursor' && event) {
    target.__tipMousePos = { x: event.clientX, y: event.clientY }
  }
  requestAnimationFrame(() => positionTip(target))
}

function hide() {
  if (tooltipEl) tooltipEl.classList.remove('is-visible')
}

function nodeOverflows(node) {
  return (node.scrollWidth - node.clientWidth > 1) || (node.scrollHeight - node.clientHeight > 1)
}

/* overflow 修饰符: 只在目标或子节点真实被截断时显示 tooltip.
   递归检查子节点, 因为常见结构是 flex 容器包一层 truncate 文本. */
function isOverflowing(el) {
  if (nodeOverflows(el)) return true
  for (const node of el.querySelectorAll?.('*') || []) {
    if (nodeOverflows(node)) return true
  }
  return false
}

/* modifier 查表替代分支链: 优先级 cursor > right > bottom > target.
   modifier 是 directive 编译期常量, 只可能匹配一个; 加新模式只需扩 MODE_ORDER */
const MODE_ORDER = ['cursor', 'right', 'bottom']
function resolveTipMode(modifiers) {
  return MODE_ORDER.find((m) => modifiers?.[m]) || 'target'
}

const vTooltip = {
  /* SSR 阶段 Vue 会调 directive.getSSRProps 提取静态 attrs; 不定义会报
   * "Cannot read properties of undefined (reading 'getSSRProps')".
   * tooltip 纯交互, 不渲染服务端 DOM 属性, 直接返回 null */
  getSSRProps() {
    return null
  },
  /* mounted/updated/beforeUnmount 只在客户端调用, SSR 不触及 */
  mounted(el, binding) {
    ensureInteractionTracking()
    /* binding.value 可能是 string 或 object {title, rows}, 保留原值不转字符串 */
    el.__tipContent = binding.value
    el.__tipMode = resolveTipMode(binding.modifiers)
    el.__tipOverflowOnly = !!binding.modifiers?.overflow
    const onEnter = (e) => {
      /* 触屏 tap: pointerenter 直接 filter, focusin 走 lastInteraction 判断 */
      if (e?.pointerType === 'touch') return
      if (!e?.pointerType && lastInteraction === 'touch') return
      if (el.disabled || el.getAttribute?.('aria-disabled') === 'true') return
      if (el.__tipOverflowOnly && !isOverflowing(el)) return
      show(el, el.__tipContent, e)
      /* cursor 模式: enter 后开始监听 pointermove 实时跟随 */
      if (el.__tipMode === 'cursor' && el.__tipOnMove) {
        el.addEventListener('pointermove', el.__tipOnMove)
      }
    }
    const onMove = (e) => {
      el.__tipMousePos = { x: e.clientX, y: e.clientY }
      positionTip(el)
    }
    const onLeave = () => {
      hide()
      if (el.__tipMode === 'cursor' && el.__tipOnMove) {
        el.removeEventListener('pointermove', el.__tipOnMove)
      }
    }
    el.__tipOnEnter = onEnter
    el.__tipOnMove = onMove
    el.__tipOnLeave = onLeave
    el.addEventListener('pointerenter', onEnter)
    el.addEventListener('pointerleave', onLeave)
    el.addEventListener('focusin', onEnter)
    el.addEventListener('focusout', onLeave)
    /* 点击立刻收 tooltip, 不留"已点击但还在 hover"的尾巴 */
    el.addEventListener('click', onLeave)
  },
  updated(el, binding) {
    el.__tipContent = binding.value
    el.__tipMode = resolveTipMode(binding.modifiers)
    el.__tipOverflowOnly = !!binding.modifiers?.overflow
  },
  beforeUnmount(el) {
    if (el.__tipOnEnter) {
      el.removeEventListener('pointerenter', el.__tipOnEnter)
      el.removeEventListener('focusin', el.__tipOnEnter)
    }
    if (el.__tipOnLeave) {
      el.removeEventListener('pointerleave', el.__tipOnLeave)
      el.removeEventListener('focusout', el.__tipOnLeave)
      el.removeEventListener('click', el.__tipOnLeave)
    }
    if (el.__tipOnMove) {
      el.removeEventListener('pointermove', el.__tipOnMove)
    }
    el.__tipOnEnter = null
    el.__tipOnMove = null
    el.__tipOnLeave = null
    hide()
  },
}

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive('tooltip', vTooltip)
})
