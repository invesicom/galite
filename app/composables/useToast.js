/* ========================================================================== *
 * useToast — 全局轻量级反馈弹窗
 *
 * 职责: 任何地方调用 toast("文案") 都会在屏幕顶部短暂弹出一条提示, 自动消失
 *       单例 state 通过 useState 实现 SSR-safe 的全局共享
 *
 * 哲学: 用户操作必有回声。沉默的失败是最大的反 UX 原罪
 *       校验不通过、文件超限、上传失败 —— 这些都必须看得见
 *
 * 用法:
 *   const { show, dismiss, toasts } = useToast()
 *   show("File too large", { type: "warning" })
 *   show("Saved", { type: "success", duration: 2000 })
 * ========================================================================== */

const DEFAULT_DURATION = 3200
let toastSeq = 0

/**
 * @typedef {'info' | 'success' | 'warning' | 'error'} ToastType
 * @typedef {{ id: number, message: string, type: ToastType, leaving: boolean }} ToastEntry
 */

export function useToast() {
  /* 单例响应式状态 — Nuxt useState 保证 SSR 一致 + 多组件共享 */
  const toasts = useState('app-toasts', () => [])
  const timers = useState('app-toast-timers', () => ({}))

  /* -------------------------------- 核心动作 ------------------------------- */

  function show(message, options = {}) {
    const text = String(message || '').trim()
    if (!text) return 0

    const id = ++toastSeq
    const type = normalizeType(options.type)
    const duration = Number.isFinite(options.duration) ? Number(options.duration) : DEFAULT_DURATION

    toasts.value = [...toasts.value, { id, message: text, type, leaving: false }]

    if (typeof window !== 'undefined' && duration > 0) {
      const handle = window.setTimeout(() => dismiss(id), duration)
      timers.value = { ...timers.value, [id]: handle }
    }
    return id
  }

  function dismiss(id) {
    const target = toasts.value.find((it) => it.id === id)
    if (!target) return

    /* 先标记 leaving, 180ms 后才真正从数组剔除 — 给淡出动画留时间 */
    toasts.value = toasts.value.map((it) => (it.id === id ? { ...it, leaving: true } : it))
    clearTimer(id)

    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        toasts.value = toasts.value.filter((it) => it.id !== id)
      }, 180)
    } else {
      toasts.value = toasts.value.filter((it) => it.id !== id)
    }
  }

  function clearAll() {
    Object.values(timers.value).forEach((handle) => {
      if (typeof window !== 'undefined') window.clearTimeout(handle)
    })
    timers.value = {}
    toasts.value = []
  }

  /* -------------------------------- 内部辅助 ------------------------------- */

  function clearTimer(id) {
    const handle = timers.value[id]
    if (!handle) return
    if (typeof window !== 'undefined') window.clearTimeout(handle)
    const next = { ...timers.value }
    delete next[id]
    timers.value = next
  }

  function normalizeType(raw) {
    const value = String(raw || 'info').toLowerCase()
    if (value === 'success' || value === 'warning' || value === 'error') return value
    return 'info'
  }

  return { toasts, show, dismiss, clearAll }
}
