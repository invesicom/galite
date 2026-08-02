/* ===========================================================
   useServerApi - SSR/CSR 统一内部 API fetch
   -----------------------------------------------------------
   SSR: 绑定当前 H3 event 的 request fetch, 继承 context 与代理 headers.
   CSR: 自动退化为浏览器全局 $fetch.
   =========================================================== */

export function useServerApi() {
  const requestFetch = useRequestFetch()

  return function fetchInternal(url, opts = {}) {
    return requestFetch(url, opts)
  }
}
