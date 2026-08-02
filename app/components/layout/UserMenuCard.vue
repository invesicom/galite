<script setup>
/* ===========================================================
   UserMenuCard - sidebar 底部用户身份卡 + hover 弹出菜单
   --
   职责:
     - 未登录: 渲染登录按钮 -> 触发 LoginModal
     - 已登录: 渲染头像/名字, hover 卡片展开设置 / 语言 / 退出菜单
   --
   设计:
     - hover wrapper 即显示 popup (移除 click toggle / outside-click / ESC)
     - popup 是 wrapper 的子元素, 鼠标从触发器移到 popup 期间 wrapper 仍 hover,
       不会闪现
     - 折叠态 (collapsed=true): popup 改向右侧弹 (left-full)
   =========================================================== */

const props = defineProps({
  collapsed: { type: Boolean, default: false },
  /* placement 控制 popup 浮层方向:
     'top'    — 默认, 弹层在触发器上方 (sidebar 底部展开态)
     'right'  — 弹层在右侧 (sidebar 折叠态)
     'bottom' — 弹层在下方右对齐 (移动端顶栏头像) */
  placement: { type: String, default: 'top' },
})

const { t } = useI18n()
const { isLoggedIn, logout } = useAuth()
const userStore = useUserStore()

const openLogin    = inject('openLogin',    () => {})
const openAccount  = inject('openAccount',  () => {})
const openLanguage = inject('openLanguage', () => {})

const planLabel = 'Self-hosted'

/* ---- hover 显示菜单 ---- */
const menuOpen = ref(false)
function showMenu() { menuOpen.value = true }
function hideMenu() { menuOpen.value = false }

/* ---- 菜单项动作: 触发对应 modal/动作, 同时关闭菜单 ---- */
function handleAccount()  { hideMenu(); openAccount() }
function handleLanguage() { hideMenu(); openLanguage() }
function handleLogout()   { hideMenu(); logout() }

/* ---- popup 位置 (由 placement 决定) ---- */
const popupPosClass = computed(() => {
  if (props.placement === 'right')  return 'bottom-0 left-full pl-1.5'
  if (props.placement === 'bottom') return 'top-full right-0 pt-1.5'
  return 'bottom-full left-0 right-0 pb-1.5'  /* 默认 top */
})
</script>

<template>
  <div class="relative">

    <!-- ============ 未登录: 登录按钮 (纯文字, 无图标; 折叠态空间不足时 truncate, tooltip 兜底) ============ -->
    <button
      v-if="!userStore.user"
      v-tooltip.right="collapsed ? t('common.login') : ''"
      type="button"
      :class="[
        /* sidebar 展开态用 w-full 撑满分割块, collapsed (mobile header / sidebar 折叠)
           父容器无明确宽度, 用内容自适应避免按钮 0 宽度塌缩 */
        'flex items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-text transition-opacity hover:opacity-90',
        collapsed ? 'px-3 py-2' : 'w-full px-3 py-2',
      ]"
      @click="openLogin()"
    >
      <span class="truncate">{{ t('common.login') }}</span>
    </button>

    <!-- ============ 已登录: 用户卡片 (hover 区) + 升级按钮 (独立, 不触发 menu) ============ -->
    <template v-else>
      <!-- hover 触发区: 头像卡 + popup (升级按钮独立放在外面, hover 它不弹菜单).
           不挂 tooltip — hover 已弹完整菜单 (含 displayName), tooltip 重复且会与
           菜单浮层抢占同一 z 区域, 制造视觉噪音 -->
      <div class="relative" @mouseenter="showMenu" @mouseleave="hideMenu">
        <div
          :class="[
            /* 展开态: w-full + p-2 文字布局
               折叠态: size-10 (40×40 正方形, 与 sidebar w-14 - px-2*2 = 40 完全贴合)
                       gap-0 不留空, 头像 size-8 居中放置, 视觉是 4px 内边距的正方形 hover 区 */
            'flex cursor-pointer items-center rounded-xl border border-transparent transition-colors hover:border-gray-200 hover:bg-gray-50',
            collapsed ? 'size-10 justify-center' : 'w-full gap-2 p-2',
            menuOpen ? 'border-gray-200 bg-gray-50' : '',
          ]"
        >
          <img
            v-if="userStore.user?.photo_url"
            :src="userStore.user.photo_url"
            class="size-8 shrink-0 rounded-full object-cover"
            alt=""
          />
          <div
            v-else
            class="flex size-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-400"
          >
            <NuxtIcon name="ri:user-3-line" class="size-4.5" />
          </div>
          <div v-if="!collapsed" class="min-w-0 flex-1 text-left">
            <div class="truncate text-sm font-medium text-gray-900">{{ userStore.displayName }}</div>
            <div class="truncate text-xs text-gray-400">{{ planLabel }}</div>
          </div>
        </div>

        <!-- hover 弹出菜单 (锚到头像卡; padding 区作为 hover 桥, 与 card 合并为
             单一白色容器, 消除 trigger 与 menu 之间的"透明缝隙") -->
        <Transition name="modal-fade">
          <div
            v-if="menuOpen"
            :class="[
              'absolute z-50 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl',
              collapsed ? 'w-60' : 'w-full',
              popupPosClass,
            ]"
          >
        <!-- 弹层顶部: 头像 + 名字 + 部署形态 -->
        <div class="flex items-center gap-2.5 border-b border-gray-100 px-4 py-3">
          <img
            v-if="userStore.user?.photo_url"
            :src="userStore.user.photo_url"
            class="size-9 shrink-0 rounded-full object-cover"
            alt=""
          />
          <div
            v-else
            class="flex size-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-400"
          >
            <NuxtIcon name="ri:user-3-line" class="size-5" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium text-gray-900">{{ userStore.displayName }}</div>
            <div class="truncate text-xs text-gray-400">{{ planLabel }}</div>
          </div>
        </div>

        <!-- 菜单项 -->
        <div class="py-1.5">
          <button
            type="button"
            class="flex w-full items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            @click="handleAccount"
          >
            <NuxtIcon name="ri:settings-3-line" class="size-4 text-gray-500" />
            {{ t('common.settings') }}
          </button>
          <button
            type="button"
            class="flex w-full items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            @click="handleLanguage"
          >
            <NuxtIcon name="ri:global-line" class="size-4 text-gray-500" />
            {{ t('lang.switch_language') }}
          </button>
          <button
            type="button"
            class="flex w-full items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            @click="handleLogout"
          >
            <NuxtIcon name="ri:logout-box-r-line" class="size-4 text-gray-500" />
            {{ t('common.logout') }}
          </button>
        </div>
          </div>
        </Transition>
      </div>
    </template>
  </div>
</template>
