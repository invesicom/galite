<template>
  <!-- ========================================
       App Layout - Dashboard shell
       --
       架构:
       - 桌面: sticky sidebar (220 / 56 折叠) + 主内容 (顶栏隐藏)
       - 移动: 顶栏汉堡 + drawer 镜像 sidebar
       --
       Sidebar 双层语义:
       - 顶部 logo + 主导航 (站点 / 实时 / 集成)
       - 底部 切换语言 + UserMenuCard (身份/账号/退出聚合卡)
       --
       共享 modal:
       - LoginModal / LanguageModal / AccountModal / MCP Connect
       ======================================== -->
  <div class="flex min-h-screen bg-gray-50">

    <!-- ============ Sidebar (桌面)
         z-40 让整个 sidebar 的 stacking context 浮在主内容区之上, 这样
         UserMenuCard 折叠态向右"伸出"的 popup (悬出 sidebar 边界进入
         主区域 x 范围) 不会被主内容区的卡片/区块挡住 -->
    <aside
      :class="[
        'sticky top-0 z-40 hidden h-screen shrink-0 flex-col border-r border-gray-200 bg-white transition-[width] duration-200 md:flex',
        collapsed ? 'w-14' : 'w-56',
      ]"
    >
      <!-- Logo + 折叠 toggle (展开态: 同一行 / 折叠态: hover 切换) -->
      <div class="flex h-14 items-center gap-2 px-3">
        <template v-if="!collapsed">
          <!-- PC sidebar 顶部永远是产品 brand (品牌锚点),
               切换站点能力放在主区域 toolbar 左上 (SiteSwitcherButton);
               移动端没 sidebar, 切换才在顶部 header 中间 -->
          <NuxtLink
            :to="localePath('/')"
            class="flex min-w-0 flex-1 items-center gap-2.5"
          >
            <img v-if="logo.logo_64" :src="logo.logo_64" class="size-8 shrink-0 rounded-md" alt="" />
            <span
              v-else
              class="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-text"
            >
              {{ (siteName || 'S').slice(0, 1).toUpperCase() }}
            </span>
            <span class="truncate text-base font-bold text-gray-900">{{ siteName }}</span>
          </NuxtLink>
          <button
            v-tooltip="$t('common.collapse_sidebar')"
            type="button"
            class="flex size-8 shrink-0 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
            :aria-label="$t('common.collapse_sidebar')"
            @click="toggleCollapsed"
          >
            <NuxtIcon name="ri:menu-fold-line" class="size-5" />
          </button>
        </template>

        <!-- 折叠态: 默认 logo, hover 切换为展开 toggle.
             tooltip 用 .right modifier — sidebar 折叠 (w-14=56px) 时 viewport 顶
             空间足够, 但视觉重心在 sidebar 右侧的主区域, tooltip 在右侧最自然 -->
        <button
          v-else
          v-tooltip.right="$t('common.expand_sidebar')"
          type="button"
          class="group mx-auto flex size-9 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
          :aria-label="$t('common.expand_sidebar')"
          @click="toggleCollapsed"
        >
          <img
            v-if="logo.logo_64"
            :src="logo.logo_64"
            class="size-7 rounded-md group-hover:hidden"
            alt=""
          />
          <span
            v-else
            class="flex size-7 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-text group-hover:hidden"
          >
            {{ (siteName || 'S').slice(0, 1).toUpperCase() }}
          </span>
          <NuxtIcon name="ri:menu-unfold-line" class="hidden size-5 group-hover:block" />
        </button>
      </div>

      <!-- 主导航 (切语言已收入 UserMenuCard 弹层, 此处只剩页面导航)
           tooltip .right modifier: 折叠态时 nav item 旁挨 sidebar 右边界, 向右弹最自然 -->
      <nav class="flex-1 space-y-0.5 px-2 py-2">
        <NuxtLink
          v-for="item in navItems"
          :key="item.to"
          v-tooltip.right="collapsed ? item.label : ''"
          :to="localePath(item.to)"
          :class="navClass(item)"
        >
          <NuxtIcon :name="item.icon" class="size-5 shrink-0" />
          <span v-if="!collapsed" class="truncate">{{ item.label }}</span>
        </NuxtLink>
      </nav>

      <!-- ============ 连接 MCP 入口 (分界线上方, nav 末) ============ -->
      <div v-if="isLoggedIn" class="px-2 pb-2">
        <button
          v-tooltip.right="collapsed ? t('user_menu.connect_mcp') : ''"
          type="button"
          :class="[
            'flex w-full items-center justify-center gap-2 rounded-md border border-gray-200 bg-white py-2 text-sm font-medium text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50',
            collapsed ? 'px-0' : 'px-2.5',
          ]"
          :aria-label="t('user_menu.connect_mcp')"
          @click="mcpConnectModalVisible = true"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-5 shrink-0">
            <path d="M14 4.99997H4V17H10.5908L12 19.0117L13.4092 17H20V11H22V18C22 18.5445 21.5445 19 21 19H14.4502L12 22.5L9.5498 19H3C2.45547 19 2 18.5445 2 18V3.99997C2.00002 3.45544 2.45546 2.99996 3 2.99996H14V4.99997ZM19.5293 1.3193C19.7058 0.893513 20.2942 0.8935 20.4707 1.3193L20.7236 1.93063C21.1555 2.97343 21.9615 3.80614 22.9746 4.2568L23.6914 4.57614C24.1022 4.75882 24.1022 5.35635 23.6914 5.53903L22.9326 5.87692C21.945 6.3162 21.1534 7.11943 20.7139 8.1279L20.4668 8.69333C20.2863 9.10747 19.7136 9.10747 19.5332 8.69333L19.2861 8.1279C18.8466 7.11942 18.0551 6.3162 17.0674 5.87692L16.3076 5.53903C15.8974 5.35618 15.8974 4.75895 16.3076 4.57614L17.0254 4.2568C18.0384 3.80614 18.8445 2.97343 19.2764 1.93063L19.5293 1.3193Z" />
          </svg>
          <span v-if="!collapsed" class="truncate">{{ t('user_menu.connect_mcp') }}</span>
        </button>
      </div>

      <!-- ============ 底部: 用户身份卡 (分界线下) ============ -->
      <div class="border-t border-gray-100 px-2 py-2">
        <UserMenuCard :collapsed="collapsed" />
      </div>
    </aside>

    <!-- ============ 主区域 ============ -->
    <div class="flex min-w-0 flex-1 flex-col">
      <!-- 移动端顶栏 (桌面隐藏) -->
      <header class="sticky top-0 z-30 flex h-12 items-center justify-between gap-2 border-b border-gray-200 bg-white/95 px-3 backdrop-blur md:hidden">
        <button
          type="button"
          class="flex size-9 items-center justify-center rounded-md text-gray-700 hover:bg-gray-100"
          :aria-label="$t('common.expand_sidebar')"
          @click="mobileSidebarOpen = true"
        >
          <NuxtIcon name="ri:menu-line" class="size-6" />
        </button>
        <!-- 居中: brandOverride (详情页) → button 触发切换 + ▾ 三角
             其他页面 → 纯展示 div (老行为: 不可点, 防误触) -->
        <button
          v-if="brandOverride"
          type="button"
          class="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md py-1 transition-colors hover:bg-gray-50"
          @click="siteSwitcherOpen = true"
        >
          <img v-if="displayLogo64" :src="displayLogo64" class="size-6 shrink-0 rounded-md" alt="" />
          <span
            v-else
            class="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-text"
          >
            {{ (displayName || 'S').slice(0, 1).toUpperCase() }}
          </span>
          <span class="truncate text-sm font-bold text-gray-900">{{ displayName }}</span>
          <NuxtIcon name="ri:arrow-down-s-line" class="size-4 shrink-0 text-gray-400" />
        </button>
        <div v-else class="flex min-w-0 flex-1 items-center justify-center gap-2">
          <img v-if="displayLogo64" :src="displayLogo64" class="size-6 shrink-0 rounded-md" alt="" />
          <span
            v-else
            class="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-text"
          >
            {{ (displayName || 'S').slice(0, 1).toUpperCase() }}
          </span>
          <span class="truncate text-sm font-bold text-gray-900">{{ displayName }}</span>
        </div>
        <!-- 右侧: 用户身份卡 (collapsed 显示头像, 点击弹完整菜单含切语言) -->
        <div class="shrink-0">
          <UserMenuCard :collapsed="true" placement="bottom" />
        </div>
      </header>

      <main class="flex-1">
        <slot />
      </main>
    </div>

    <!-- ============ 移动端 Drawer (sidebar 镜像)
         双 Transition 拆分: 遮罩淡入淡出, aside 从左侧滑入 — 与官网
         MobileNavDrawer 同款交互, 区别仅在滑入方向 (dash sidebar 在左) -->
    <Transition name="modal-fade">
      <div
        v-if="mobileSidebarOpen"
        class="fixed inset-0 z-50 bg-black/40 backdrop-blur-[3px] md:hidden"
        @click="mobileSidebarOpen = false"
      />
    </Transition>
    <Transition name="slide-left">
      <aside
        v-if="mobileSidebarOpen"
        class="fixed bottom-0 left-0 top-0 z-50 flex w-64 max-w-[85vw] flex-col bg-white shadow-2xl md:hidden"
      >
          <div class="flex h-14 items-center justify-between gap-2 px-3">
            <!-- logo + 名字 (点击回官网, 名字本身可见 → 不需要 tooltip) -->
            <NuxtLink
              :to="localePath('/')"
              class="flex min-w-0 flex-1 items-center gap-2"
              @click="mobileSidebarOpen = false"
            >
              <img v-if="logo.logo_64" :src="logo.logo_64" class="size-7 shrink-0 rounded-md" alt="" />
              <span
                v-else
                class="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-text"
              >
                {{ (siteName || 'S').slice(0, 1).toUpperCase() }}
              </span>
              <span class="truncate text-base font-bold text-gray-900">{{ siteName }}</span>
            </NuxtLink>
            <button
              type="button"
              class="flex size-8 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
              :aria-label="$t('common.close')"
              @click="mobileSidebarOpen = false"
            >
              <NuxtIcon name="ri:close-line" class="size-6" />
            </button>
          </div>
          <nav class="flex-1 space-y-0.5 px-2 py-2">
            <NuxtLink
              v-for="item in navItems"
              :key="item.to"
              :to="localePath(item.to)"
              :class="navClass(item)"
              @click="mobileSidebarOpen = false"
            >
              <NuxtIcon :name="item.icon" class="size-5 shrink-0" />
              <span class="truncate">{{ item.label }}</span>
            </NuxtLink>
          </nav>
          <div v-if="isLoggedIn" class="px-2 pb-2">
            <button
              type="button"
              class="flex w-full items-center justify-center gap-2 rounded-md border border-gray-200 bg-white px-2.5 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50"
              @click="mcpConnectModalVisible = true; mobileSidebarOpen = false"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-5 shrink-0">
                <path d="M14 4.99997H4V17H10.5908L12 19.0117L13.4092 17H20V11H22V18C22 18.5445 21.5445 19 21 19H14.4502L12 22.5L9.5498 19H3C2.45547 19 2 18.5445 2 18V3.99997C2.00002 3.45544 2.45546 2.99996 3 2.99996H14V4.99997ZM19.5293 1.3193C19.7058 0.893513 20.2942 0.8935 20.4707 1.3193L20.7236 1.93063C21.1555 2.97343 21.9615 3.80614 22.9746 4.2568L23.6914 4.57614C24.1022 4.75882 24.1022 5.35635 23.6914 5.53903L22.9326 5.87692C21.945 6.3162 21.1534 7.11943 20.7139 8.1279L20.4668 8.69333C20.2863 9.10747 19.7136 9.10747 19.5332 8.69333L19.2861 8.1279C18.8466 7.11942 18.0551 6.3162 17.0674 5.87692L16.3076 5.53903C15.8974 5.35618 15.8974 4.75895 16.3076 4.57614L17.0254 4.2568C18.0384 3.80614 18.8445 2.97343 19.2764 1.93063L19.5293 1.3193Z" />
              </svg>
              <span class="truncate">{{ t('user_menu.connect_mcp') }}</span>
            </button>
          </div>
          <div class="border-t border-gray-100 px-2 py-2">
            <UserMenuCard :collapsed="false" />
          </div>
      </aside>
    </Transition>

    <!-- ============ 共享 modals ============ -->
    <LoginModal
      :visible="loginModalVisible"
      @close="loginModalVisible = false"
      @switch-language="switchToLanguage"
    />
    <LanguageModal   :visible="langModalVisible"       @close="onLanguageClose" />
    <AccountModal
      :visible="accountModalVisible"
      :initial-tab="accountModalInitialTab"
      @close="accountModalVisible = false"
    />
    <McpConnectModal :visible="mcpConnectModalVisible" @close="mcpConnectModalVisible = false" />
    <ToastContainer />
  </div>
</template>

<script setup>
/* ===========================================================
   App Layout - Dashboard shell with collapsible sidebar
   cookie key: galite:sidebar:collapsed (server/client 同源)
   =========================================================== */

import LoginModal       from '~/components/layout/LoginModal.vue'
import LanguageModal    from '~/components/layout/LanguageModal.vue'
import AccountModal     from '~/components/layout/AccountModal.vue'
import McpConnectModal  from '~/components/layout/McpConnectModal.vue'
import UserMenuCard     from '~/components/layout/UserMenuCard.vue'
import ToastContainer   from '~/components/layout/ToastContainer.vue'

const { locale, t } = useI18n()
const route = useRoute()
const localePath = useLocalePath()
const configStore = useConfigStore()

const resolvedConfig = computed(() => configStore.getTranslated(locale.value))
const siteName = computed(() => String(resolvedConfig.value.site_name || 'GA Lite'))
const logo = computed(() => resolvedConfig.value.logo || {})

/* ============================================================
   brand-override: 子页面 (站点详情) 设置当前站点的 logo+name,
   layout 用它覆盖产品 logo+name 显示, 让用户一眼看清"在看哪个站点".
   --
   ⚠️ 必须用 useState 跨页面共享 — Vue provide/inject 是父→子单向,
       layout 是父 NuxtPage 是子, 子 provide 父拿不到, 这是当时踩的坑.
   --
   产品 branding 通过右下角悬浮 (子页面自行渲染) 保留.
   未设置 → 走原产品 logo+name (其他页面行为不变)
   离开详情页时子页面 onBeforeUnmount 清空, 不会污染其他页面
   ============================================================ */
const brandOverride = useState('brand-override', () => null)
const displayLogo64 = computed(() => brandOverride.value?.logo || logo.value.logo_64 || '')
const displayName   = computed(() => brandOverride.value?.name || siteName.value)

/* siteSwitcherOpen: 跨 layout/page 共享开关, brandOverride 存在时点击顶部
   logo+名触发, [projectKey].vue 监听并打开 SiteSwitcherModal */
const siteSwitcherOpen = useState('site-switcher-open', () => false)

/* ---- 导航项 ---- */
const navItems = computed(() => [
  { to: '/projects',     label: t('projects.title'),     icon: 'ri:layout-grid-line', exact: true },
  { to: '/realtime',     label: t('realtime.title'),     icon: 'ri:pulse-line' },
  { to: '/integrations', label: t('integrations.title'), icon: 'ri:plug-line' },
])

function trimTrailingSlash(path) {
  const value = String(path || '')
  return value.length > 1 ? value.replace(/\/+$/, '') : value
}

function navClass(item) {
  const target = String(item?.to || '')
  if (!target) return ''
  const current = trimTrailingSlash(route.path)
  const fullTarget = trimTrailingSlash(localePath(target))
  const active = item.exact
    ? current === fullTarget
    : current === fullTarget || current.startsWith(fullTarget + '/')
  return [
    'flex items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
    active
      ? 'bg-primary/10 text-primary'
      : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900',
    collapsed.value ? 'justify-center' : '',
  ]
}

/* ============================================================
   折叠状态: useCookie 持久 (替代 localStorage)
   --
   为什么不用 localStorage:
     localStorage 仅 client 可读, SSR 期 collapsed 永远是 default (false),
     server 渲染展开态 HTML 后 client setup 立即读 localStorage 改 true,
     触发 hydration mismatch — Vue 丢弃部分 SSR DOM 重渲, 用户会看到
     "展开态闪现 + logo/名字短暂缺失" 的诡异中间态.
   useCookie 让 server / client 同源:
     SSR 期 useCookie 从 request cookies 同步读, ref 立即拿到正确值,
     HTML 一开始就是正确状态; client hydration 拿到同样的 cookie 值,
     0 mismatch, 0 闪烁.
   --
   关键: cookie 值直接用 boolean (不要用 '0'/'1' 字符串).
     Nuxt useCookie 默认 decode 走 `destr` (unjs 安全 JSON.parse),
     destr('1') → number 1, '1' === 1 永远 false, 导致刷新后 collapsed
     初始化恒为 false. 用 boolean 让 destr 把 'true'/'false' 反序列化
     回 boolean, 类型一致, 比较正确.
   ============================================================ */
const collapsedCookie = useCookie('galite:sidebar:collapsed', {
  default: () => false,
  sameSite: 'lax',
  path: '/',
  /* 1 年, sidebar 偏好是长期个人化设置 */
  maxAge: 60 * 60 * 24 * 365,
})

/* setup 期同步初始化 — server / client 都同步读 cookie, ref 立即拿到对的 boolean.
   Boolean() 兜底防御性转换 (cookie 第一次写入前是 undefined 也 OK) */
const collapsed = ref(Boolean(collapsedCookie.value))

/* 单向 watch 把 boolean ref 写回 cookie. toggleCollapsed 只动 ref, 简单直接. */
watch(collapsed, (v) => {
  collapsedCookie.value = v
})

function toggleCollapsed() {
  collapsed.value = !collapsed.value
}

/* ---- 移动端 drawer ---- */
const mobileSidebarOpen = ref(false)

/* ===========================================================
   共享 modal 状态 + provide 协议
   --
   单机版只保留登录、语言、账号与 MCP 四个入口。
   =========================================================== */
/* ===========================================================
   未登录自动弹登录 + 切语言互斥
   --
   关键: ref 初值同步读 isLoggedIn, 让 LoginModal 在 SSR HTML 里
        就已经是 visible=true, 浏览器拿到首屏 HTML 那一刻弹窗就在,
        不会出现页面先显示、登录弹窗随后闪入的延迟.
        登录态 SSR 注水流程: server middleware 02.auth.js → context.user
        → app.vue 的 useState('user-bootstrap') → userStore.setUser
        → useAuth().isLoggedIn = true (layout setup 期已可用).
   =========================================================== */
const { isLoggedIn } = useAuth()

const loginModalVisible      = ref(!isLoggedIn.value)
const langModalVisible       = ref(false)
const accountModalVisible    = ref(false)
const accountModalInitialTab = ref('general')
const mcpConnectModalVisible = ref(false)

provide('openLogin',      () => { loginModalVisible.value      = true })
provide('openLanguage',   () => { langModalVisible.value       = true })
provide('openAccount',    (tab = 'general') => {
  accountModalInitialTab.value = tab || 'general'
  accountModalVisible.value = true
})
provide('openMcpConnect', () => { mcpConnectModalVisible.value = true })

function switchToLanguage() {
  loginModalVisible.value = false
  langModalVisible.value = true
}

function onLanguageClose() {
  langModalVisible.value = false
  if (!isLoggedIn.value) loginModalVisible.value = true
}

/* ---- watch: 登录后关弹窗, 退出后再弹 (切语言期间不抢) ---- */
watch(isLoggedIn, (v) => {
  if (v) {
    loginModalVisible.value = false
  } else if (!langModalVisible.value) {
    loginModalVisible.value = true
  }
})
</script>
