<template>
  <!-- ============================================================
       MountResourceModal - 挂载资源到项目
       两步:
         1. 选 auth (data_source_auth 列表, 默认 GA4)
         2. 选 resource (调 /api/data-sources/:id/resources 拉)
       提交: POST /api/projects/:key/data-sources
       ============================================================ -->
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="visible"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[3px]"
        @click.self="$emit('close')"
      >
        <div class="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
          <h3 class="text-lg font-bold text-gray-900">
            {{ $t('integrations.mount_modal.title') }}
          </h3>

          <!-- ============ Step 1: 选 auth ============ -->
          <div class="mt-5">
            <div class="mb-2 text-xs font-medium text-gray-500">
              {{ $t('integrations.mount_modal.choose_auth') }}
            </div>
            <div v-if="authList.length === 0" class="rounded-lg border border-dashed border-gray-200 p-4 text-center">
              <p class="text-sm text-gray-500">{{ $t('integrations.mount_modal.no_auth') }}</p>
              <button
                type="button"
                class="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-text hover:opacity-90"
                @click="onConnect"
              >
                <NuxtIcon name="ri:add-line" class="size-4" />
                {{ $t('integrations.connect_new') }}
              </button>
            </div>
            <div v-else class="grid gap-2 sm:grid-cols-2">
              <button
                v-for="auth in authList"
                :key="auth.id"
                type="button"
                :class="[
                  'flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors',
                  selectedAuthId === auth.id
                    ? 'border-primary bg-primary/5'
                    : 'border-gray-200 hover:border-gray-300',
                ]"
                @click="selectAuth(auth.id)"
              >
                <img
                  v-if="auth.account_avatar"
                  :src="auth.account_avatar"
                  class="size-7 shrink-0 rounded-full"
                  alt=""
                />
                <div
                  v-else
                  class="flex size-7 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-500"
                >
                  {{ (auth.account_email || '?').slice(0, 1).toUpperCase() }}
                </div>
                <div class="min-w-0 flex-1">
                  <div class="truncate text-sm font-medium text-gray-800">
                    {{ auth.account_email }}
                  </div>
                  <div class="truncate text-[11px] uppercase text-gray-400">
                    {{ auth.provider }}
                  </div>
                </div>
                <span
                  v-if="auth.status === 99"
                  class="rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-500"
                >
                  !
                </span>
              </button>
            </div>
          </div>

          <!-- ============ Step 2: 选 resource ============ -->
          <div v-if="selectedAuthId" class="mt-5">
            <div class="mb-2 text-xs font-medium text-gray-500">
              {{ $t('integrations.mount_modal.choose_resource') }}
            </div>

            <div v-if="loadingResources" class="py-6 text-center text-sm text-gray-400">
              {{ $t('common.loading') }}
            </div>

            <div
              v-else-if="!resources.length"
              class="rounded-lg border border-dashed border-gray-200 p-4 text-center text-sm text-gray-500"
            >
              {{ $t('integrations.mount_modal.no_resource') }}
            </div>

            <div
              v-else
              class="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-gray-100 bg-gray-50/40 p-1.5"
            >
              <button
                v-for="r in resources"
                :key="r.id"
                type="button"
                :class="[
                  'flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors',
                  selectedResourceId === r.id
                    ? 'bg-primary/10 text-primary'
                    : 'hover:bg-white',
                ]"
                @click="selectedResourceId = r.id"
              >
                <NuxtIcon
                  :name="selectedResourceId === r.id ? 'ri:checkbox-circle-fill' : 'ri:checkbox-blank-circle-line'"
                  class="size-4 shrink-0"
                />
                <div class="min-w-0 flex-1">
                  <div class="truncate font-medium">{{ r.label || r.id }}</div>
                  <div class="truncate text-[11px] text-gray-400">{{ r.id }}</div>
                </div>
              </button>
            </div>
          </div>

          <!-- ============ Footer ============ -->
          <div class="mt-6 flex items-center justify-end gap-2">
            <button
              type="button"
              class="rounded-full px-4 py-1.5 text-sm text-gray-500 hover:bg-gray-50"
              @click="$emit('close')"
            >
              {{ $t('common.cancel') }}
            </button>
            <button
              type="button"
              class="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-text hover:opacity-90 disabled:opacity-50"
              :disabled="!canSubmit || mounting"
              @click="onSubmit"
            >
              {{ mounting ? $t('integrations.mount_modal.mounting') : $t('integrations.mount_modal.submit') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
/* ============================================================
   MountResourceModal
   props:
     - visible
     - projectKey (挂载目标项目)
   emits: close, mounted
   ============================================================ */

import { computed, ref, watch } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  projectKey: { type: String, required: true },
})

const emit = defineEmits(['close', 'mounted'])

const { t } = useI18n()
const {
  list: authList,
  fetchList: fetchAuthList,
  fetchResources: fetchAuthResources,
  connect: connectProvider,
} = useDataSources()
const { mountDataSource } = useProjects()
const { show: showToast } = useToast()

const selectedAuthId = ref(null)
const selectedResourceId = ref(null)
const resources = ref([])
const loadingResources = ref(false)
const mounting = ref(false)

/* ---- 模态打开时初始化 ---- */
watch(
  () => props.visible,
  async (v) => {
    if (!v) return
    selectedAuthId.value = null
    selectedResourceId.value = null
    resources.value = []
    mounting.value = false
    /* GA4 默认筛选, 后续 provider 上线再放宽 */
    await fetchAuthList('ga4')
    /* 自动选中第一个有效 auth, 减少一次点击 */
    const valid = authList.value.find((a) => a.status === 1)
    if (valid) await selectAuth(valid.id)
  },
)

async function selectAuth(authId) {
  selectedAuthId.value = authId
  selectedResourceId.value = null
  resources.value = []
  loadingResources.value = true
  try {
    const res = await fetchAuthResources(authId)
    if (res?.code === 200) resources.value = res.data?.resources || []
    else showToast(res?.msg || t('common.error'), { type: 'error' })
  } catch (err) {
    showToast(err?.message || t('common.error'), { type: 'error' })
  } finally {
    loadingResources.value = false
  }
}

const canSubmit = computed(() => !!(selectedAuthId.value && selectedResourceId.value))

async function onSubmit() {
  if (!canSubmit.value || mounting.value) return
  const auth = authList.value.find((a) => a.id === selectedAuthId.value)
  const resource = resources.value.find((r) => r.id === selectedResourceId.value)
  if (!auth || !resource) return

  mounting.value = true
  try {
    const res = await mountDataSource(props.projectKey, {
      auth_id: auth.id,
      resource_id: resource.id,
      resource_label: resource.label,
      resource_meta: resource.meta || {},
    })
    if (res?.code === 200) {
      showToast(t('integrations.mount_modal.success'), { type: 'success' })
      emit('mounted', res.data)
      emit('close')
    } else {
      showToast(res?.msg || t('integrations.mount_modal.failed'), { type: 'error' })
    }
  } catch (err) {
    showToast(err?.message || t('integrations.mount_modal.failed'), { type: 'error' })
  } finally {
    mounting.value = false
  }
}

function onConnect() {
  /* 直接跳 OAuth, 回来后会停在 /integrations, 用户自己再回 mount */
  connectProvider('ga4', '/integrations')
}
</script>
