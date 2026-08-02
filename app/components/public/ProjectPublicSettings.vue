<template>
  <section v-if="project?.project_key" class="space-y-4">
    <div
      v-if="loading"
      class="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2.5 text-sm text-gray-500"
    >
      <NuxtIcon name="ri:loader-4-line" class="size-4 animate-spin" />
      <span>{{ t('projects.public.loading') }}</span>
    </div>

    <template v-else>
      <div ref="visibilityRef" class="relative">
        <div class="mb-1 text-xs font-medium text-gray-500">{{ t('projects.public.visibility') }}</div>
        <button
          type="button"
          class="flex w-full items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-sm text-gray-900 transition-colors hover:border-gray-300 focus:border-primary focus:outline-none"
          aria-haspopup="listbox"
          :aria-expanded="visibilityOpen ? 'true' : 'false'"
          @click="visibilityOpen = !visibilityOpen"
        >
          <span class="truncate">{{ selectedVisibility.label }}</span>
          <NuxtIcon
            name="ri:arrow-down-s-line"
            :class="['size-4 shrink-0 text-gray-400 transition-transform', visibilityOpen ? 'rotate-180' : '']"
          />
        </button>
        <Transition name="modal-fade">
          <div
            v-if="visibilityOpen"
            class="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
            role="listbox"
          >
            <button
              v-for="option in visibilityOptions"
              :key="option.value"
              type="button"
              role="option"
              :aria-selected="form.visibility_mode === option.value ? 'true' : 'false'"
              :class="[
                'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors',
                form.visibility_mode === option.value
                  ? 'bg-primary/10 text-primary'
                  : 'text-gray-700 hover:bg-gray-50',
              ]"
              @click="selectVisibility(option.value)"
            >
              <span class="truncate">{{ option.label }}</span>
              <NuxtIcon
                v-if="form.visibility_mode === option.value"
                name="ri:check-line"
                class="size-4 shrink-0"
              />
            </button>
          </div>
        </Transition>
      </div>

      <label v-if="form.visibility_mode === 'password'" class="block">
        <div class="mb-1 text-xs font-medium text-gray-500">{{ t('projects.public.password') }}</div>
        <input
          v-model="form.password"
          type="password"
          class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none"
          :placeholder="setting.has_password ? t('projects.public.password_keep') : t('common.required')"
        />
      </label>

      <div class="flex justify-end">
        <button
          type="button"
          class="rounded-full border border-gray-200 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          :disabled="saving"
          @click="save"
        >
          {{ saving ? t('common.saving') : t('projects.public.save') }}
        </button>
      </div>
    </template>
  </section>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'

const props = defineProps({
  project: { type: Object, default: null },
})

const emit = defineEmits(['saved', 'loaded'])

const api = useApi()
const { t } = useI18n()
const { show: showToast } = useToast()
const loading = ref(false)
const saving = ref(false)
const visibilityRef = ref(null)
const visibilityOpen = ref(false)
const setting = reactive({
  public_url: '',
  has_password: false,
})
const form = reactive({
  visibility_mode: 'inherit',
  password: '',
})

const visibilityOptions = computed(() => [
  { value: 'inherit', label: t('projects.public.mode_inherit') },
  { value: 'hidden', label: t('projects.public.mode_hidden') },
  { value: 'public', label: t('projects.public.mode_public') },
  { value: 'semi_public', label: t('projects.public.mode_semi_public') },
  { value: 'password', label: t('projects.public.mode_password') },
])
const selectedVisibility = computed(() =>
  visibilityOptions.value.find((item) => item.value === form.visibility_mode)
  || visibilityOptions.value[0],
)

function selectVisibility(value) {
  form.visibility_mode = value
  visibilityOpen.value = false
  if (value !== 'password') form.password = ''
}

function onClickOutside(event) {
  if (visibilityRef.value && !visibilityRef.value.contains(event.target)) {
    visibilityOpen.value = false
  }
}

onMounted(() => document.addEventListener('pointerdown', onClickOutside))
onUnmounted(() => document.removeEventListener('pointerdown', onClickOutside))

async function load() {
  if (!props.project?.project_key) return
  const hasCachedSetting = Boolean(props.project?.visibility_mode || props.project?.public_project_key)
  if (hasCachedSetting) applyRow(props.project)
  loading.value = !hasCachedSetting
  visibilityOpen.value = false
  if (!hasCachedSetting) resetForm()
  try {
    const key = encodeURIComponent(props.project.project_key)
    const res = await api.get(`/api/profile/projects?project_key=${key}`)
    if (res?.code !== 200) return
    const row = res.data?.row || (res.data?.list || []).find((item) => item.project_key === props.project.project_key)
    if (!row) return
    applyRow(row)
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!props.project?.project_key || saving.value) return
  saving.value = true
  try {
    const res = await api.post(`/api/profile/projects/${props.project.project_key}/public-settings`, {
      visibility_mode: form.visibility_mode,
      password: form.password,
    })
    if (res?.code !== 200) {
      showToast(errorText(res?.msg), { type: 'error' })
      return
    }
    showToast(t('projects.public.saved'), { type: 'success' })
    const row = {
      ...(res.data || {}),
      public_url: setting.public_url,
      has_password: !!res.data?.has_password,
    }
    setting.has_password = row.has_password
    form.password = ''
    emit('saved', row)
  } finally {
    saving.value = false
  }
}

function resetForm() {
  setting.public_url = ''
  setting.has_password = false
  form.visibility_mode = 'inherit'
  form.password = ''
}

function applyRow(row) {
  setting.public_url = row?.public_url || setting.public_url || ''
  setting.has_password = !!row?.has_password
  form.visibility_mode = row?.visibility_mode || 'inherit'
  form.password = ''
  emit('loaded', {
    public_url: setting.public_url,
    has_password: setting.has_password,
  })
}

function errorText(code) {
  if (code === 'password_required') return t('projects.public.password_required_error')
  if (code === 'weak_password') return t('projects.public.weak_password')
  return t('projects.public.save_failed')
}

watch(() => props.project?.project_key, load, { immediate: true })
</script>
