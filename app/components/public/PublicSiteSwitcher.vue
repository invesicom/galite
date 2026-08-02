<script setup>
/* ============================================================
   PublicSiteSwitcher - 公开详情页站点切换器
   --
   公开页只消费 public DTO: public 站点展示 logo/name/url,
   semi/password 站点只展示匿名名, hidden 站点不进入切换列表.
   ============================================================ */

import { computed, ref, watch } from 'vue'
import { resolveProjectIcon } from '~/utils/project-icon'

const props = defineProps({
  currentKey: { type: String, default: '' },
  projects:   { type: Array, default: () => [] },
})

const emit = defineEmits(['select'])

const { t } = useI18n()
const open = ref(false)
const search = ref('')
const brokenIcons = ref(new Set())
const selectableProjects = computed(() =>
  props.projects.filter((item) =>
    item?.public_project_key && item.mode !== 'hidden' && !item.hidden,
  ),
)

const current = computed(() =>
  selectableProjects.value.find((item) => item.public_project_key === props.currentKey)
    || selectableProjects.value[0]
    || {},
)

const currentIcon = computed(() => faviconOf(current.value))
const filtered = computed(() => {
  const kw = search.value.trim().toLowerCase()
  if (!kw) return selectableProjects.value
  return selectableProjects.value.filter((item) =>
    [item.display_name, item.site_url].some((value) => String(value || '').toLowerCase().includes(kw)),
  )
})

watch(open, (visible) => {
  if (!visible) search.value = ''
})

watch(() => props.projects, () => {
  brokenIcons.value = new Set()
})

function faviconOf(item) {
  return resolveProjectIcon(item)
}

function iconBroken(key) {
  return brokenIcons.value.has(key)
}

function markIconBroken(key) {
  brokenIcons.value = new Set([...brokenIcons.value, key])
}

function select(item) {
  open.value = false
  if (!item?.public_project_key || item.public_project_key === props.currentKey) return
  emit('select', item)
}

function onKeydown(event) {
  if (open.value && event.key === 'Escape') open.value = false
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <button
    type="button"
    class="inline-flex h-9 max-w-full items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 text-sm text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50 md:h-10 md:gap-2 md:px-2.5"
    :title="current.site_url || current.display_name || ''"
    :aria-label="t('projects.detail.switch_site')"
    @click="open = true"
  >
    <span class="flex size-5 shrink-0 items-center justify-center overflow-hidden rounded bg-gray-100">
      <img
        v-if="currentIcon && !iconBroken(current.public_project_key)"
        :src="currentIcon"
        class="size-full object-cover"
        referrerpolicy="no-referrer"
        alt=""
        @error="markIconBroken(current.public_project_key)"
      />
      <NuxtIcon v-else name="ri:global-line" class="size-3 text-gray-400" />
    </span>
    <span class="min-w-0 max-w-[220px] truncate font-medium text-gray-900">
      {{ current.display_name || t('public_profile.default_site_name') }}
    </span>
    <NuxtIcon name="ri:arrow-down-s-line" class="size-3.5 shrink-0 text-gray-400" />
  </button>

  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-start justify-center bg-black/20 p-4 pt-[10vh] backdrop-blur-[3px]"
        @click.self="open = false"
      >
        <div class="flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
          <div class="flex items-center gap-3 border-b border-gray-100 px-4 py-3">
            <NuxtIcon name="ri:search-line" class="size-5 shrink-0 text-gray-400" />
            <input
              v-model="search"
              type="text"
              :placeholder="t('projects.detail.switch_search')"
              class="flex-1 bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none"
              autofocus
            />
            <button
              type="button"
              class="flex size-7 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              :aria-label="t('common.close')"
              @click="open = false"
            >
              <NuxtIcon name="ri:close-line" class="size-5" />
            </button>
          </div>

          <div class="max-h-[60vh] overflow-y-auto">
            <template v-if="filtered.length">
              <button
                v-for="item in filtered"
                :key="item.public_project_key"
                type="button"
                :class="[
                  'group grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-3 px-4 py-2.5 text-left transition-colors',
                  item.public_project_key === currentKey ? 'cursor-default bg-primary/5' : 'hover:bg-gray-50',
                ]"
                :disabled="item.public_project_key === currentKey"
                @click="select(item)"
              >
                <div class="flex min-w-0 items-center gap-2">
                  <span class="flex size-5 shrink-0 items-center justify-center overflow-hidden rounded bg-gray-100">
                    <img
                      v-if="faviconOf(item) && !iconBroken(item.public_project_key)"
                      :src="faviconOf(item)"
                      class="size-full object-cover"
                      referrerpolicy="no-referrer"
                      alt=""
                      @error="markIconBroken(item.public_project_key)"
                    />
                    <NuxtIcon
                      v-else
                      :name="item.locked ? 'ri:lock-2-line' : 'ri:global-line'"
                      class="size-3 text-gray-400"
                    />
                  </span>
                  <span class="truncate text-sm font-medium text-gray-900">
                    {{ item.display_name || t('public_profile.default_site_name') }}
                  </span>
                </div>
                <span class="truncate text-xs text-gray-500">
                  {{ item.site_url || '—' }}
                </span>
              </button>
            </template>
            <div v-else class="flex h-32 items-center justify-center text-sm text-gray-400">
              {{ t('projects.detail.switch_empty') }}
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
