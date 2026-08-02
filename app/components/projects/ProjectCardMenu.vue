<script setup>
/* ============================================================
   ProjectCardMenu - 项目卡片统一操作菜单
   - 编辑 / 公开设置 / 安装代码 / 删除由父组件决定
   - 快捷入口包含原平台链接与当前站点，统一用新标签打开
   ============================================================ */

import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { resolveProjectIcon } from '~/utils/project-icon'

const props = defineProps({
  sourceLinks: { type: Array, default: () => [] },
  dataSources: { type: Array, default: () => [] },
  siteUrl: { type: String, default: '' },
  mode: { type: String, default: 'card' },
  showInstall: { type: Boolean, default: false },
  showDelete: { type: Boolean, default: false },
  hideResourceLabels: { type: Boolean, default: false },
})

const emit = defineEmits([
  'edit',
  'public-settings',
  'install',
  'delete',
  'layer-change',
])

const { t } = useI18n()
const menuRef = ref(null)
const triggerRef = ref(null)
const panelRef = ref(null)
const menuOpen = ref(false)
const menuPlacement = ref('down')
const menuMaxHeight = ref(448)
const siteIconBroken = ref(false)
const isQuickAccess = computed(() => props.mode === 'quick-access')

const SOURCE_PROVIDERS = {
  ga4: {
    label: 'integrations.provider.ga4',
    icon: '/images/icon/google-analytics.svg',
    order: 0,
  },
  gsc: {
    label: 'integrations.provider.gsc',
    icon: '/images/icon/google-search-console.svg',
    order: 1,
  },
  bing: {
    label: 'integrations.provider.bing',
    icon: '/images/icon/bing-webmaster.svg',
    order: 2,
  },
}

const ANALYTICS_HOME = 'https://analytics.google.com/analytics/web/'

function numericResourceId(value, prefix) {
  const raw = String(value || '').trim()
  const id = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw
  return /^\d+$/.test(id) ? id : ''
}

const SOURCE_LINK_BUILDERS = {
  ga4: (mount) => {
    const accountId = numericResourceId(mount?.resource_meta?.account_id, 'accounts/')
    const propertyId = numericResourceId(mount?.resource_id, 'properties/')
    return accountId && propertyId
      ? `${ANALYTICS_HOME}#/a${accountId}p${propertyId}/reports/intelligenthome`
      : ANALYTICS_HOME
  },
  gsc: (mount) => `https://search.google.com/search-console?resource_id=${encodeURIComponent(mount.resource_id)}`,
  bing: (mount) => `https://www.bing.com/webmasters/home?siteUrl=${encodeURIComponent(mount.resource_id)}`,
}

function sourceLinkFromMount(mount) {
  const provider = String(mount?.provider || '')
  const resourceId = String(mount?.resource_id || '').trim()
  const build = SOURCE_LINK_BUILDERS[provider]
  if (!build || !resourceId) return null
  return {
    provider,
    resource_label: mount?.resource_label || resourceId,
    url: build(mount),
  }
}

const resolvedSourceLinks = computed(() => {
  const supplied = Array.isArray(props.sourceLinks) ? props.sourceLinks : []
  if (supplied.length) return supplied
  const mounts = Array.isArray(props.dataSources) ? props.dataSources : []
  return mounts.map(sourceLinkFromMount).filter(Boolean)
})

const sourceEntries = computed(() => {
  const links = resolvedSourceLinks.value
  const counts = links.reduce((out, link) => {
    out[link?.provider] = (out[link?.provider] || 0) + 1
    return out
  }, {})
  return links.flatMap((link, index) => {
    const provider = SOURCE_PROVIDERS[link?.provider]
    const url = String(link?.url || '').trim()
    if (!provider || !url) return []
    return [{
      ...link,
      key: `${link.provider}:${index}:${url}`,
      label: t(provider.label),
      icon: provider.icon,
      detail: !props.hideResourceLabels && counts[link.provider] > 1
        ? String(link.resource_label || '')
        : '',
      url,
    }]
  }).sort((a, b) => (
    SOURCE_PROVIDERS[a.provider].order - SOURCE_PROVIDERS[b.provider].order
    || a.detail.localeCompare(b.detail)
  ))
})

const currentSiteUrl = computed(() => {
  const raw = String(props.siteUrl || '').trim()
  if (!raw) return ''
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : ''
  } catch {
    return ''
  }
})

const currentSiteIconUrl = computed(() =>
  currentSiteUrl.value && !props.hideResourceLabels
    ? resolveProjectIcon({ site_url: currentSiteUrl.value })
    : '',
)
watch(currentSiteUrl, () => { siteIconBroken.value = false })

const hasQuickAccess = computed(() => sourceEntries.value.length > 0 || !!currentSiteUrl.value)

function closeMenu() {
  menuOpen.value = false
}

/* ---- 按真实菜单高度选择展开方向
 *  下方放不下且上方更宽裕时向上；两边都不足时选空间更大的一侧，
 *  同时把菜单限制在该侧可用高度内滚动，避免逼用户滚动整页找菜单底部。 ---- */
function updatePlacement() {
  if (!menuOpen.value || !triggerRef.value || typeof window === 'undefined') return

  const triggerRect = triggerRef.value.getBoundingClientRect()
  const desiredHeight = panelRef.value?.scrollHeight || 320
  const viewportGap = 8
  const spaceAbove = Math.max(0, triggerRect.top - viewportGap)
  const spaceBelow = Math.max(0, window.innerHeight - triggerRect.bottom - viewportGap)
  const shouldOpenUp = spaceBelow < desiredHeight && spaceAbove > spaceBelow

  menuPlacement.value = shouldOpenUp ? 'up' : 'down'
  const available = shouldOpenUp ? spaceAbove : spaceBelow
  menuMaxHeight.value = Math.max(1, Math.min(desiredHeight, available))
}

async function toggleMenu() {
  if (menuOpen.value) {
    closeMenu()
    return
  }

  menuPlacement.value = 'down'
  const viewportHeight = typeof window === 'undefined' ? 640 : window.innerHeight
  menuMaxHeight.value = Math.max(96, Math.floor(viewportHeight * 0.7))
  menuOpen.value = true
  await nextTick()
  updatePlacement()
}

function runAction(name) {
  closeMenu()
  emit(name)
}

function onClickOutside(event) {
  if (menuRef.value && !menuRef.value.contains(event.target)) closeMenu()
}

onMounted(() => document.addEventListener('pointerdown', onClickOutside))
onUnmounted(() => document.removeEventListener('pointerdown', onClickOutside))
</script>

<template>
  <div v-if="!isQuickAccess || hasQuickAccess" ref="menuRef" class="relative" @keydown.esc="closeMenu">
    <button
      ref="triggerRef"
      v-tooltip="isQuickAccess ? t('projects.quick_access') : t('common.settings')"
      type="button"
      :class="isQuickAccess
        ? 'inline-flex size-10 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-gray-700'
        : 'flex size-6 items-center justify-center rounded text-gray-400 transition-opacity hover:bg-gray-100 hover:text-gray-600 md:opacity-0 md:group-hover:opacity-100'"
      :aria-label="isQuickAccess ? t('projects.quick_access') : t('common.settings')"
      aria-haspopup="menu"
      :aria-expanded="menuOpen"
      @click="toggleMenu"
    >
      <NuxtIcon
        :name="isQuickAccess ? 'ri:apps-2-line' : 'ri:more-2-fill'"
        class="size-4"
      />
    </button>

    <Transition
      name="modal-fade"
      @before-enter="emit('layer-change', true)"
      @after-leave="emit('layer-change', false)"
    >
      <div
        v-if="menuOpen"
        ref="panelRef"
        :class="[
          'absolute z-10 w-52 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg',
          isQuickAccess ? 'left-0' : 'right-0',
          menuPlacement === 'up' ? 'bottom-full mb-1' : 'top-full mt-1',
        ]"
        :style="{ maxHeight: `${menuMaxHeight}px` }"
        role="menu"
      >
        <template v-if="!isQuickAccess">
          <button type="button" class="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50" role="menuitem" @click="runAction('edit')">
            {{ t('common.edit') }}
          </button>
          <button type="button" class="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50" role="menuitem" @click="runAction('public-settings')">
            {{ t('projects.public.menu') }}
          </button>
          <button v-if="showInstall" type="button" class="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50" role="menuitem" @click="runAction('install')">
            {{ t('projects.install_code') }}
          </button>
        </template>

        <div
          v-if="hasQuickAccess"
          :class="isQuickAccess ? '' : 'mt-1 border-t border-gray-100 pt-1'"
        >
          <div class="px-3 pb-1 pt-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-400">
            {{ t('projects.quick_access') }}
          </div>
          <a
            v-for="entry in sourceEntries"
            :key="entry.key"
            :href="entry.url"
            target="_blank"
            rel="noopener noreferrer"
            class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
            role="menuitem"
            @click="closeMenu"
          >
            <img :src="entry.icon" class="size-4 shrink-0 object-contain" alt="" />
            <span class="min-w-0 flex-1">
              <span class="block truncate">{{ entry.label }}</span>
              <span v-if="entry.detail" class="block truncate text-[10px] leading-3 text-gray-400">{{ entry.detail }}</span>
            </span>
            <NuxtIcon name="ri:external-link-line" class="size-3.5 shrink-0 text-gray-400" />
          </a>
          <a
            v-if="currentSiteUrl"
            :href="currentSiteUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
            role="menuitem"
            @click="closeMenu"
          >
            <span class="flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-gray-100">
              <img
                v-if="currentSiteIconUrl && !siteIconBroken"
                :src="currentSiteIconUrl"
                class="size-full object-cover"
                referrerpolicy="no-referrer"
                alt=""
                @error="siteIconBroken = true"
              />
              <NuxtIcon v-else name="ri:global-line" class="size-3 text-gray-400" />
            </span>
            <span class="min-w-0 flex-1 truncate">{{ t('projects.visit_site') }}</span>
            <NuxtIcon name="ri:external-link-line" class="size-3.5 shrink-0 text-gray-400" />
          </a>
        </div>

        <button
          v-if="!isQuickAccess && showDelete"
          type="button"
          class="mt-1 block w-full border-t border-gray-100 px-3 pb-1.5 pt-2 text-left text-sm text-red-500 hover:bg-red-50"
          role="menuitem"
          @click="runAction('delete')"
        >
          {{ t('common.delete') }}
        </button>
      </div>
    </Transition>
  </div>
</template>
