/* ===========================================================
 * 单管理员认证
 * =========================================================== */

export function useAuth() {
  const userStore = useUserStore()
  const isLoggedIn = computed(() => userStore.isLoggedIn)
  const user = computed(() => userStore.user)

  async function login(email, password) {
    const res = await $fetch('/api/auth/login-password', {
      method: 'POST',
      credentials: 'same-origin',
      body: { email, password },
    })
    if (res?.code !== 200 || !res?.data) {
      throw new Error(res?.msg || 'invalid_credentials')
    }
    userStore.setUser(res.data)
    return res.data
  }

  async function initialize(email, password, passwordConfirmation) {
    const res = await $fetch('/api/setup/initialize', {
      method: 'POST',
      credentials: 'same-origin',
      body: {
        email,
        password,
        password_confirmation: passwordConfirmation,
      },
    })
    if (res?.code !== 200 || !res?.data) {
      throw new Error(res?.msg || 'initialization_failed')
    }
    userStore.setUser(res.data)
    return res.data
  }

  async function logout() {
    try {
      await $fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
    } finally {
      userStore.clearUser()
      await navigateTo('/')
    }
  }

  async function refreshUser() {
    try {
      const res = await $fetch('/api/user/info', { credentials: 'same-origin' })
      if (res?.success && res?.data) userStore.setUser(res.data)
      else userStore.clearUser()
    } catch {
      userStore.clearUser()
    }
  }

  return { isLoggedIn, user, login, initialize, logout, refreshUser }
}
