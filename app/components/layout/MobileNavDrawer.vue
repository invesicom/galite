<template>
  <!-- ========================================
       MobileNavDrawer
         左侧滑入的移动端导航抽屉
         - 只消费父布局传入的固定导航
         - 通过 inject 触发全局登录 / 语言弹窗
         - visible + @close 是与父组件的唯一耦合
       ======================================== -->
  <Teleport to="body">
    <!-- z-[60] 显式高于 sticky header: Drawer 是用户主动触发的全屏覆盖,
         必须遮住通知条; 留出更高 z-index 给业务 Modal 的逃生通道 -->
    <Transition name="modal-fade">
      <div
        v-if="visible"
        class="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[3px] md:hidden"
        @click="$emit('close')"
      />
    </Transition>
    <Transition name="slide-left">
      <aside
        v-if="visible"
        class="fixed bottom-0 left-0 top-0 z-[60] flex w-80 max-w-[85vw] flex-col bg-white shadow-2xl md:hidden"
      >
        <!-- Header: logo + close -->
        <div
          class="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 px-4"
        >
          <div class="flex items-center gap-2.5">
            <img
              v-if="logo.logo_64"
              :src="logo.logo_64"
              class="h-7 w-auto rounded-md"
              alt=""
            />
            <span class="text-base font-bold text-gray-900">{{ siteName }}</span>
          </div>
          <button
            class="flex size-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100"
            @click="$emit('close')"
          >
            <svg class="size-5" viewBox="0 0 24 24" fill="none">
              <path
                d="M18 6L6 18M6 6l12 12"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </div>

        <!-- User info (logged in) -->
        <div
          v-if="isLoggedIn"
          class="shrink-0 border-b border-gray-100 px-4 py-3"
        >
          <div class="flex items-center gap-3">
            <img
              v-if="userStore.user?.photo_url"
              :src="userStore.user.photo_url"
              class="size-10 rounded-full object-cover"
              alt=""
            />
            <div
              v-else
              class="flex size-10 items-center justify-center rounded-full bg-gray-100 text-gray-400"
            >
              <NuxtIcon name="ri:user-3-line" class="size-5" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-semibold text-gray-900">
                {{ userStore.displayName }}
              </div>
              <div
                v-if="userStore.user?.email"
                class="mt-0.5 truncate text-xs text-gray-500"
              >
                {{ userStore.user.email }}
              </div>
            </div>
          </div>
        </div>

        <!-- Nav list -->
        <nav class="flex-1 overflow-y-auto px-2 py-3">
          <template v-for="(item, idx) in headerNavItems" :key="'d-' + idx">
            <!-- 分组 -->
            <div v-if="item.is_group" class="py-1">
              <div
                class="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-gray-400"
              >
                {{ item.name }}
              </div>
              <template v-for="(l, li) in item.links" :key="'dl-' + li">
                <button
                  v-if="l.is_action"
                  class="block w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-primary"
                  @click="onAction(l.action)"
                >
                  {{ l.name }}
                </button>
                <a
                  v-else-if="l.is_external"
                  :href="l.href"
                  target="_blank"
                  :rel="l.nofollow ? 'noopener nofollow' : 'noopener'"
                  class="block rounded-lg px-3 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-primary"
                  @click="$emit('close')"
                >
                  {{ l.name }}
                </a>
                <NuxtLink
                  v-else
                  :to="localePath(l.to)"
                  :rel="l.nofollow ? 'nofollow' : undefined"
                  :class="[
                    'block rounded-lg px-3 py-2.5 text-sm font-medium transition-colors hover:bg-gray-50 hover:text-primary',
                    isLinkActive(l)
                      ? 'bg-primary/5 text-primary'
                      : 'text-gray-600',
                  ]"
                  @click="$emit('close')"
                >
                  {{ l.name }}
                </NuxtLink>
              </template>
            </div>

            <!-- 单链接: 动作 -->
            <button
              v-else-if="item.is_action"
              class="block w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-primary"
              @click="onAction(item.action)"
            >
              {{ item.name }}
            </button>

            <!-- 单链接: 外链 -->
            <a
              v-else-if="item.is_external"
              :href="item.href"
              target="_blank"
              :rel="item.nofollow ? 'noopener nofollow' : 'noopener'"
              class="block rounded-lg px-3 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-primary"
              @click="$emit('close')"
            >
              {{ item.name }}
            </a>

            <!-- 单链接: 内部 -->
            <NuxtLink
              v-else
              :to="localePath(item.to)"
              :rel="item.nofollow ? 'nofollow' : undefined"
              :class="[
                'block rounded-lg px-3 py-2.5 text-sm font-medium transition-colors hover:bg-gray-50 hover:text-primary',
                isLinkActive(item)
                  ? 'bg-primary/5 text-primary'
                  : 'text-gray-600',
              ]"
              @click="$emit('close')"
            >
              {{ item.name }}
            </NuxtLink>
          </template>
        </nav>

        <!-- Footer tools -->
        <div class="shrink-0 border-t border-gray-100 px-2 py-2">
          <button
            class="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-primary"
            @click="onOpenLanguage"
          >
            <svg class="size-4" viewBox="0 0 24 24" fill="none">
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="1.5"
              />
              <path
                d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10A15.3 15.3 0 0 1 12 2z"
                stroke="currentColor"
                stroke-width="1.5"
              />
            </svg>
            {{ t("lang.switch_language") }}
          </button>
          <button
            v-if="!isLoggedIn"
            class="mt-1 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-text transition-opacity hover:opacity-90"
            @click="onOpenLogin"
          >
            {{ t("common.login") }}
          </button>
          <button
            v-else
            class="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-red-500 transition-colors hover:bg-red-50"
            @click="onLogout"
          >
            <svg class="size-4" viewBox="0 0 24 24" fill="none">
              <path
                d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            {{ t("common.logout") }}
          </button>
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>

<script setup>
/* ===========================================================================
   MobileNavDrawer
     左侧滑入的移动端导航抽屉 (md:hidden)
     导航来自父布局固定数组; 动作桥只负责 login / language
   =========================================================================== */

const props = defineProps({
  visible: { type: Boolean, required: true },
  /* landing 的 PC 菜单与移动端 drawer 共享同一份固定导航数据 */
  items: { type: Array, default: null },
});

const emit = defineEmits(["close"]);

const { t, locale } = useI18n();
const route = useRoute();
const localePath = useLocalePath();
const configStore = useConfigStore();
const userStore = useUserStore();
const { isLoggedIn, logout } = useAuth();

/* ---- 注入全局弹窗触发器 ---- */
const openLogin = inject("openLogin", () => {});
const openLanguage = inject("openLanguage", () => {});

/* ---- 站点配置 ---- */
const resolvedConfig = computed(() => configStore.getTranslated(locale.value));
const siteName = computed(() =>
  String(resolvedConfig.value.site_name || "GA Lite"),
);
const logo = computed(() => resolvedConfig.value.logo || {});

const headerNavItems = computed(() => Array.isArray(props.items) ? props.items : []);

/* ---- Active 路由匹配 ---- */
function isLinkActive(item) {
  if (!item || item.is_action || item.is_external) return false;
  const rawTarget = String(item.to || "");
  if (!rawTarget || rawTarget.startsWith("#")) return false;
  const target = localePath(rawTarget);
  const current = route.path;
  const homePath = localePath("/");
  if (target === homePath) return current === homePath;
  return current === target || current.startsWith(target + "/");
}

/* ---- 关闭 + 延迟触发动作 (避免同帧 state 冲突) ---- */
function closeAnd(fn) {
  emit("close");
  if (typeof fn === "function") fn();
}

function onAction(action) {
  if (action === "login") closeAnd(openLogin);
  else emit("close");
}

function onOpenLanguage() {
  closeAnd(openLanguage);
}

function onOpenLogin() {
  closeAnd(openLogin);
}

function onLogout() {
  closeAnd(logout);
}
</script>
