/* ===========================================================
   useAccountTitle - 页面标题账号标识
   职责: 给登录态页面标题追加当前账号, 方便多窗口区分身份
   设计: 页面只给业务标题, 账号统一来自 userStore 单一真相源
   =========================================================== */

export function useAccountTitle(baseTitle) {

  const userStore = useUserStore()

  /* ---- 当前账号: 邮箱最稳定, 无邮箱时退回显示名 ---- */
  const accountLabel = computed(() => {
    if (!userStore.isLoggedIn) return ''
    return String(userStore.user?.email || userStore.displayName || '').trim()
  })

  /* ---- 完整标题: 未登录不追加, 避免公共页泄露空身份噪音 ---- */
  const title = computed(() => {
    const rawBase = typeof baseTitle === 'function' ? baseTitle() : unref(baseTitle)
    const base = String(rawBase || '').trim()
    if (!base || !accountLabel.value) return base
    return `${base} · ${accountLabel.value}`
  })

  return title
}
