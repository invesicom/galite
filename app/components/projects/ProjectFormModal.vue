<template>
  <!-- ============================================================
       ProjectFormModal - 创建/编辑网站 (复用同一组件)
       props.mode: 'create' | 'edit'
       props.project: edit 模式下的源数据
       emits: close, saved (传回新对象)

       ▸ create 流程 (新):
         1. 没接入 GA            -> 引导去 /integrations
         2. 已接入但 scope 不够   -> 引导用户去 /integrations 重连
         3. 有 edit 权限          -> 选 GA 账号 + 填名字 + 填 URL
            后端在该账号下创建新 property + dataStream + 挂载,
            一次 API 完成. 用户拿到 measurement_id 在自己网站上贴 GA 代码.

       ▸ edit 流程:
         只动 name + site_url, 不改数据源关联.
       ============================================================ -->
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="visible"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4 backdrop-blur-[3px]"
        @click.self="$emit('close')"
      >
        <div class="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
          <h3 class="text-lg font-bold text-gray-900">
            {{ mode === 'edit' ? $t('projects.edit_title') : $t('projects.create_title') }}
          </h3>

          <!-- ============ create: 没授权 GA 引导 ============ -->
          <div
            v-if="mode === 'create' && !loadingAuth && !ga4Auths.length"
            class="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm"
          >
            <div class="font-medium text-amber-900">{{ $t('projects.create_step.no_ga_auth_title') }}</div>
            <div class="mt-1 text-amber-800">{{ $t('projects.create_step.no_ga_auth_desc') }}</div>
            <div class="mt-3">
              <NuxtLink
                :to="localePath('/integrations')"
                class="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-text hover:opacity-90"
                @click="$emit('close')"
              >
                <NuxtIcon name="ri:google-fill" class="size-4" />
                {{ $t('projects.create_step.go_authorize') }}
              </NuxtLink>
            </div>
          </div>

          <!-- ============ create: 加载授权列表 ============ -->
          <div v-else-if="mode === 'create' && loadingAuth" class="mt-6 text-center text-sm text-gray-400">
            {{ $t('common.loading') }}
          </div>

          <!-- ============ 表单 ============ -->
          <div v-else class="mt-5 space-y-4">

            <!-- create 模式: 选 GA 账号 (自定义 dropdown, 不用原生 select) -->
            <Field
              v-if="mode === 'create'"
              :label="$t('projects.create_step.choose_ga_account')"
              required
            >
              <div ref="dropdownRef" class="relative">
                <button
                  type="button"
                  class="flex w-full items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm transition-colors hover:border-gray-300 focus:border-primary focus:outline-none"
                  @click="dropdownOpen = !dropdownOpen"
                >
                  <span :class="['truncate', selectedAuth ? 'text-gray-900' : 'text-gray-400']">
                    {{ selectedAuth
                       ? (selectedAuth.account_email || selectedAuth.account_name) + statusSuffix(selectedAuth)
                       : $t('projects.create_step.choose_ga_account') }}
                  </span>
                  <NuxtIcon name="ri:arrow-down-s-line" :class="['size-4 shrink-0 text-gray-400 transition-transform', dropdownOpen ? 'rotate-180' : '']" />
                </button>
                <Transition name="modal-fade">
                  <div
                    v-if="dropdownOpen"
                    class="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
                  >
                    <button
                      v-for="a in ga4Auths"
                      :key="a.id"
                      type="button"
                      :disabled="a.status === 99"
                      :class="[
                        'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors',
                        a.status === 99 ? 'cursor-not-allowed text-gray-300' : 'text-gray-700 hover:bg-gray-50',
                        selectedAuthId === a.id ? 'bg-primary/10 text-primary' : '',
                      ]"
                      @click="onPickAuth(a)"
                    >
                      <span class="truncate">{{ a.account_email || a.account_name }}</span>
                      <span v-if="statusSuffix(a)" class="shrink-0 text-xs text-gray-400">
                        {{ statusSuffix(a).replace(/^ · /, '') }}
                      </span>
                    </button>
                  </div>
                </Transition>
              </div>

              <!-- 选中账号缺 edit scope -> 一键跳 OAuth 升级权限 (mode=extended) -->
              <div
                v-if="selectedAuth && !hasEditScope(selectedAuth)"
                class="mt-2 flex items-start justify-between gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800"
              >
                <span class="leading-relaxed">{{ $t('projects.create_step.scope_upgrade_required') }}</span>
                <button
                  type="button"
                  class="shrink-0 rounded bg-primary px-2 py-0.5 text-xs font-medium text-primary-text hover:opacity-90"
                  @click="upgradeScope(selectedAuth.provider)"
                >
                  {{ $t('integrations.reauthorize') }}
                </button>
              </div>
            </Field>

            <!-- 基本信息: 仅名字 + URL -->
            <Field :label="$t('projects.name_label')" required>
              <input
                v-model="form.name"
                type="text"
                class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none"
                :placeholder="$t('projects.name_placeholder')"
                maxlength="100"
              />
            </Field>

            <Field :label="$t('projects.url_label')" :required="mode === 'create'">
              <input
                v-model="form.site_url"
                type="text"
                :class="[
                  'w-full rounded-lg border px-3 py-2 text-sm focus:outline-none',
                  isGscOnly
                    ? 'cursor-not-allowed border-gray-100 bg-gray-50 text-gray-400'
                    : 'border-gray-200 focus:border-primary',
                ]"
                :placeholder="$t('projects.url_placeholder')"
                :readonly="isGscOnly"
                :aria-readonly="isGscOnly ? 'true' : undefined"
                maxlength="200"
              />
              <p v-if="isGscOnly" class="mt-1 text-xs text-gray-400">
                {{ $t('projects.url_locked_gsc_hint') }}
              </p>
            </Field>
          </div>

          <div class="mt-6 flex items-center justify-end gap-2">
            <button
              type="button"
              class="rounded-full px-4 py-1.5 text-sm text-gray-500 hover:bg-gray-50"
              @click="$emit('close')"
            >
              {{ $t('common.cancel') }}
            </button>
            <button
              v-if="mode !== 'create' || ga4Auths.length"
              type="button"
              class="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-text hover:opacity-90 disabled:opacity-50"
              :disabled="!canSubmit || saving"
              @click="onSubmit"
            >
              {{ saving ? saveButtonLabel : $t('common.save') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- ============================================================
       合并确认对话框 (z-[60] 浮在主 modal 之上)
       后端检测 URL 冲突 → mergePending 填充目标项目信息
       三选项: 合并 (迁数据源 + 软删当前) / 仅保存 (force update) / 取消
       不可逆警告用红字突出
       ============================================================ -->
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="mergePending"
        class="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4 backdrop-blur-[3px]"
        @click.self="onCancelMerge"
      >
        <div class="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
          <h3 class="text-lg font-bold text-gray-900">{{ $t('projects.merge.confirm_title') }}</h3>
          <p class="mt-2 text-sm text-gray-600">
            {{ $t('projects.merge.confirm_desc', { name: mergePending.name }) }}
          </p>
          <p class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-600">
            ⚠ {{ $t('projects.merge.warning_irreversible') }}
          </p>
          <div class="mt-5 flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              class="rounded-full px-4 py-1.5 text-sm text-gray-500 hover:bg-gray-50 disabled:opacity-50"
              :disabled="mergeBusy"
              @click="onCancelMerge"
            >
              {{ $t('common.cancel') }}
            </button>
            <button
              type="button"
              class="rounded-full border border-gray-200 px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              :disabled="mergeBusy"
              @click="onForceSave"
            >
              {{ $t('projects.merge.btn_force_save') }}
            </button>
            <button
              type="button"
              class="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-text hover:opacity-90 disabled:opacity-50"
              :disabled="mergeBusy"
              @click="onConfirmMerge"
            >
              {{ mergeBusy ? $t('projects.merge.merging') : $t('projects.merge.btn_merge') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
/* ============================================================
   ProjectFormModal - 创建/编辑双模式

   create:
     一次 API /api/projects/create-with-ga4
     后端在用户授权的 GA admin 账号下建新 property + dataStream + 挂载.
     成功后 toast 出 measurement_id 引导用户埋点.

   edit:
     只 update 基本字段.
   ============================================================ */

import { computed, h, onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  mode: { type: String, default: 'create' }, // 'create' | 'edit'
  project: { type: Object, default: null },
})

const emit = defineEmits(['close', 'saved'])

const { t } = useI18n()
const localePath = useLocalePath()
const { update, createWithGa4, merge } = useProjects()
const router = useRouter()
/* localePath 已在文件早些声明 (~line 240), 此处复用 */

/* 合并确认状态: 后端检测到 site_url 与其他项目冲突时填充 { project_key, name } */
const mergePending = ref(null)
const mergeBusy = ref(false)
const { fetchList: fetchAuthList, connect: connectAuth } = useDataSources()
const { show: showToast } = useToast()

/* ----------------------------------------------------------------
 *  scope 判定: analytics.edit 或旧版 analytics full scope 才能创建新 property
 * ---------------------------------------------------------------- */
const SCOPE_GA4_EDIT = 'https://www.googleapis.com/auth/analytics.edit'
const SCOPE_GA4_FULL = 'https://www.googleapis.com/auth/analytics'
function hasEditScope(auth) {
  const scopes = new Set(String(auth?.scope || '').split(/\s+/).filter(Boolean))
  return scopes.has(SCOPE_GA4_EDIT) || scopes.has(SCOPE_GA4_FULL)
}

/* ---- 一键升级 scope: 整页跳 OAuth (mode=extended), 回来后回到当前页 ---- */
function upgradeScope(providerName) {
  emit('close')
  connectAuth(providerName, '/projects', 'extended')
}

/* ---- 表单初值: 仅 name + site_url ---- */
function initialForm() {
  return { name: '', site_url: '' }
}

const form = ref(initialForm())
const saving = ref(false)

/* ---- 纯 GSC 项目: 编辑时锁 site_url
       GSC 那边的 site URL 由 verification 决定, 在这里改没意义且会让本地
       project_list.site_url 跟 GSC 挂载的 resource_meta.site_url 错位.
       props.project.providers 由 /api/projects/list 注入, 纯 GSC = 只含 'gsc' ---- */
const isGscOnly = computed(() => {
  if (props.mode !== 'edit' || !props.project) return false
  const arr = Array.isArray(props.project.providers) ? props.project.providers : []
  return arr.length > 0 && arr.every((p) => p === 'gsc')
})

/* ---- create 模式状态 ---- */
const ga4Auths = ref([])
const loadingAuth = ref(false)
const selectedAuthId = ref(null)

const selectedAuth = computed(() =>
  ga4Auths.value.find((a) => a.id === selectedAuthId.value) || null,
)

/* ---- 自定义 GA 账号 dropdown 状态 + 外部点击关闭 ---- */
const dropdownRef = ref(null)
const dropdownOpen = ref(false)

function onPickAuth(a) {
  if (a.status === 99) return
  selectedAuthId.value = a.id
  dropdownOpen.value = false
}

function onDropdownOutside(e) {
  if (!dropdownOpen.value) return
  if (dropdownRef.value && !dropdownRef.value.contains(e.target)) {
    dropdownOpen.value = false
  }
}

onMounted(() => {
  if (import.meta.client) document.addEventListener('pointerdown', onDropdownOutside)
})
onUnmounted(() => {
  if (import.meta.client) document.removeEventListener('pointerdown', onDropdownOutside)
})

/* ---- option suffix: 既要露出失效, 也要露出 scope 不够 ---- */
function statusSuffix(a) {
  if (a.status === 99) return ' · ' + t('projects.create_step.token_expired_account')
  if (!hasEditScope(a)) return ' · ' + t('projects.create_step.scope_outdated_account')
  return ''
}

/* ---- 模态打开: 重置表单 + (create) 拉 GA 授权 ---- */
watch(
  () => props.visible,
  async (v) => {
    if (!v) return
    saving.value = false
    if (props.mode === 'edit' && props.project) {
      form.value = {
        name: props.project.name || '',
        site_url: props.project.site_url || '',
      }
      return
    }
    /* create 模式: 重置 + 拉 GA 授权 */
    form.value = initialForm()
    selectedAuthId.value = null
    loadingAuth.value = true
    try {
      const res = await fetchAuthList('ga4')
      const all = Array.isArray(res?.data) ? res.data : (res?.data?.list || [])
      ga4Auths.value = all.filter((a) => a.provider === 'ga4')
      /* 自动选第一个 status=1 + scope 含 edit 的账号 */
      const ready = ga4Auths.value.find((a) => a.status === 1 && hasEditScope(a))
      if (ready) selectedAuthId.value = ready.id
    } finally {
      loadingAuth.value = false
    }
  },
  { immediate: true },
)

/* ---- 校验 ---- */
const canSubmit = computed(() => {
  if (!form.value.name?.trim()) return false
  if (props.mode === 'create') {
    if (!selectedAuthId.value) return false
    if (!form.value.site_url?.trim()) return false
    if (selectedAuth.value && !hasEditScope(selectedAuth.value)) return false
  }
  return true
})

const saveButtonLabel = computed(() =>
  props.mode === 'create'
    ? t('projects.create_step.creating_property')
    : t('common.saving'),
)

/* ---- URL 归一化: 用户输入 example.com / blog.example.com 自动补 https:// ----
   去掉首尾空格, 已带 http(s):// 不动. 提交给后端的永远是合法 URL.
   --- */
function normalizeUrl(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  if (/^https?:\/\//i.test(s)) return s
  return 'https://' + s
}

/* ---- 保存成功后按 GA4 同步结果分级提示 (后端 data.ga4_sync.status)
       synced=已同步 GA4; no_scope=只读授权; token_invalid=授权失效;
       rate_limited=限流; 其它/无 → 普通"已保存" ---- */
function toastSaved(ga4Sync) {
  const map = {
    synced:        ['projects.update_success_ga4',        'success'],
    no_scope:      ['projects.update_ok_ga4_no_scope',    'warning'],
    token_invalid: ['projects.update_ok_ga4_reauth',      'warning'],
    rate_limited:  ['projects.update_ok_ga4_ratelimited', 'warning'],
    error:         ['projects.update_ok_ga4_failed',      'warning'],
  }
  const [key, type] = map[ga4Sync?.status] || ['projects.update_success', 'success']
  showToast(t(key), { type })
}

/* ---- 提交 update 实现 (force=true 跳过后端 site_url 冲突校验)
       纯 GSC 项目: 不下发 site_url (即使前端 readonly 被绕过, 也防止
       project_list.site_url 跟 GSC resource_meta.site_url 错位) ---- */
async function doUpdate(force) {
  const payload = { name: form.value.name.trim() }
  if (!isGscOnly.value) payload.site_url = normalizeUrl(form.value.site_url)
  if (force) payload.force = true
  return await update(props.project.project_key, payload)
}

/* ---- 合并确认: 把当前项目合并到目标 ---- */
async function onConfirmMerge() {
  if (!mergePending.value || mergeBusy.value) return
  mergeBusy.value = true
  try {
    const res = await merge(props.project.project_key, mergePending.value.project_key)
    if (res?.code === 200) {
      showToast(t('projects.merge.success', { name: mergePending.value.name }), { type: 'success' })
      const targetKey = res.data?.target_project_key || mergePending.value.project_key
      mergePending.value = null
      emit('close')
      /* 跳到目标项目详情页 — 当前项目已软删, 留在原 URL 会 404 */
      await router.push(localePath(`/projects/${targetKey}`))
    } else {
      showToast(res?.msg || t('projects.merge.failed'), { type: 'error' })
    }
  } catch (err) {
    showToast(err?.message || t('projects.merge.failed'), { type: 'error' })
  } finally {
    mergeBusy.value = false
  }
}

/* ---- 仅保存: 重新调 update 带 force=true 跳过校验, 保留两项目同 URL ---- */
async function onForceSave() {
  if (!mergePending.value || mergeBusy.value) return
  mergeBusy.value = true
  try {
    const res = await doUpdate(true)
    if (res?.code === 200) {
      toastSaved(res.data?.ga4_sync)
      mergePending.value = null
      emit('saved', res.data)
      emit('close')
    } else {
      showToast(res?.msg || t('projects.save_failed'), { type: 'error' })
    }
  } finally {
    mergeBusy.value = false
  }
}

function onCancelMerge() {
  if (mergeBusy.value) return
  mergePending.value = null
}

async function onSubmit() {
  if (!canSubmit.value || saving.value) return
  saving.value = true
  try {
    /* edit: 走 update, 后端可能返 requires_confirmation 触发合并对话框 */
    if (props.mode === 'edit' && props.project?.project_key) {
      const res = await doUpdate(false)
      /* URL 冲突: 不实际保存, 弹合并/强保存对话框 */
      if (res?.code === 200 && res?.data?.requires_confirmation === 'url_conflict') {
        mergePending.value = res.data.target
        return
      }
      if (res?.code === 200) {
        toastSaved(res.data?.ga4_sync)
        emit('saved', res.data)
        emit('close')
      } else {
        showToast(res?.msg || t('projects.save_failed'), { type: 'error' })
      }
      return
    }

    /* create: 一次性后端建 property + dataStream + 挂载 */
    const res = await createWithGa4({
      auth_id:  selectedAuthId.value,
      name:     form.value.name.trim(),
      site_url: normalizeUrl(form.value.site_url),
    })
    if (res?.code !== 200) {
      const msgMap = {
        token_invalid: t('projects.create_step.scope_upgrade_required'),
        ga4_create_permission_denied: t('projects.create_step.ga4_create_permission_denied'),
      }
      const msg = msgMap[res?.msg] || res?.msg || t('projects.save_failed')
      showToast(msg, { type: 'error' })
      return
    }

    showToast(t('projects.create_success'), { type: 'success' })

    /* measurement_id 通过 toast 引导用户埋点, 详情页后续也会展示 */
    const mid = res.data?.measurement_id
    if (mid) {
      showToast(
        t('projects.create_step.measurement_id_hint', { id: mid }),
        { type: 'info', duration: 8000 },
      )
    }
    emit('saved', res.data)
    emit('close')
  } catch (err) {
    showToast(err?.message || t('projects.save_failed'), { type: 'error' })
  } finally {
    saving.value = false
  }
}

/* ============================================================
   Field - 内联标签包裹器
   ============================================================ */
const Field = {
  props: {
    label: String,
    required: Boolean,
  },
  setup(p, { slots }) {
    return () =>
      h('label', { class: 'block' }, [
        h('div', { class: 'mb-1 text-xs font-medium text-gray-500' }, [
          p.label,
          p.required ? h('span', { class: 'ml-1 text-red-400' }, '*') : null,
        ]),
        slots.default?.(),
      ])
  },
}
</script>
