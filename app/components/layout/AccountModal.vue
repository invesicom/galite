<script setup>
/* ===========================================================
   AccountModal - 账号设置弹窗
   --
   单机版保留实例设置、公开主页和 API key 管理。
   管理员密码、Google OAuth 与可选规范域名经服务端写入 D1。
   =========================================================== */

const props = defineProps({
  visible: { type: Boolean, default: false },
  initialTab: { type: String, default: 'general' },
})

const emit = defineEmits(['close'])

const { t } = useI18n()
const { isLoggedIn, refreshUser } = useAuth()
const userStore = useUserStore()
const configStore = useConfigStore()
const { show: showToast } = useToast()
const notifySuccess = (msg) => showToast(msg, { type: 'success' })
const notifyError   = (msg) => showToast(msg, { type: 'error' })
const api = useApi()
const { productLinks } = useAppConfig()

/* ---- 开源项目信息: 产品名与云端保持一致, 仓库名独立 ---- */
const PROJECT_INFO = Object.freeze({
  name: 'GA Lite',
  repositoryUrl: productLinks.repository,
  repositoryLabel: productLinks.repository.replace(/^https?:\/\//, '').replace(/\/$/, ''),
  websiteUrl: productLinks.hosted,
  websiteLabel: productLinks.hosted.replace(/^https?:\/\//, '').replace(/\/$/, ''),
  license: 'AGPL-3.0',
})

/* ===========================================================
   tab 切换
   =========================================================== */
const TABS = [
  { id: 'general',  labelKey: 'account.tabs.general',  icon: 'ri:settings-3-line' },
  { id: 'google',   labelKey: 'account.tabs.google',   icon: 'ri:google-fill' },
  { id: 'domain',   labelKey: 'account.domain.title',  icon: 'ri:links-line' },
  { id: 'password', labelKey: 'login.password_label',  icon: 'ri:lock-password-line' },
  { id: 'public',   labelKey: 'account.tabs.public',    icon: 'ri:global-line' },
  { id: 'api_keys', labelKey: 'account.tabs.api_keys', icon: 'ri:key-2-line' },
]
const activeTab = ref('general')
const mobileTabsRef = ref(null)
function normalizeTab(tab) {
  return TABS.some((item) => item.id === tab) ? tab : 'general'
}
function tabLabel(tab) {
  const key = tab?.labelKey || ''
  return key.includes('.') ? t(key) : key
}
const activeTabTitle = computed(() => tabLabel(TABS.find((x) => x.id === activeTab.value)))

function setActiveTab(tab) {
  activeTab.value = normalizeTab(tab)
}

watch(activeTab, async () => {
  await nextTick()
  mobileTabsRef.value
    ?.querySelector(`[data-account-tab="${activeTab.value}"]`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
})

/* ===========================================================
   单实例设置
   =========================================================== */
const instanceSettings = ref(null)
const settingsLoading = ref(false)
const googleClientId = ref('')
const googleClientSecret = ref('')
const customOrigin = ref('')
const currentPassword = ref('')
const nextPassword = ref('')
const passwordConfirmation = ref('')
const savingGoogle = ref(false)
const savingDomain = ref(false)
const savingPassword = ref(false)

function applyInstanceSettings(settings) {
  instanceSettings.value = settings || {}
  googleClientId.value = String(settings?.google_client_id || '')
  googleClientSecret.value = ''
  customOrigin.value = String(settings?.custom_origin || '')
}

async function fetchInstanceSettings() {
  if (!isLoggedIn.value || settingsLoading.value) return
  settingsLoading.value = true
  try {
    const res = await api.get('/api/user/settings')
    if (res?.code === 200) applyInstanceSettings(res.data)
  } catch (error) {
    if (!error?.silent) notifyError(t('common.request_failed'))
  } finally {
    settingsLoading.value = false
  }
}

async function saveGoogleOauth() {
  if (!googleClientId.value.trim() || savingGoogle.value) return
  savingGoogle.value = true
  try {
    const res = await api.post('/api/user/settings/google-oauth', {
      client_id: googleClientId.value,
      client_secret: googleClientSecret.value,
    })
    if (res?.code !== 200) throw new Error(res?.msg || 'save_failed')
    configStore.unchanged.google_oauth_configured = true
    notifySuccess(t('account.google.save_success'))
    await fetchInstanceSettings()
  } catch (error) {
    notifyError(error?.message === 'google_client_secret_required'
      ? t('account.google.secret_required')
      : t('common.request_failed'))
  } finally {
    savingGoogle.value = false
  }
}

async function saveCustomOrigin() {
  if (savingDomain.value) return
  savingDomain.value = true
  try {
    const res = await api.post('/api/user/settings/domain', {
      custom_origin: customOrigin.value,
    })
    if (res?.code !== 200) throw new Error(res?.msg || 'save_failed')
    applyInstanceSettings({ ...instanceSettings.value, ...res.data })
    configStore.unchanged.site_url = res.data.effective_origin
    notifySuccess(t('account.domain.save_success'))
  } catch {
    notifyError(t('account.domain.invalid'))
  } finally {
    savingDomain.value = false
  }
}

async function changePassword() {
  if (savingPassword.value) return
  if (nextPassword.value.length < 8) return notifyError(t('account.password.too_short'))
  if (nextPassword.value !== passwordConfirmation.value) {
    return notifyError(t('account.password.mismatch'))
  }
  savingPassword.value = true
  try {
    const res = await api.post('/api/user/settings/password', {
      current_password: currentPassword.value,
      new_password: nextPassword.value,
      password_confirmation: passwordConfirmation.value,
    })
    if (res?.code !== 200) throw new Error(res?.msg || 'save_failed')
    currentPassword.value = ''
    nextPassword.value = ''
    passwordConfirmation.value = ''
    notifySuccess(t('account.password.save_success'))
  } catch (error) {
    notifyError(error?.message === 'invalid_current_password'
      ? t('account.password.current_invalid')
      : t('account.password.save_failed'))
  } finally {
    savingPassword.value = false
  }
}

/* ===========================================================
   API Keys
   =========================================================== */
const apiKeys           = ref([])
const createKeyOpen     = ref(false)
const newKeyName        = ref('')
const creatingKey       = ref(false)

async function fetchKeys() {
  if (!isLoggedIn.value) return
  try {
    const res = await api.get('/api/user/api-keys/list')
    if (res?.code === 200) apiKeys.value = res.data || []
  } catch { /* useApi 已统一处理 */ }
}

async function copyKey(key) {
  try {
    await navigator.clipboard.writeText(key)
    notifySuccess(t('account.api_keys.copied'))
  } catch {
    notifyError(t('account.api_keys.copy_failed'))
  }
}

function formatTime(ts) {
  if (!ts) return ''
  return new Date(ts * 1000).toLocaleString()
}

async function createKey() {
  const name = newKeyName.value.trim()
  if (!name || creatingKey.value) return
  creatingKey.value = true
  try {
    const res = await api.post('/api/user/api-keys/create', { key_name: name })
    if (res?.code === 200) {
      notifySuccess(t('account.api_keys.create_success'))
      newKeyName.value = ''
      createKeyOpen.value = false
      await fetchKeys()
    } else {
      notifyError(res?.msg || t('account.api_keys.create_failed'))
    }
  } catch (err) {
    notifyError(err?.message || t('account.api_keys.create_failed'))
  } finally {
    creatingKey.value = false
  }
}

/* ---- 删除 API key 二次确认: 自定义弹窗替代浏览器 confirm() ---- */
const deletingKey = ref(null)
const deletingKeyPending = ref(false)

function askDelete(row) {
  deletingKey.value = row
}

async function confirmDeleteKey() {
  if (!deletingKey.value || deletingKeyPending.value) return
  deletingKeyPending.value = true
  try {
    const res = await api.post('/api/user/api-keys/delete', { id: deletingKey.value.id })
    if (res?.code === 200) {
      notifySuccess(t('account.api_keys.delete_success'))
      deletingKey.value = null
      await fetchKeys()
    } else {
      notifyError(res?.msg || t('account.api_keys.delete_failed'))
    }
  } catch (err) {
    notifyError(err?.message || t('account.api_keys.delete_failed'))
  } finally {
    deletingKeyPending.value = false
  }
}

/* ===========================================================
   生命周期: 打开时刷新一次
   =========================================================== */
watch(() => props.initialTab, (tab) => {
  if (props.visible) activeTab.value = normalizeTab(tab)
})

watch(() => props.visible, async (v) => {
  if (!v) return
  activeTab.value = normalizeTab(props.initialTab)
  if (isLoggedIn.value) {
    await refreshUser()
    await Promise.all([fetchKeys(), fetchInstanceSettings()])
  }
})

/* ---- ESC 关闭 ---- */
function onKeydown(e) { if (e.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="visible"
        class="fixed inset-0 z-[70] flex items-center justify-center bg-black/20 p-4 backdrop-blur-[3px]"
      >
        <div class="relative flex h-full max-h-[640px] w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-xl">

          <!-- ============ 左侧 tab ============ -->
          <aside class="hidden w-56 shrink-0 flex-col border-r border-gray-100 bg-gray-50/80 p-3 sm:flex">
            <nav class="flex flex-col gap-1">
              <button
                v-for="tab in TABS"
                :key="tab.id"
                type="button"
                class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                :class="activeTab === tab.id
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:bg-white/70'"
                @click="setActiveTab(tab.id)"
              >
                <NuxtIcon :name="tab.icon" class="size-4 shrink-0" />
                <span>{{ tabLabel(tab) }}</span>
              </button>
            </nav>
          </aside>

          <!-- ============ 移动端顶栏 (sm 以下隐藏 sidebar) ============ -->
          <div class="flex flex-1 flex-col">
            <header class="border-b border-gray-100 px-5 py-3 sm:px-8 sm:py-4">
              <div class="flex items-center justify-between gap-3">
                <h2 class="text-lg font-bold text-gray-900 sm:hidden">
                  {{ t('common.settings') }}
                </h2>
                <h2 class="hidden text-lg font-bold text-gray-900 sm:block">
                  {{ activeTabTitle }}
                </h2>
                <button
                  class="flex size-8 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  :aria-label="t('common.close')"
                  @click="emit('close')"
                >
                  <svg class="size-5" viewBox="0 0 24 24" fill="none">
                    <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                  </svg>
                </button>
              </div>

              <nav
                ref="mobileTabsRef"
                class="-mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:hidden"
                role="tablist"
                :aria-label="t('common.settings')"
              >
                <button
                  v-for="tab in TABS"
                  :key="tab.id"
                  type="button"
                  role="tab"
                  :data-account-tab="tab.id"
                  :aria-selected="activeTab === tab.id ? 'true' : 'false'"
                  class="flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors"
                  :class="activeTab === tab.id
                    ? 'border-gray-900 bg-gray-900 text-white'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-900'"
                  @click="setActiveTab(tab.id)"
                >
                  <NuxtIcon :name="tab.icon" class="size-4 shrink-0" />
                  <span class="whitespace-nowrap">{{ tabLabel(tab) }}</span>
                </button>
              </nav>
            </header>

            <!-- ============ 内容区 ============ -->
            <div class="flex-1 overflow-y-auto px-5 py-5 sm:px-8 sm:py-6">

              <!-- ============ 常规: 单机管理员信息 ============ -->
              <div v-if="activeTab === 'general'" class="space-y-6">
                <!-- 个人信息 -->
                <section>
                  <h3 class="text-sm font-semibold text-gray-900">{{ t('account.general.profile_title') }}</h3>
                  <div class="mt-3 flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4">
                    <img
                      v-if="userStore.user?.photo_url"
                      :src="userStore.user.photo_url"
                      class="size-12 rounded-full object-cover"
                      alt=""
                    />
                    <div
                      v-else
                      class="flex size-12 items-center justify-center rounded-full bg-gray-100 text-gray-400"
                    >
                      <NuxtIcon name="ri:user-3-line" class="size-6" />
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-sm font-medium text-gray-900">{{ userStore.displayName }}</div>
                      <div class="truncate text-xs text-gray-600">{{ userStore.user?.email }}</div>
                    </div>
                  </div>
                </section>

                <!-- 开源项目 -->
                <section>
                  <h3 class="text-sm font-semibold text-gray-900">{{ t('account.general.project_title') }}</h3>
                  <div class="mt-3 rounded-xl border border-gray-200 bg-white p-4">
                    <div class="flex flex-wrap items-center gap-2">
                      <div class="text-base font-semibold text-gray-900">{{ PROJECT_INFO.name }}</div>
                      <span class="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                        {{ PROJECT_INFO.license }}
                      </span>
                    </div>
                    <p class="mt-1 text-sm leading-5 text-gray-600">
                      {{ t('account.general.project_description') }}
                    </p>

                    <div class="mt-4 space-y-3 border-t border-gray-100 pt-3">
                      <a
                        :href="PROJECT_INFO.repositoryUrl"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="flex items-center gap-3 text-sm transition-colors hover:text-primary"
                      >
                        <NuxtIcon name="ri:github-fill" class="size-5 shrink-0 text-gray-700" />
                        <span class="min-w-0 flex-1">
                          <span class="block font-medium text-gray-900">{{ t('account.general.repository') }}</span>
                          <span dir="ltr" class="block truncate text-xs text-gray-500">{{ PROJECT_INFO.repositoryLabel }}</span>
                        </span>
                        <NuxtIcon name="ri:external-link-line" class="size-4 shrink-0 text-gray-400" />
                      </a>
                      <a
                        :href="PROJECT_INFO.websiteUrl"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="flex items-center gap-3 text-sm transition-colors hover:text-primary"
                      >
                        <NuxtIcon name="ri:global-line" class="size-5 shrink-0 text-gray-700" />
                        <span class="min-w-0 flex-1">
                          <span class="block font-medium text-gray-900">GA Lite</span>
                          <span dir="ltr" class="block truncate text-xs text-gray-500">{{ PROJECT_INFO.websiteLabel }}</span>
                        </span>
                        <NuxtIcon name="ri:external-link-line" class="size-4 shrink-0 text-gray-400" />
                      </a>
                    </div>
                  </div>
                </section>
              </div>

              <!-- ============ 自定义域名 ============ -->
              <div v-else-if="activeTab === 'domain'" class="space-y-5">
                <section>
                  <h3 class="text-sm font-semibold text-gray-900">{{ t('account.domain.title') }}</h3>
                  <p class="mt-1 text-sm text-gray-600">{{ t('account.domain.description') }}</p>
                  <div class="mt-5 space-y-3">
                    <label class="block">
                      <span class="text-xs font-medium text-gray-700">{{ t('account.domain.label') }}</span>
                      <input
                        v-model="customOrigin"
                        type="url"
                        inputmode="url"
                        dir="ltr"
                        class="mt-1.5 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary"
                        placeholder="https://analytics.example.com"
                      />
                    </label>
                    <p class="text-xs leading-5 text-gray-500">
                      {{ t('account.domain.automatic', { origin: instanceSettings?.effective_origin || '' }) }}
                    </p>
                    <div class="flex justify-end pt-1">
                      <button
                        type="button"
                        class="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-text hover:opacity-90 disabled:opacity-50"
                        :disabled="savingDomain"
                        @click="saveCustomOrigin"
                      >
                        {{ savingDomain ? t('common.saving') : t('common.save') }}
                      </button>
                    </div>
                  </div>
                </section>
              </div>

              <!-- ============ 修改登录密码 ============ -->
              <div v-else-if="activeTab === 'password'" class="space-y-5">
                <section>
                  <h3 class="text-sm font-semibold text-gray-900">{{ t('account.password.change_title') }}</h3>
                  <p class="mt-1 text-sm text-gray-600">{{ t('account.password.change_desc') }}</p>
                  <form class="mt-5 space-y-3" @submit.prevent="changePassword">
                    <label class="block">
                      <span class="text-xs font-medium text-gray-700">{{ t('account.password.current_password') }}</span>
                      <input
                        v-model="currentPassword"
                        type="password"
                        autocomplete="current-password"
                        required
                        class="mt-1.5 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary"
                        :placeholder="t('login.password_placeholder')"
                      />
                    </label>
                    <div class="grid gap-3 sm:grid-cols-2">
                      <label class="block">
                        <span class="text-xs font-medium text-gray-700">{{ t('account.password.new_password') }}</span>
                        <input
                          v-model="nextPassword"
                          type="password"
                          autocomplete="new-password"
                          required
                          class="mt-1.5 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary"
                          :placeholder="t('account.password.placeholder_new')"
                        />
                      </label>
                      <label class="block">
                        <span class="text-xs font-medium text-gray-700">{{ t('account.password.confirm_password') }}</span>
                        <input
                          v-model="passwordConfirmation"
                          type="password"
                          autocomplete="new-password"
                          required
                          class="mt-1.5 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary"
                          :placeholder="t('account.password.placeholder_confirm')"
                        />
                      </label>
                    </div>
                    <div class="flex justify-end pt-1">
                      <button
                        type="submit"
                        class="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-text hover:opacity-90 disabled:opacity-50"
                        :disabled="savingPassword || !currentPassword || !nextPassword || !passwordConfirmation"
                      >
                        {{ savingPassword ? t('account.password.saving') : t('account.password.save') }}
                      </button>
                    </div>
                  </form>
                </section>
              </div>

              <!-- ============ Google OAuth ============ -->
              <div v-else-if="activeTab === 'google'" class="space-y-5">
                <div v-if="settingsLoading" class="py-10 text-center text-sm text-gray-500">
                  {{ t('common.loading') }}
                </div>
                <template v-else>
                  <section>
                    <div class="flex items-start justify-between gap-3">
                      <div>
                        <h3 class="text-sm font-semibold text-gray-900">Google OAuth</h3>
                        <p class="mt-1 text-sm leading-5 text-gray-600">{{ t('account.google.description') }}</p>
                      </div>
                      <span
                        class="shrink-0 rounded-full px-2.5 py-1 text-xs font-medium"
                        :class="instanceSettings?.google_oauth_configured
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-amber-50 text-amber-700'"
                      >
                        {{ instanceSettings?.google_oauth_configured
                          ? t('account.google.configured')
                          : t('account.google.not_configured') }}
                      </span>
                    </div>

                    <form class="mt-4 space-y-4 rounded-xl border border-gray-200 bg-white p-4" @submit.prevent="saveGoogleOauth">
                      <label class="block">
                        <span class="text-xs font-medium text-gray-700">Google Client ID</span>
                        <input
                          v-model="googleClientId"
                          type="text"
                          dir="ltr"
                          autocomplete="off"
                          required
                          class="mt-1.5 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary"
                          placeholder="000000000000-xxxx.apps.googleusercontent.com"
                        />
                      </label>
                      <label class="block">
                        <span class="text-xs font-medium text-gray-700">Google Client Secret</span>
                        <input
                          v-model="googleClientSecret"
                          type="password"
                          dir="ltr"
                          autocomplete="new-password"
                          class="mt-1.5 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary"
                          :placeholder="instanceSettings?.google_client_secret_configured
                            ? t('account.google.secret_keep')
                            : t('account.google.secret_required')"
                        />
                      </label>
                      <p class="text-xs leading-5 text-gray-500">{{ t('account.google.reconnect_notice') }}</p>
                      <div class="flex justify-end">
                        <button
                          type="submit"
                          class="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-text hover:opacity-90 disabled:opacity-50"
                          :disabled="savingGoogle || !googleClientId.trim()"
                        >
                          {{ savingGoogle ? t('common.saving') : t('common.save') }}
                        </button>
                      </div>
                    </form>
                  </section>

                  <section>
                    <h3 class="text-sm font-semibold text-gray-900">{{ t('account.google.origin_title') }}</h3>
                    <p class="mt-1 text-sm text-gray-600">{{ t('account.google.origin_description') }}</p>
                    <div class="mt-3 space-y-2">
                      <code
                        v-for="origin in instanceSettings?.google_javascript_origins || []"
                        :key="origin"
                        dir="ltr"
                        class="block overflow-x-auto rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-700"
                      >{{ origin }}</code>
                    </div>
                  </section>

                  <section>
                    <h3 class="text-sm font-semibold text-gray-900">{{ t('account.google.redirect_title') }}</h3>
                    <p class="mt-1 text-sm text-gray-600">{{ t('account.google.redirect_description') }}</p>
                    <div class="mt-3 space-y-2">
                      <code
                        v-for="uri in instanceSettings?.google_redirect_uris || []"
                        :key="uri"
                        dir="ltr"
                        class="block overflow-x-auto rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-700"
                      >{{ uri }}</code>
                    </div>
                  </section>
                </template>
              </div>

              <!-- ============ Public Profile ============ -->
              <div v-else-if="activeTab === 'public'" class="space-y-5">
                <PublicProfileSettings />
              </div>

              <!-- ============ API Keys (独立 tab) ============ -->
              <div v-else-if="activeTab === 'api_keys'" class="space-y-5">
                <section>
                  <div class="flex items-start justify-between">
                    <div>
                      <h3 class="text-sm font-semibold text-gray-900">{{ t('account.api_keys.title') }}</h3>
                      <p class="mt-1 text-sm text-gray-600">{{ t('account.api_keys.subtitle') }}</p>
                    </div>
                    <button
                      type="button"
                      class="shrink-0 rounded-full border border-primary px-3 py-1 text-sm font-medium text-primary hover:bg-primary/5"
                      @click="createKeyOpen = true"
                    >
                      + {{ t('account.api_keys.create') }}
                    </button>
                  </div>
                  <div class="mt-3 rounded-xl border border-gray-200 bg-white">
                    <div v-if="!apiKeys.length" class="px-4 py-6 text-center text-sm text-gray-500">
                      {{ t('account.api_keys.empty') }}
                    </div>
                    <ul v-else class="divide-y divide-gray-100">
                      <li
                        v-for="row in apiKeys"
                        :key="row.id"
                        class="flex items-center justify-between gap-3 px-4 py-3"
                      >
                        <div class="min-w-0 flex-1">
                          <div class="text-sm font-medium text-gray-900">{{ row.key_name }}</div>
                          <div class="mt-1 flex flex-wrap items-center gap-2">
                            <code class="break-all rounded bg-gray-50 px-2 py-0.5 font-mono text-xs text-gray-700">
                              {{ row.api_key }}
                            </code>
                            <button class="text-xs text-gray-500 hover:text-gray-800" @click="copyKey(row.api_key)">
                              {{ t('account.api_keys.copy') }}
                            </button>
                          </div>
                          <div class="mt-1 text-xs text-gray-500">
                            {{ t('account.api_keys.last_used') }}:
                            {{ row.last_used_at ? formatTime(row.last_used_at) : t('account.api_keys.never_used') }}
                          </div>
                        </div>
                        <button
                          type="button"
                          class="shrink-0 rounded px-3 py-1 text-sm text-red-600 hover:bg-red-50"
                          @click="askDelete(row)"
                        >
                          {{ t('account.api_keys.delete') }}
                        </button>
                      </li>
                    </ul>
                  </div>
                </section>
              </div>

            </div>
          </div>
        </div>

        <!-- ============ 创建 API key ============ -->
        <Teleport to="body">
          <Transition name="modal-fade">
            <div
              v-if="createKeyOpen"
              class="fixed inset-0 z-[80] flex items-center justify-center bg-black/20 p-4 backdrop-blur-[3px]"
              @click.self="createKeyOpen = false"
            >
              <div class="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
                <h3 class="text-lg font-bold text-gray-900">{{ t('account.api_keys.create_title') }}</h3>
                <p class="mt-2 text-sm text-gray-500">{{ t('account.api_keys.create_desc') }}</p>
                <input
                  v-model="newKeyName"
                  type="text"
                  class="mt-4 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none"
                  :placeholder="t('account.api_keys.name_placeholder')"
                  maxlength="50"
                />
                <div class="mt-6 flex items-center justify-end gap-2">
                  <button
                    class="rounded-full px-4 py-1.5 text-sm text-gray-500 hover:bg-gray-50"
                    @click="createKeyOpen = false"
                  >
                    {{ t('common.cancel') }}
                  </button>
                  <button
                    class="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                    :disabled="!newKeyName.trim() || creatingKey"
                    @click="createKey"
                  >
                    {{ creatingKey ? t('account.api_keys.creating') : t('account.api_keys.confirm_create') }}
                  </button>
                </div>
              </div>
            </div>
          </Transition>
        </Teleport>

        <!-- ============ 删除 API key 二次确认 ============ -->
        <Teleport to="body">
          <Transition name="modal-fade">
            <div
              v-if="deletingKey"
              class="fixed inset-0 z-[80] flex items-center justify-center bg-black/20 p-4 backdrop-blur-[3px]"
              @click.self="deletingKey = null"
            >
              <div class="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
                <h3 class="text-lg font-bold text-red-600">{{ t('account.api_keys.delete') }}</h3>
                <p class="mt-2 text-sm text-gray-500">
                  {{ t('account.api_keys.delete_confirm', { name: deletingKey.key_name }) }}
                </p>
                <div class="mt-6 flex items-center justify-end gap-2">
                  <button
                    class="rounded-full px-4 py-1.5 text-sm text-gray-500 hover:bg-gray-50"
                    @click="deletingKey = null"
                  >
                    {{ t('common.cancel') }}
                  </button>
                  <button
                    class="rounded-full bg-red-500 px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                    :disabled="deletingKeyPending"
                    @click="confirmDeleteKey"
                  >
                    {{ t('common.delete') }}
                  </button>
                </div>
              </div>
            </div>
          </Transition>
        </Teleport>

      </div>
    </Transition>
  </Teleport>
</template>
