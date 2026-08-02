<template>
  <!-- ============================================================
       InstallCodeModal - GA4 安装代码弹窗
       职责:
         1. 打开时按 project_key 拉详情, 取首个 GA4 mount 的 measurement_id
         2. 渲染 gtag.js 安装代码 + 复制按钮
         3. 没挂 GA4 -> 引导用户去详情页接入数据源
       ============================================================ -->
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="visible"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4 backdrop-blur-[3px]"
        @click.self="$emit('close')"
      >
        <div class="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
          <div class="flex items-center justify-between gap-3">
            <div class="flex min-w-0 items-center gap-2">
              <div class="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-gray-100">
                <img
                  v-if="projectIconUrl"
                  :src="projectIconUrl"
                  class="size-full object-cover"
                  referrerpolicy="no-referrer"
                  alt=""
                />
                <NuxtIcon v-else name="ri:global-line" class="size-4 text-gray-400" />
              </div>
              <h3 class="min-w-0 truncate text-lg font-bold text-gray-900">
                {{ projectTitle }}
              </h3>
            </div>
            <button
              type="button"
              class="flex size-8 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              :aria-label="$t('common.close')"
              @click="$emit('close')"
            >
              <NuxtIcon name="ri:close-line" class="size-5" />
            </button>
          </div>
          <p class="mt-1 text-sm text-gray-500">{{ $t('projects.install_code_desc') }}</p>

          <!-- ============ 加载态 ============ -->
          <div v-if="loading" class="mt-6 text-center text-sm text-gray-400">
            {{ $t('common.loading') }}
          </div>

          <!-- ============ 没挂 GA4 ============ -->
          <div
            v-else-if="!measurementId"
            class="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm"
          >
            <div class="font-medium text-amber-900">{{ $t('projects.install_code_no_id_title') }}</div>
            <div class="mt-1 text-amber-800">{{ $t('projects.install_code_no_id_desc') }}</div>
            <div v-if="detailLink" class="mt-3">
              <NuxtLink
                :to="detailLink"
                class="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-text hover:opacity-90"
                @click="$emit('close')"
              >
                <NuxtIcon name="ri:link" class="size-4" />
                {{ $t('projects.detail.add_data_source') }}
              </NuxtLink>
            </div>
          </div>

          <!-- ============ 有 measurement_id: 展示 ID + 代码 ============ -->
          <div v-else class="mt-5 space-y-4">
            <!-- Measurement ID 单独行: 只复制 ID, 满足只需 ID 的产品场景 -->
            <div>
              <div class="mb-1 text-xs font-medium text-gray-500">
                {{ $t('projects.install_code_id_label') }}
              </div>
              <div class="flex items-stretch gap-2">
                <input
                  :value="measurementId"
                  readonly
                  class="min-w-0 flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-sm text-gray-900 focus:border-primary focus:bg-white focus:outline-none"
                  @focus="$event.target.select()"
                />
                <button
                  type="button"
                  v-tooltip="$t('common.copy')"
                  class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 hover:border-primary hover:text-primary"
                  @click="copyMeasurementId"
                >
                  <NuxtIcon name="ri:file-copy-line" class="size-3.5" />
                  {{ $t('common.copy') }}
                </button>
              </div>
            </div>

            <!-- 完整 gtag 代码块: 一键复制整段 -->
            <div>
              <div class="mb-1 flex items-center justify-between">
                <span class="text-xs font-medium text-gray-500">
                  {{ $t('projects.install_code_label') }}
                </span>
                <button
                  type="button"
                  class="inline-flex items-center gap-1 text-xs font-medium text-primary hover:opacity-80"
                  @click="copyCode"
                >
                  <NuxtIcon name="ri:file-copy-line" class="size-3.5" />
                  {{ $t('common.copy') }}
                </button>
              </div>
              <pre class="overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs leading-relaxed text-gray-800"><code>{{ installCode }}</code></pre>
            </div>
          </div>

          <div class="mt-6 flex items-center justify-end gap-2">
            <button
              type="button"
              class="rounded-full px-4 py-1.5 text-sm text-gray-500 hover:bg-gray-50"
              @click="$emit('close')"
            >
              {{ $t('common.close') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
/* ============================================================
   InstallCodeModal - 取 GA4 measurement_id 渲染 gtag 安装代码
   --
   走专用接口 /api/projects/:key/install-code:
     - 命中: resource_meta.measurement_id 直接返回
     - 未命中: 后端 lazy 拉 dataStreams 补上 + 回写 resource_meta
   前端只关心 measurement_id 是否为空; 单一职责, 避免与详情页耦合.
   ============================================================ */

import { computed, ref, watch } from 'vue'
import { resolveProjectIcon } from '~/utils/project-icon'

const props = defineProps({
  visible: { type: Boolean, default: false },
  project: { type: Object, default: null },
})

const emit = defineEmits(['close'])

const { t } = useI18n()
const localePath = useLocalePath()
const api = useApi()
const { show: showToast } = useToast()

const loading = ref(false)
const measurementId = ref('')

const projectTitle = computed(() => props.project?.name || t('projects.unnamed'))
const projectIconUrl = computed(() => {
  return resolveProjectIcon(props.project)
})

/* ---- 详情页链接 (未挂 GA4 时引导用户去添加数据源) ---- */
const detailLink = computed(() =>
  props.project?.project_key
    ? localePath(`/projects/${props.project.project_key}`)
    : '',
)

/* ---- gtag.js 安装代码 (对齐 GA4 官方 snippet) ---- */
const installCode = computed(() => {
  const id = measurementId.value
  if (!id) return ''
  return `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"><\/script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${id}');
<\/script>`
})

/* ---- 打开时调专用接口取 measurement_id (含 lazy backfill, 修复早期挂载丢字段) ---- */
async function loadMeasurementId() {
  if (!props.project?.project_key) {
    measurementId.value = ''
    return
  }
  loading.value = true
  measurementId.value = ''
  try {
    const res = await api.get(`/api/projects/${props.project.project_key}/install-code`)
    measurementId.value = res?.code === 200 ? (res.data?.measurement_id || '') : ''
  } catch {
    measurementId.value = ''
  } finally {
    loading.value = false
  }
}

async function copyText(text, successKey) {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    showToast(t(successKey), { type: 'success' })
  } catch {
    showToast(t('common.error'), { type: 'error' })
  }
}

function copyMeasurementId() {
  return copyText(measurementId.value, 'projects.install_code_id_copied')
}

function copyCode() {
  return copyText(installCode.value, 'projects.install_code_copied')
}

/* ---- 打开 -> 拉数据; 关闭 -> 重置 (项目切换时下次打开是干净状态) ---- */
watch(
  () => props.visible,
  (v) => {
    if (v) loadMeasurementId()
    else {
      measurementId.value = ''
      loading.value = false
    }
  },
)
</script>
