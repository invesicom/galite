<template>
  <!-- ========================================
       Landing Layout
       顶栏: Logo + 固定导航 + 登录/Dashboard + 语言
       底栏: ai-studio 风 — 品牌列 + 固定导航分组
       ======================================== -->
  <div class="flex min-h-screen flex-col bg-white">
    <!-- ============ 顶栏 ============
         双布局: 桌面端保留 Logo+导航+Login/Dashboard 原始设计,
         移动端则改为 左汉堡 / 中 Logo+站点名 / 右 UserMenuCard
         与 app.vue 移动端 header 共享同款交互骨架 -->
    <header class="sticky top-0 z-40 border-b border-gray-200/80 bg-white/95 backdrop-blur">
      <!-- ---- 桌面端布局 (md+) ---- -->
      <div class="mx-auto hidden h-14 max-w-7xl items-center justify-between px-4 md:flex">
        <NuxtLink :to="localePath('/')" class="flex items-center gap-2.5">
          <img v-if="logo.logo_64" :src="logo.logo_64" class="h-9 w-auto rounded-md" alt="" />
          <span class="text-xl font-bold text-gray-900">{{ siteName }}</span>
        </NuxtLink>

        <!-- 中间固定菜单 -->
        <nav class="flex items-center gap-8">
          <NuxtLink
            v-for="item in headerNav"
            :key="item.to"
            :to="localePath(item.to)"
            :class="[
              'text-sm font-medium transition-colors hover:text-gray-900',
              isLinkActive(item.to) ? 'text-gray-900 font-semibold' : 'text-gray-500',
            ]"
          >
            {{ item.name }}
          </NuxtLink>
        </nav>

        <div class="flex items-center gap-3">
          <!-- 已登录: Dashboard 按钮 -->
          <NuxtLink
            v-if="isLoggedIn"
            :to="localePath('/projects')"
            class="inline-flex items-center rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-text transition-opacity hover:opacity-90"
          >
            {{ $t('landing.nav.dashboard') }}
          </NuxtLink>

          <!-- 未登录: 登录按钮 -->
          <button
            v-else
            type="button"
            class="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-text transition-opacity hover:opacity-90"
            @click="loginModalVisible = true"
          >
            {{ $t('common.login') }}
          </button>

          <!-- 切换语言 -->
          <button
            type="button"
            class="inline-flex size-9 items-center justify-center rounded-lg bg-gray-100 text-gray-600 transition-colors hover:bg-gray-200 hover:text-primary"
            :aria-label="$t('lang.switch_language')"
            @click="langModalVisible = true"
          >
            <NuxtIcon name="ri:global-line" class="size-5" />
          </button>
        </div>
      </div>

      <!-- ---- 移动端布局 (< md) ----
           左汉堡 / 中 Logo+站点名 / 右 UserMenuCard -->
      <div class="mx-auto flex h-14 max-w-7xl items-center justify-between gap-2 px-4 md:hidden">
        <button
          type="button"
          class="flex size-9 shrink-0 items-center justify-center rounded-lg text-gray-700 transition-colors hover:bg-gray-100"
          :aria-label="$t('common.expand_sidebar')"
          @click="mobileMenuOpen = true"
        >
          <NuxtIcon name="ri:menu-line" class="size-6" />
        </button>

        <NuxtLink :to="localePath('/')" class="flex min-w-0 flex-1 items-center justify-center gap-2">
          <img v-if="logo.logo_64" :src="logo.logo_64" class="h-7 w-auto shrink-0 rounded-md" alt="" />
          <span class="truncate text-base font-semibold text-gray-900">{{ siteName }}</span>
        </NuxtLink>

        <!-- 右侧: 已登录显式 Dashboard 入口 + 头像菜单; 未登录走 UserMenuCard 内置登录按钮 -->
        <div class="flex shrink-0 items-center gap-2">
          <NuxtLink
            v-if="isLoggedIn"
            :to="localePath('/projects')"
            class="rounded-full bg-primary px-3 py-1.5 text-sm font-medium text-primary-text hover:opacity-90"
          >
            {{ $t('landing.nav.dashboard') }}
          </NuxtLink>
          <UserMenuCard collapsed placement="bottom" />
        </div>
      </div>
    </header>

    <!-- ============ 内容 ============ -->
    <main class="flex-1">
      <slot />
    </main>

    <!-- ============ 底栏 (品牌列 + 导航分组列, 仿 ai-studio) ============ -->
    <footer class="border-t border-gray-200 bg-white">
      <div class="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <div class="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <!-- ---- 品牌列 (占 2 列) ---- -->
          <div class="lg:col-span-2">
            <div class="flex items-center gap-2.5">
              <img
                v-if="logo.logo_64"
                :src="logo.logo_64"
                class="size-8 rounded-lg object-cover"
                :alt="siteName"
              />
              <span class="text-lg font-bold text-gray-900">{{ siteName }}</span>
            </div>

            <p
              v-if="siteDescription"
              class="mt-3 max-w-md text-sm leading-6 text-gray-500"
            >
              {{ siteDescription }}
            </p>

            <!-- 语言切换 -->
            <div class="mt-4">
              <button
                class="inline-flex items-center gap-2 rounded-lg bg-gray-100 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-200 hover:text-primary"
                @click="langModalVisible = true"
              >
                <NuxtIcon name="ri:global-line" class="size-4" />
                {{ $t('lang.switch_language') }}
              </button>
            </div>
          </div>

          <!-- ---- 单机版固定导航: 不从后台读取, 不带友情链接 ---- -->
          <div v-for="(group, gi) in footerNavGroups" :key="'fg-' + gi">
            <h3 class="text-sm font-semibold uppercase tracking-wider text-gray-400">
              {{ group.name }}
            </h3>
            <ul class="mt-4 space-y-2.5">
              <li v-for="(l, li) in group.links" :key="'fl-' + li">
                <NuxtLink
                  :to="l.external ? l.to : localePath(l.to)"
                  :external="l.external"
                  :target="l.external ? '_blank' : undefined"
                  :rel="l.external ? 'noopener noreferrer' : undefined"
                  class="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-primary"
                >
                  {{ l.name }}
                  <NuxtIcon v-if="l.external" name="ri:external-link-line" class="size-3.5 shrink-0" />
                </NuxtLink>
              </li>
            </ul>
          </div>
        </div>
      </div>
      <div class="border-t border-gray-100">
        <div class="mx-auto max-w-7xl px-4 py-5 text-center text-xs text-gray-400 sm:px-6">
          &copy; {{ currentYear }} {{ siteName }}. All rights reserved.
        </div>
      </div>
    </footer>

    <!-- ============ 弹窗 ============ -->
    <LoginModal :visible="loginModalVisible" closable @close="loginModalVisible = false" />
    <LanguageModal :visible="langModalVisible" @close="langModalVisible = false" />
    <MobileNavDrawer :visible="mobileMenuOpen" :items="headerNav" @close="mobileMenuOpen = false" />
    <LanguageGuide />
    <ToastContainer />
  </div>
</template>

<script setup>
import LoginModal from '~/components/layout/LoginModal.vue'
import LanguageModal from '~/components/layout/LanguageModal.vue'
import MobileNavDrawer from '~/components/layout/MobileNavDrawer.vue'
import ToastContainer from '~/components/layout/ToastContainer.vue'
import LanguageGuide from '~/components/layout/LanguageGuide.vue'
import UserMenuCard from '~/components/layout/UserMenuCard.vue'

const { locale, t } = useI18n()
const route = useRoute()
const localePath = useLocalePath()
const configStore = useConfigStore()
const { isLoggedIn } = useAuth()
const { productLinks } = useAppConfig()

/* ---- 固定菜单 (Home / API Docs)
       字段统一用 name (与 MobileNavDrawer 共享同款数据形态)
       About 页面保留, 但不再占用官网首屏导航 ---- */
const headerNav = computed(() => [
  { to: '/',         name: t('landing.nav.home') },
  { to: '/api-docs', name: t('landing.nav.api_docs') },
])

function isLinkActive(target) {
  const current = route.path
  const fullTarget = localePath(target)
  if (fullTarget === localePath('/')) return current === fullTarget
  return current === fullTarget || current.startsWith(fullTarget + '/')
}

const currentYear = new Date().getFullYear()

const resolvedConfig = computed(() => configStore.getTranslated(locale.value))
const siteName = computed(() => String(resolvedConfig.value.site_name || 'GA Lite'))
const siteDescription = computed(() => String(resolvedConfig.value.site_description || ''))
const logo = computed(() => resolvedConfig.value.logo || {})
const footerNavGroups = computed(() => [
  {
    name: siteName.value,
    links: [
      { to: '/about', name: t('landing.nav.about') },
      { to: '/api-docs', name: t('landing.nav.api_docs') },
    ],
  },
  {
    name: t('landing.footer.resources'),
    links: [
      { to: productLinks.repository, name: 'Github', external: true },
      { to: productLinks.hosted, name: 'GA Lite', external: true },
    ],
  },
])

const setupRequired = computed(() => Boolean(configStore.unchanged?.setup_required))
const loginModalVisible = ref(setupRequired.value || route.query.login === '1')
const langModalVisible = ref(false)
const mobileMenuOpen = ref(false)

provide('openLogin', () => { loginModalVisible.value = true })
provide('openLanguage', () => { langModalVisible.value = true })

watch(() => route.query.login, (value) => {
  if (value === '1') loginModalVisible.value = true
})

watch(setupRequired, (required) => {
  if (required) loginModalVisible.value = true
})
</script>
