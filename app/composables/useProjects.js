/* ===========================================================
   useProjects - 项目 CRUD + 缓存
   职责: 列表 / 创建 / 更新 / 删除, 复用同一份 ref 状态
   设计: useState 保持单实例 SSR 一致, 任意页面共享
   核心: 不防御 — 错误抛给调用方 toast 处理
   =========================================================== */

export function useProjects() {

  const api = useApi()
  /* ---- 单例响应式状态: 跨页面共享 ---- */
  const list = useState('galite:projects', () => [])
  const loading = useState('galite:projects-loading', () => false)
  const fetched = useState('galite:projects-fetched', () => false)

  /* ===========================================================
     fetchList - 拉项目列表
     场景: 进入 /projects 时拉一次, create/update/remove 后自动刷新
     =========================================================== */

  async function fetchList() {
    loading.value = true
    try {
      const res = await api.get('/api/projects/list')
      if (res?.code === 200) {
        list.value = res.data?.list || []
        fetched.value = true
      }
      return res
    } finally {
      loading.value = false
    }
  }

  /* ===========================================================
     create - 新建项目 (裸建, 不挂数据源)
     =========================================================== */

  async function create(payload) {
    const res = await api.post('/api/projects/create', payload)
    if (res?.code === 200) await fetchList()
    return res
  }

  /* ===========================================================
     createWithGa4 - 一键新建网站
     payload: { auth_id, name, site_url, account_name? }
     行为:   后端在 GA4 admin 下新建 property + web stream,
             再写本系统 project + project_data_source
     返回:   { project_key, property_id, measurement_id }
     =========================================================== */

  async function createWithGa4(payload) {
    const res = await api.post('/api/projects/create-with-ga4', payload)
    if (res?.code === 200) await fetchList()
    return res
  }

  /* ===========================================================
     update - 更新项目 (按 projectKey)
     =========================================================== */

  async function update(projectKey, payload) {
    const res = await api.post(`/api/projects/${projectKey}/update`, payload)
    if (res?.code === 200) await fetchList()
    return res
  }

  /* ===========================================================
     merge - 合并当前项目到目标项目
     ProjectFormModal 编辑 site_url 撞到已有项目时调用
     默认成功后刷新 list; 批量合并可传 refresh:false 统一收尾刷新
     =========================================================== */
  async function merge(projectKey, targetKey, options = {}) {
    const res = await api.post(`/api/projects/${projectKey}/merge`, {
      target_project_key: targetKey,
    })
    if (res?.code === 200 && options.refresh !== false) await fetchList()
    return res
  }

  /* ===========================================================
     remove - 软删项目
     =========================================================== */

  async function remove(projectKey, options = {}) {
    const res = await api.post(`/api/projects/${projectKey}/delete`, {
      also_delete_ga4: !!options.alsoDeleteGa4,
    })
    if (res?.code === 200) await fetchList()
    return res
  }

  /* ===========================================================
     fetchDetail - 取项目详情 (含挂载的 data_sources)
     不入 list 缓存, 调用方自己存 ref
     =========================================================== */

  async function fetchDetail(projectKey) {
    return await api.get(`/api/projects/${projectKey}`)
  }

  /* ===========================================================
     mountDataSource - 挂载一个 resource 到项目
     payload: { auth_id, resource_id, resource_label, resource_meta, realtime_dashboard }
     =========================================================== */

  async function mountDataSource(projectKey, payload) {
    return await api.post(`/api/projects/${projectKey}/data-sources`, payload)
  }

  /* ===========================================================
     unmountDataSource - 解除挂载 (软删 project_data_source)
     =========================================================== */

  async function unmountDataSource(projectKey, mountId) {
    return await api.post(`/api/projects/${projectKey}/data-sources/${mountId}`, {})
  }

  return {
    list,
    loading,
    fetched,
    fetchList,
    create,
    createWithGa4,
    update,
    merge,
    remove,
    fetchDetail,
    mountDataSource,
    unmountDataSource,
  }
}
