/* ============================================================
   minLoading - 最小 loading 时长保护
   --
   场景: 后端走 60s metrics_cache, 命中时几毫秒返回, UI 从骨架到数据
        的跳变非常突兀 ("闪动"). 强制 loading 至少持续 MIN_LOADING_MS,
        让缓存命中与真实请求拥有同一种视觉节奏.
   --
   哲学: 用户感知的"加载体验一致性" > 缓存的"实际快".
        500ms 是 UX 研究下 "瞬间" 与 "过渡" 的分界线 — 短于此用户感知为
        闪动, 长于此用户感知为加载. 取下限即可消除闪动, 不让等待变成负担.
   --
   接口: 一个 helper, callback setter 形式, 覆盖所有 loading 状态形态:
        - ref<boolean>:        withMinLoading(v => loading.value = v, fn)
        - 对象 key:             withMinLoading(v => loadings.value.foo = v, fn)
        - 任意自定义 setter:    withMinLoading(myCustomSetter, fn)
   错误路径不补 delay (用户应立即看到错误态, 而非等 500ms).
   ============================================================ */

export const MIN_LOADING_MS = 500

export async function withMinLoading(setLoading, fn) {
  setLoading(true)
  const start = Date.now()
  try {
    const res = await fn()
    const elapsed = Date.now() - start
    if (elapsed < MIN_LOADING_MS) {
      await new Promise((r) => setTimeout(r, MIN_LOADING_MS - elapsed))
    }
    return res
  } finally {
    setLoading(false)
  }
}
