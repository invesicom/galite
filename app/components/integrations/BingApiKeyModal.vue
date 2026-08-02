<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  pending: { type: Boolean, default: false },
  auth: { type: Object, default: null },
})

const emit = defineEmits(['close', 'save'])
const { t } = useI18n()

const apiKey = ref('')
const accountName = ref('')
const BING_WEBMASTER_API_ACCESS_URL = 'https://www.bing.com/webmasters/tools/apiaccess'
const BING_WEBMASTER_TOOLS_LABEL = 'Bing Webmaster Tools'

const isEdit = computed(() => Boolean(props.auth?.id))
const title = computed(() => isEdit.value
  ? `${t('common.edit')} ${t('integrations.provider.bing')}`
  : t('integrations.bing_api.title'))
const keyPlaceholder = computed(() => isEdit.value
  ? `${t('integrations.bing_api.key_placeholder')} (${t('common.optional')})`
  : t('integrations.bing_api.key_placeholder'))
const saveDisabled = computed(() => props.pending || (!isEdit.value && !apiKey.value.trim()))

const helpParts = computed(() => {
  const text = String(t('integrations.bing_api.help') || '')
  const index = text.indexOf(BING_WEBMASTER_TOOLS_LABEL)
  if (index < 0) return [{ text }]
  return [
    { text: text.slice(0, index) },
    { text: BING_WEBMASTER_TOOLS_LABEL, href: BING_WEBMASTER_API_ACCESS_URL },
    { text: text.slice(index + BING_WEBMASTER_TOOLS_LABEL.length) },
  ].filter((part) => part.text)
})

function resetForm() {
  apiKey.value = props.auth?.api_key || ''
  accountName.value = props.auth?.account_name || props.auth?.account_email || ''
}

watch(() => props.visible, (open) => {
  if (!open) return
  resetForm()
})

watch(() => props.auth?.id, () => {
  if (!props.visible) return
  resetForm()
})

watch(() => props.auth?.api_key, () => {
  if (!props.visible) return
  resetForm()
})

function onSave() {
  if (saveDisabled.value) return
  const payload = {
    account_name: accountName.value.trim(),
  }
  if (apiKey.value.trim()) payload.api_key = apiKey.value.trim()
  if (props.auth?.id) payload.auth_id = props.auth.id
  emit('save', payload)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="visible"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4 backdrop-blur-[3px]"
      >
        <div class="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
          <div class="flex items-center justify-between gap-3">
            <div class="flex min-w-0 items-center gap-2">
              <img src="/images/icon/bing-webmaster.svg" class="size-6 shrink-0" alt="" />
              <h3 class="truncate text-lg font-bold text-gray-900">{{ title }}</h3>
            </div>
            <button
              type="button"
              class="flex size-8 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
              :disabled="pending"
              :aria-label="t('common.close')"
              @click="emit('close')"
            >
              <NuxtIcon name="ri:close-line" class="size-5" />
            </button>
          </div>

          <label class="mt-5 block">
            <span class="text-xs font-medium text-gray-500">
              {{ t('integrations.bing_api.key_label') }}
              <span v-if="isEdit" class="font-normal text-gray-400">({{ t('common.optional') }})</span>
            </span>
            <input
              v-model="apiKey"
              :type="isEdit ? 'text' : 'password'"
              autocomplete="off"
              class="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 outline-none transition-colors focus:border-primary"
              :placeholder="keyPlaceholder"
              @keydown.enter.prevent="onSave"
            />
          </label>

          <label class="mt-3 block">
            <span class="text-xs font-medium text-gray-500">{{ t('integrations.bing_api.account_label') }}</span>
            <input
              v-model="accountName"
              type="text"
              class="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-900 outline-none transition-colors focus:border-primary"
              :placeholder="t('integrations.bing_api.account_placeholder')"
              @keydown.enter.prevent="onSave"
            />
          </label>

          <p class="mt-3 text-xs leading-relaxed text-gray-400">
            <template v-for="(part, i) in helpParts" :key="i">
              <a
                v-if="part.href"
                :href="part.href"
                target="_blank"
                rel="noopener noreferrer"
                class="font-medium text-primary hover:underline"
                @click.stop
              >
                {{ part.text }}
              </a>
              <template v-else>{{ part.text }}</template>
            </template>
          </p>

          <div class="mt-6 flex items-center justify-end">
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-text hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="saveDisabled"
              @click="onSave"
            >
              <NuxtIcon
                :name="pending ? 'ri:loader-4-line' : (isEdit ? 'ri:save-3-line' : 'ri:link-m')"
                :class="['size-4', pending ? 'animate-spin' : '']"
              />
              {{ pending ? (isEdit ? t('common.saving') : t('integrations.bing_api.connecting')) : (isEdit ? t('common.save') : t('integrations.bing_api.connect')) }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
