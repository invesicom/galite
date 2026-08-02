/* ===========================================================
   useFunnels - 漏斗 CRUD + results 拉取
   --
   职责:
     fetchList(projectKey) -> 该项目下全部漏斗 (含 steps)
     create(projectKey, payload)
     update(funnelKey, payload)
     remove(funnelKey)
     fetchDetail(funnelKey)
     fetchResults(funnelKey, period, force?)
   --
   设计:
     不走全局 useState 缓存: 漏斗与项目强耦合, 每个详情页拉自己的
     调用方拿到 list 后存 local ref, 不要在多页面共享
     错误抛给调用方统一处理
   =========================================================== */

export function useFunnels() {

  const api = useApi()

  /* ---- 列表: 某项目下全部漏斗 ---- */
  async function fetchList(projectKey) {
    if (!projectKey) return null
    return await api.get(`/api/projects/${projectKey}/funnels`)
  }

  /* ---- 创建 ---- */
  async function create(projectKey, payload) {
    return await api.post(`/api/projects/${projectKey}/funnels`, payload)
  }

  /* ---- 单漏斗详情 (用于编辑) ---- */
  async function fetchDetail(funnelKey) {
    if (!funnelKey) return null
    return await api.get(`/api/funnels/${funnelKey}`)
  }

  /* ---- 更新 (name / steps 任选) ---- */
  async function update(funnelKey, payload) {
    return await api.post(`/api/funnels/${funnelKey}/update`, payload)
  }

  /* ---- 软删 ---- */
  async function remove(funnelKey) {
    return await api.post(`/api/funnels/${funnelKey}/delete`, {})
  }

  /* ---- 执行 (调 GA4 v1alpha) ----
     filters: [{ dim, match, value }] 可选, 拼到 ?f=... 让漏斗按 filter 切片
     与 metrics 接口同款 URL 形态, 后端 parseFiltersFromQuery 解析 */
  async function fetchResults(funnelKey, period = '7days', { force = false, filters = [] } = {}) {
    if (!funnelKey) return null
    const parts = [`period=${encodeURIComponent(period)}`]
    if (force) parts.push('force=1')
    for (const f of filters || []) {
      parts.push(`f=${encodeURIComponent(`${f.dim}:${f.match}:${f.value}`)}`)
    }
    return await api.get(`/api/funnels/${funnelKey}/results?${parts.join('&')}`)
  }

  return {
    fetchList,
    create,
    fetchDetail,
    update,
    remove,
    fetchResults,
  }
}
