<template>
  <div class="space-y-6">
    <section v-if="loading" class="p-6">
      <div class="mx-auto flex max-w-xl flex-col items-center">
        <div class="size-24 animate-pulse rounded-full bg-gray-100" />
        <div class="mt-5 h-4 w-44 animate-pulse rounded bg-gray-100" />
        <div class="mt-3 h-3 w-64 animate-pulse rounded bg-gray-100" />
        <div class="mt-5 flex items-center gap-2">
          <span v-for="item in socialPlatforms" :key="item.key" class="size-9 animate-pulse rounded-full bg-gray-100" />
        </div>
      </div>
    </section>

    <section v-else-if="!form.enabled" class="p-6">
      <div class="mx-auto flex max-w-xl flex-col items-center text-center">
        <div class="flex size-24 items-center justify-center rounded-full bg-gray-100 text-gray-300">
          <NuxtIcon name="ri:user-3-line" class="size-12" />
        </div>
        <div class="mt-5 h-4 w-44 rounded bg-gray-100" />
        <div class="mt-3 h-3 w-64 max-w-full rounded bg-gray-100" />
        <div class="mt-5 flex flex-wrap items-center justify-center gap-2">
          <span
            v-for="item in socialPlatforms"
            :key="item.key"
            class="flex size-9 items-center justify-center rounded-full bg-gray-50 text-gray-300"
          >
            <NuxtIcon :name="item.icon" class="size-4" />
          </span>
        </div>
        <button
          type="button"
          class="mt-7 rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-text hover:opacity-90 disabled:opacity-50"
          :disabled="enabling || saving"
          @click="enableProfile"
        >
          {{ enabling || saving ? t('account.public_profile.enabling') : t('account.public_profile.enable') }}
        </button>
      </div>
    </section>

    <section v-else class="mx-auto max-w-2xl space-y-7 px-1">
      <div class="flex flex-col items-center">
        <div class="relative flex size-28 items-center justify-center">
          <span class="flex size-28 items-center justify-center overflow-hidden rounded-full bg-gray-100 text-gray-500">
            <NuxtIcon name="ri:user-3-line" class="size-12 text-gray-400" />
          </span>
        </div>

        <div class="mt-5 flex flex-wrap items-center justify-center gap-2">
          <button
            v-for="item in socialPlatforms"
            :key="item.key"
            type="button"
            :class="[
              'flex size-9 items-center justify-center rounded-full transition-colors',
              socialLinked(item) ? 'bg-gray-50' : 'bg-gray-50 text-gray-400 hover:text-gray-700',
            ]"
            :style="socialStyle(item)"
            :aria-label="t('account.public_profile.edit_social', { platform: platformLabel(item) })"
            @click="openSocialEditor(item)"
          >
            <NuxtIcon :name="item.icon" class="size-4" />
          </button>
        </div>
      </div>

      <div class="space-y-5">
        <div>
          <div class="mb-1.5 flex items-center justify-between gap-3">
            <label for="public-display-name" class="text-sm font-medium text-gray-500">{{ t('account.public_profile.display_name') }}</label>
            <NuxtLink
              v-if="profileUrl"
              :to="profileUrl"
              target="_blank"
              class="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
            >
              {{ t('account.public_profile.view_profile') }}
              <NuxtIcon name="ri:external-link-line" class="size-4" />
            </NuxtLink>
          </div>
          <input
            id="public-display-name"
            v-model="form.display_name"
            type="text"
            maxlength="255"
            class="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-primary focus:outline-none"
          />
        </div>

        <div>
          <div class="mb-1.5 flex items-center justify-between gap-3">
            <label for="public-bio" class="text-sm font-medium text-gray-500">{{ t('account.public_profile.bio') }}</label>
            <button
              v-if="profileTextDirty"
              type="button"
              class="text-sm font-medium text-primary hover:opacity-80 disabled:opacity-50"
              :disabled="saving"
              @click="saveProfileText"
            >
              {{ saving ? t('account.public_profile.saving') : t('account.public_profile.save') }}
            </button>
          </div>
          <textarea
            id="public-bio"
            v-model="form.bio"
            rows="3"
            maxlength="2000"
            class="w-full resize-none rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-primary focus:outline-none"
          />
        </div>

        <div class="divide-y divide-gray-100">
          <div class="flex w-full items-center justify-between gap-4 py-4">
            <div class="min-w-0">
              <div class="text-sm font-medium text-gray-900">{{ t('account.public_profile.username') }}</div>
              <div class="mt-1 truncate text-sm text-gray-500">@{{ form.slug }}</div>
            </div>
            <button
              type="button"
              class="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900"
              @click="openUsernameEditor"
            >
              <NuxtIcon name="ri:edit-line" class="size-4" />
              {{ t('account.public_profile.change') }}
            </button>
          </div>

          <div class="flex w-full items-center justify-between gap-4 py-4">
            <div class="min-w-0">
              <div class="flex items-center gap-1.5 text-sm font-medium text-gray-900">
                <span>{{ t('account.public_profile.data_visibility') }}</span>
                <button
                  type="button"
                  class="inline-flex size-4 items-center justify-center rounded-full text-gray-400 hover:text-gray-700"
                  :aria-label="t('account.public_profile.visibility_help_label')"
                  v-tooltip.bottom="visibilityHelp"
                >
                  <NuxtIcon name="ri:question-line" class="size-3.5" />
                </button>
              </div>
              <div class="mt-1 text-sm text-gray-500">{{ visibilityLabel(form.visibility_mode) }}</div>
            </div>
            <button
              type="button"
              class="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900"
              @click="openVisibilityEditor"
            >
              <NuxtIcon name="ri:edit-line" class="size-4" />
              {{ t('account.public_profile.change') }}
            </button>
          </div>

          <div class="flex w-full items-center justify-between gap-4 py-4">
            <div class="min-w-0">
              <div class="flex items-center gap-1.5 text-sm font-medium text-gray-900">
                <span>{{ t('account.public_profile.branding') }}</span>
                <button
                  type="button"
                  class="inline-flex size-4 items-center justify-center rounded-full text-gray-400 hover:text-gray-700"
                  :aria-label="t('account.public_profile.branding_help_label')"
                  v-tooltip.bottom="t('account.public_profile.branding_help')"
                >
                  <NuxtIcon name="ri:question-line" class="size-3.5" />
                </button>
              </div>
              <div class="mt-1 text-sm text-gray-500">{{ brandingLabel }}</div>
            </div>
            <button
              type="button"
              role="switch"
              :aria-checked="form.show_branding ? 'true' : 'false'"
              :class="[
                'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
                form.show_branding ? 'bg-primary' : 'bg-gray-200',
              ]"
              :disabled="saving"
              @click="toggleBranding"
            >
              <span
                :class="[
                  'inline-block size-5 rounded-full bg-white transition-transform',
                  form.show_branding ? 'translate-x-[18px]' : 'translate-x-0.5',
                ]"
              />
            </button>
          </div>
        </div>

        <div class="pt-2">
          <button
            type="button"
            class="flex w-full items-center justify-center rounded-lg border border-red-200 px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            :disabled="saving"
            @click="disableConfirmOpen = true"
          >
            {{ t('account.public_profile.disable') }}
          </button>
        </div>
      </div>
    </section>

    <Teleport to="body">
      <div
        v-if="activeSocialConfig"
        class="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 p-4 backdrop-blur-[3px]"
        @click.self="closeSocialEditor"
      >
        <section class="w-full max-w-sm rounded-xl bg-white p-5">
          <div class="flex items-center gap-3">
            <span
              class="flex size-10 items-center justify-center rounded-full bg-gray-50"
              :style="{ color: activeSocialConfig.color }"
            >
              <NuxtIcon :name="activeSocialConfig.icon" class="size-5" />
            </span>
            <div>
              <h3 class="text-sm font-semibold text-gray-900">{{ activeSocialLabel }}</h3>
              <p class="text-xs text-gray-500">{{ activeSocialPlaceholder }}</p>
            </div>
          </div>

          <input
            v-model="socialDraft"
            type="url"
            class="mt-4 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-primary focus:outline-none"
            :placeholder="activeSocialPlaceholder"
            @keyup.enter="saveSocialLink"
          />
          <p v-if="socialError" class="mt-2 text-xs text-red-500">{{ socialError }}</p>

          <div
            :class="[
              'mt-5 flex items-center gap-3',
              socialCanRemove ? 'justify-between' : 'justify-end',
            ]"
          >
            <button
              v-if="socialCanRemove"
              type="button"
              class="text-sm font-medium text-gray-500 hover:text-red-500"
              @click="clearSocialLink"
            >
              {{ t('account.public_profile.remove') }}
            </button>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="rounded-full px-4 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
                @click="closeSocialEditor"
              >
                {{ t('account.public_profile.cancel') }}
              </button>
              <button
                type="button"
                :class="[
                  'rounded-full px-4 py-1.5 text-sm font-medium disabled:opacity-50',
                  socialSaveLocked
                    ? 'bg-gray-900 text-white hover:bg-gray-800'
                    : 'bg-primary text-primary-text hover:opacity-90',
                ]"
                :disabled="socialSaving || saving"
                @click="saveSocialLink"
              >
                {{ socialSaving ? t('account.public_profile.saving') : socialSaveLabel }}
              </button>
            </div>
          </div>
        </section>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="usernameOpen"
        class="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 p-4 backdrop-blur-[3px]"
        @click.self="usernameOpen = false"
      >
        <section class="w-full max-w-sm rounded-xl bg-white p-5">
          <h3 class="text-base font-semibold text-gray-900">{{ t('account.public_profile.edit_username') }}</h3>
          <div class="mt-4 flex rounded-lg border border-gray-200 focus-within:border-primary">
            <span class="flex items-center border-r border-gray-200 px-3 text-sm text-gray-400">@</span>
            <input
              v-model="usernameDraft"
              type="text"
              maxlength="32"
              class="min-w-0 flex-1 rounded-r-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none"
              @keyup.enter="saveUsername"
            />
          </div>
          <div class="mt-5 flex justify-end gap-2">
            <button type="button" class="rounded-full px-4 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50" @click="usernameOpen = false">
              {{ t('account.public_profile.cancel') }}
            </button>
            <button
              type="button"
              class="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-text hover:opacity-90 disabled:opacity-50"
              :disabled="saving"
              @click="saveUsername"
            >
              {{ saving ? t('account.public_profile.saving') : t('account.public_profile.save') }}
            </button>
          </div>
        </section>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="visibilityOpen"
        class="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 p-4 backdrop-blur-[3px]"
        @click.self="visibilityOpen = false"
      >
        <section class="w-full max-w-sm rounded-xl bg-white p-5">
          <h3 class="text-base font-semibold text-gray-900">{{ t('account.public_profile.edit_visibility') }}</h3>
          <div class="mt-4 inline-flex w-full rounded-md bg-gray-100 p-0.5">
            <button
              v-for="item in modes"
              :key="item.value"
              type="button"
              :class="[
                'flex-1 rounded px-3 py-2 text-sm font-medium transition-colors',
                visibilityDraft === item.value ? 'bg-white text-gray-900' : 'text-gray-500 hover:text-gray-800',
              ]"
              @click="visibilityDraft = item.value"
            >
              {{ visibilityLabel(item.value) }}
            </button>
          </div>
          <div class="mt-5 flex justify-end gap-2">
            <button type="button" class="rounded-full px-4 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50" @click="visibilityOpen = false">
              {{ t('account.public_profile.cancel') }}
            </button>
            <button
              type="button"
              class="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-text hover:opacity-90 disabled:opacity-50"
              :disabled="saving"
              @click="saveVisibility"
            >
              {{ saving ? t('account.public_profile.saving') : t('account.public_profile.save') }}
            </button>
          </div>
        </section>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="disableConfirmOpen"
        class="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 p-4 backdrop-blur-[3px]"
        @click.self="disableConfirmOpen = false"
      >
        <section class="w-full max-w-sm rounded-xl bg-white p-5">
          <h3 class="text-base font-semibold text-red-600">{{ t('account.public_profile.disable_title') }}</h3>
          <p class="mt-2 text-sm leading-6 text-gray-500">{{ t('account.public_profile.disable_desc') }}</p>
          <div class="mt-5 flex justify-end gap-2">
            <button type="button" class="rounded-full px-4 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50" @click="disableConfirmOpen = false">
              {{ t('account.public_profile.cancel') }}
            </button>
            <button
              type="button"
              class="rounded-full bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              :disabled="saving"
              @click="disableProfile"
            >
              {{ saving ? t('account.public_profile.saving') : t('account.public_profile.confirm_disable') }}
            </button>
          </div>
        </section>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'

const api = useApi()
const { t } = useI18n()
const { show: showToast } = useToast()
const localePath = useLocalePath()
const userStore = useUserStore()

const modes = [
  { value: 'public' },
  { value: 'semi_public' },
  { value: 'hidden' },
]

const socialPlatforms = [
  { key: 'x', label: 'X', icon: 'ri:twitter-x-line', color: '#111827', hosts: ['x.com', 'twitter.com'], placeholder: 'https://x.com/username' },
  { key: 'threads', label: 'Threads', icon: 'ri:threads-line', color: '#111827', hosts: ['threads.net'], placeholder: 'https://threads.net/@username' },
  { key: 'instagram', label: 'Instagram', icon: 'ri:instagram-line', color: '#e4405f', hosts: ['instagram.com'], placeholder: 'https://instagram.com/username' },
  { key: 'facebook', label: 'Facebook', icon: 'ri:facebook-circle-line', color: '#1877f2', hosts: ['facebook.com', 'fb.com'], placeholder: 'https://facebook.com/username' },
  { key: 'youtube', label: 'YouTube', icon: 'ri:youtube-line', color: '#ff0000', hosts: ['youtube.com', 'youtu.be'], placeholder: 'https://youtube.com/@username' },
  { key: 'tiktok', label: 'TikTok / Douyin', icon: 'ri:tiktok-line', color: '#111827', hosts: ['tiktok.com', 'douyin.com'], placeholder: 'https://tiktok.com/@username' },
  { key: 'xiaohongshu', label: '小红书', icon: 'ri:book-open-line', color: '#ff2442', hosts: ['xiaohongshu.com', 'xhslink.com'], placeholder: 'https://www.xiaohongshu.com/user/profile/...' },
  { key: 'bilibili', label: 'Bilibili', icon: 'ri:bilibili-line', color: '#00a1d6', hosts: ['bilibili.com', 'b23.tv'], placeholder: 'https://space.bilibili.com/...' },
  { key: 'website', labelKey: 'account.public_profile.website', icon: 'ri:global-line', color: '#2563eb', placeholder: 'https://example.com' },
]

const profileErrorKeys = {
  invalid_slug: 'account.public_profile.error_invalid_slug',
  reserved_slug: 'account.public_profile.error_reserved_slug',
  slug_taken: 'account.public_profile.error_slug_taken',
  invalid_website_url: 'account.public_profile.error_invalid_website_url',
  invalid_visibility_mode: 'account.public_profile.error_invalid_visibility_mode',
}

const loading = ref(true)
const saving = ref(false)
const enabling = ref(false)
const socialSaving = ref(false)
const publicUrl = ref('')
const activeSocial = ref('')
const socialDraft = ref('')
const socialError = ref('')
const usernameOpen = ref(false)
const usernameDraft = ref('')
const visibilityOpen = ref(false)
const visibilityDraft = ref('semi_public')
const disableConfirmOpen = ref(false)

const savedText = reactive({
  display_name: '',
  bio: '',
})

const form = reactive({
  enabled: false,
  slug: '',
  display_name: '',
  bio: '',
  visibility_mode: 'semi_public',
  show_branding: true,
  social_links: {},
  website_url: '',
})

const activeSocialConfig = computed(() => {
  return socialPlatforms.find((item) => item.key === activeSocial.value) || null
})
const activeSocialLabel = computed(() => platformLabel(activeSocialConfig.value))
const activeSocialPlaceholder = computed(() => platformPlaceholder(activeSocialConfig.value))
const socialSaveLocked = computed(() => false)
const socialSaveLabel = computed(() => t('account.public_profile.save'))
const socialCanRemove = computed(() => {
  const platform = activeSocialConfig.value
  if (!platform) return false
  return platform.key === 'website'
    ? Boolean(form.website_url)
    : Boolean(form.social_links?.[platform.key])
})

const profileTextDirty = computed(() =>
  form.display_name !== savedText.display_name || form.bio !== savedText.bio,
)
const visibilityHelp = computed(() => [
  t('account.public_profile.visibility_public_help'),
  t('account.public_profile.visibility_semi_help'),
  t('account.public_profile.visibility_hidden_help'),
].join('\n'))
const profileUrl = computed(() => publicUrl.value ? localePath(publicUrl.value) : '')
const brandingLabel = computed(() =>
  form.show_branding
    ? t('account.public_profile.branding_shown')
    : t('account.public_profile.branding_hidden'),
)

function visibilityLabel(value) {
  if (value === 'public') return t('account.public_profile.visibility_public')
  if (value === 'hidden') return t('account.public_profile.visibility_hidden')
  return t('account.public_profile.visibility_semi')
}

function profileErrorMessage(code, fallbackKey) {
  const value = String(code || '').trim()
  const key = profileErrorKeys[value]
  if (key) return t(key)
  return value && !value.includes('_') ? value : t(fallbackKey)
}

function applyProfile(data) {
  const profile = data?.profile || {}
  form.enabled = Number(profile.status) === 1
  form.slug = profile.slug || ''
  form.display_name = profile.display_name || userStore.displayName || ''
  form.bio = profile.bio || ''
  form.visibility_mode = profile.visibility_mode || 'semi_public'
  form.show_branding = profile.show_branding !== false
  form.social_links = { ...(profile.social_links || {}) }
  form.website_url = profile.website_url || ''
  savedText.display_name = form.display_name
  savedText.bio = form.bio
  publicUrl.value = data?.public_url || publicUrl.value
}

async function loadSettings() {
  loading.value = true
  try {
    const res = await api.get('/api/profile/settings')
    if (res?.code === 200) applyProfile(res.data)
    else showToast(profileErrorMessage(res?.msg, 'account.public_profile.load_failed'), { type: 'error' })
  } catch (err) {
    showToast(profileErrorMessage(err?.data?.msg || err?.message, 'account.public_profile.load_failed'), { type: 'error' })
  } finally {
    loading.value = false
  }
}

function profilePayload() {
  return {
    enabled: form.enabled,
    slug: form.slug,
    display_name: form.display_name,
    bio: form.bio,
    visibility_mode: form.visibility_mode,
    show_branding: form.show_branding,
    social_links: form.social_links,
    website_url: form.website_url,
  }
}

async function persistProfile({ successKey = 'account.public_profile.profile_saved', silent = false } = {}) {
  if (saving.value) return false
  saving.value = true
  try {
    const res = await api.post('/api/profile/settings', profilePayload())
    if (res?.code !== 200) {
      showToast(profileErrorMessage(res?.msg, 'account.public_profile.save_failed'), { type: 'error' })
      return false
    }
    applyProfile(res.data)
    if (!silent) showToast(t(successKey), { type: 'success' })
    return true
  } catch (err) {
    showToast(profileErrorMessage(err?.data?.msg || err?.message, 'account.public_profile.save_failed'), { type: 'error' })
    return false
  } finally {
    saving.value = false
  }
}

async function enableProfile() {
  if (enabling.value || saving.value) return
  enabling.value = true
  const previous = form.enabled
  form.enabled = true
  const ok = await persistProfile({ successKey: 'account.public_profile.enabled' })
  if (!ok) form.enabled = previous
  enabling.value = false
}

async function disableProfile() {
  if (saving.value) return
  const previous = form.enabled
  form.enabled = false
  const ok = await persistProfile({ successKey: 'account.public_profile.disabled' })
  if (!ok) form.enabled = previous
  else disableConfirmOpen.value = false
}

async function saveProfileText() {
  await persistProfile({ successKey: 'account.public_profile.profile_saved' })
}

function socialLinked(item) {
  if (item.key === 'website') return !!form.website_url
  return !!form.social_links?.[item.key]
}

function socialStyle(item) {
  return socialLinked(item) ? { color: item.color } : {}
}

function openSocialEditor(item) {
  activeSocial.value = item.key
  socialDraft.value = item.key === 'website'
    ? form.website_url || ''
    : form.social_links?.[item.key] || ''
  socialError.value = ''
}

function closeSocialEditor() {
  activeSocial.value = ''
  socialDraft.value = ''
  socialError.value = ''
}

function normalizeUrl(raw) {
  const value = String(raw || '').trim()
  if (!value) return ''
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    return url.toString()
  } catch {
    return null
  }
}

function hostAllowed(host, hosts) {
  const cleanHost = String(host || '').replace(/^www\./, '').toLowerCase()
  return hosts.some((allowed) => cleanHost === allowed || cleanHost.endsWith(`.${allowed}`))
}

function cleanSocialUrl(platform, raw) {
  const normalized = normalizeUrl(raw)
  if (!normalized) return normalized
  const host = new URL(normalized).hostname
  return hostAllowed(host, platform.hosts) ? normalized : null
}

async function saveSocialLink() {
  const platform = activeSocialConfig.value
  if (!platform || socialSaving.value) return

  const normalized = platform.key === 'website'
    ? normalizeUrl(socialDraft.value)
    : cleanSocialUrl(platform, socialDraft.value)
  if (normalized === null) {
    socialError.value = t('account.public_profile.invalid_social_url', { platform: platformLabel(platform) })
    return
  }

  if (platform.key === 'website') {
    const previous = form.website_url
    form.website_url = normalized || ''
    socialSaving.value = true
    const ok = await persistProfile({ silent: true })
    socialSaving.value = false

    if (!ok) {
      form.website_url = previous
      return
    }

    showToast(t(normalized ? 'account.public_profile.social_saved' : 'account.public_profile.social_removed'), { type: 'success' })
    closeSocialEditor()
    return
  }

  const previous = { ...form.social_links }
  const next = { ...form.social_links }
  if (normalized) next[platform.key] = normalized
  else delete next[platform.key]
  form.social_links = next

  socialSaving.value = true
  const ok = await persistProfile({ silent: true })
  socialSaving.value = false

  if (!ok) {
    form.social_links = previous
    return
  }

  showToast(t(normalized ? 'account.public_profile.social_saved' : 'account.public_profile.social_removed'), { type: 'success' })
  closeSocialEditor()
}

function clearSocialLink() {
  socialDraft.value = ''
  saveSocialLink()
}

function openUsernameEditor() {
  usernameDraft.value = form.slug
  usernameOpen.value = true
}

async function saveUsername() {
  const previous = form.slug
  form.slug = usernameDraft.value
  const ok = await persistProfile({ successKey: 'account.public_profile.username_saved' })
  if (ok) usernameOpen.value = false
  else form.slug = previous
}

function openVisibilityEditor() {
  visibilityDraft.value = form.visibility_mode
  visibilityOpen.value = true
}

async function saveVisibility() {
  const previous = form.visibility_mode
  form.visibility_mode = visibilityDraft.value
  const ok = await persistProfile({ successKey: 'account.public_profile.visibility_saved' })
  if (ok) visibilityOpen.value = false
  else form.visibility_mode = previous
}

async function toggleBranding() {
  const previous = form.show_branding
  form.show_branding = !previous
  const ok = await persistProfile({ successKey: 'account.public_profile.branding_saved' })
  if (!ok) form.show_branding = previous
}

function platformLabel(item) {
  if (!item) return ''
  return item.labelKey ? t(item.labelKey) : item.label
}

function platformPlaceholder(item) {
  if (!item) return ''
  return item.placeholderKey ? t(item.placeholderKey) : item.placeholder
}

onMounted(loadSettings)
</script>
