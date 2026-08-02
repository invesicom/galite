<script setup>
const props = defineProps({
  visible: { type: Boolean, default: false },
  closable: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])
const { t, locale } = useI18n()
const localePath = useLocalePath()
const configStore = useConfigStore()
const route = useRoute()
const { login, initialize } = useAuth()

const email = ref('')
const password = ref('')
const passwordConfirmation = ref('')
const pending = ref(false)
const errorMessage = ref('')

const resolvedConfig = computed(() => configStore.getTranslated(locale.value))
const siteName = computed(() => String(resolvedConfig.value.site_name || 'GA Lite'))
const logo = computed(() => resolvedConfig.value.logo || {})
const setupRequired = computed(() => Boolean(configStore.unchanged?.setup_required))
const canClose = computed(() => props.closable && !setupRequired.value)
const submitDisabled = computed(() => pending.value
  || !email.value.trim()
  || !password.value
  || (setupRequired.value && !passwordConfirmation.value),
)

function onKeydown(event) {
  if (event.key === 'Escape' && canClose.value) emit('close')
}

function safeReturnTo() {
  const raw = Array.isArray(route.query.return_to) ? route.query.return_to[0] : route.query.return_to
  if (!raw || !import.meta.client) return ''
  try {
    const target = new URL(String(raw), window.location.origin)
    return target.origin === window.location.origin ? target.toString() : ''
  } catch {
    return ''
  }
}

async function submit() {
  if (submitDisabled.value) return
  pending.value = true
  errorMessage.value = ''
  try {
    if (setupRequired.value) {
      await initialize(email.value, password.value, passwordConfirmation.value)
      configStore.unchanged.setup_required = false
    } else {
      await login(email.value, password.value)
    }
    emit('close')
    const returnTo = safeReturnTo()
    if (returnTo) window.location.href = returnTo
    else if (route.path === localePath('/')) await navigateTo(localePath('/projects'))
  } catch (error) {
    const code = String(error?.message || '')
    const setupErrors = {
      invalid_email: 'login.invalid_credentials',
      weak_password: 'account.password.too_short',
      password_mismatch: 'account.password.mismatch',
      already_initialized: 'common.request_failed',
      app_secret_missing: 'common.service_unavailable',
    }
    errorMessage.value = setupRequired.value && setupErrors[code]
      ? t(setupErrors[code])
      : t('login.invalid_credentials')
  } finally {
    pending.value = false
  }
}

watch(() => props.visible, (visible) => {
  if (!visible) {
    password.value = ''
    passwordConfirmation.value = ''
    errorMessage.value = ''
  }
})

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="visible"
        class="fixed inset-0 z-[80] flex items-center justify-center bg-black/25 p-4 backdrop-blur-[3px]"
        @click.self="canClose && emit('close')"
      >
        <div class="relative w-full max-w-md rounded-2xl bg-white p-7 shadow-xl sm:p-9">
          <button
            v-if="canClose"
            type="button"
            class="absolute right-4 top-4 flex size-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            :aria-label="t('common.close')"
            @click="emit('close')"
          >
            <NuxtIcon name="ri:close-line" class="size-5" />
          </button>

          <div class="flex items-center justify-center gap-2.5">
            <img v-if="logo.logo_64" :src="logo.logo_64" class="size-9 rounded-xl" :alt="siteName" />
            <span class="text-xl font-bold text-gray-900">{{ siteName }}</span>
          </div>

          <h2 class="mt-7 text-center text-2xl font-bold text-gray-900">
            {{ setupRequired ? t('account.password.set_title') : t('login.title') }}
          </h2>
          <p class="mt-2 text-center text-sm text-gray-500">
            {{ setupRequired ? t('account.password.set_desc') : t('login.secure_badge') }}
          </p>

          <form class="mt-7 space-y-4" @submit.prevent="submit">
            <label class="block">
              <span class="text-sm font-medium text-gray-700">{{ t('login.email_label') }}</span>
              <input
                v-model="email"
                type="email"
                autocomplete="username"
                required
                class="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                :placeholder="t('login.email_placeholder')"
              />
            </label>

            <label class="block">
              <span class="text-sm font-medium text-gray-700">{{ t('login.password_label') }}</span>
              <input
                v-model="password"
                type="password"
                :autocomplete="setupRequired ? 'new-password' : 'current-password'"
                required
                class="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                :placeholder="t('login.password_placeholder')"
              />
            </label>

            <label v-if="setupRequired" class="block">
              <span class="text-sm font-medium text-gray-700">{{ t('account.password.confirm_password') }}</span>
              <input
                v-model="passwordConfirmation"
                type="password"
                autocomplete="new-password"
                required
                class="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                :placeholder="t('account.password.placeholder_confirm')"
              />
            </label>

            <p v-if="errorMessage" class="text-sm text-red-600">{{ errorMessage }}</p>

            <button
              type="submit"
              class="flex w-full items-center justify-center rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-text transition-opacity hover:opacity-90 disabled:opacity-50"
              :disabled="submitDisabled"
            >
              {{ setupRequired
                ? (pending ? t('common.saving') : t('account.password.save'))
                : (pending ? t('login.email_signing_in') : t('login.email_submit')) }}
            </button>
          </form>

        </div>
      </div>
    </Transition>
  </Teleport>
</template>
