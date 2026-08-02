<script setup>
/* ========================================================================== *
 * ShareModal — 通用分享弹窗
 *
 * 平台 intent URL 由统一注册表构建，弹窗通过 Teleport 渲染。
 *
 * 结构 (上→下):
 *   1. 标题栏        "Share with friends" + ×
 *   2. 平台九宫格    12 个快捷分享入口 (whatsapp / line / tg / msg / fb /
 *                    threads / x / reddit / linkedin / naver / email / more)
 *   3. 复制链接按钮  长条灰底, 点击 clipboard.writeText + toast
 *   4. 品牌徽标      站点 logo + 名字 (品牌曝光, 与其它 modal 一致)
 *
 * 调用方只需传 shareUrl + 可选 shareTitle, 组件内部会:
 *   · 自动拼接 utm_source=<platform> 便于分析来源
 *   · 对 share_more 优先调用 navigator.share, 桌面端降级为 no-op
 *   · 分享完成后 emit('close') 让调用方收起弹窗
 * ========================================================================== */

import { computed, onMounted, onUnmounted } from "vue";

const props = defineProps({
  visible: { type: Boolean, default: false },
  shareUrl: { type: String, default: "" },
  shareTitle: { type: String, default: "" },
  showBranding: { type: Boolean, default: true },
});

const emit = defineEmits(["close"]);

const { t, locale } = useI18n();
const configStore = useConfigStore();
const appToast = useToast();

/* ---------------------------------- 品牌 ---------------------------------- */

const resolvedConfig = computed(() => configStore.getTranslated(locale.value));
const siteName = computed(() =>
  String(resolvedConfig.value?.site_name || configStore.siteName || "GA Lite")
);
const siteLogo = computed(() =>
  String(resolvedConfig.value?.logo?.logo_64 || "")
);

/* ---------------------------------- 平台表 -------------------------------- *
 * 每行一个平台，图标均使用仓库内的 public/images/icon/share/*.svg。
 * intentUrl(link, title) 只处理第三方站点的 intent URL；copy_link / share_more
 * 走特殊分支, 不在此表.
 * -------------------------------------------------------------------------- */

const PLATFORMS = [
  {
    key: "whatsapp",
    label: "WhatsApp",
    icon: "/images/icon/share/whatsapp.svg",
  },
  { key: "line", label: "Line", icon: "/images/icon/share/line.svg" },
  {
    key: "telegram",
    label: "Telegram",
    icon: "/images/icon/share/telegram.svg",
  },
  {
    key: "messenger",
    label: "Messenger",
    icon: "/images/icon/share/messenger.svg",
  },
  {
    key: "facebook",
    label: "Facebook",
    icon: "/images/icon/share/facebook.svg",
  },
  { key: "threads", label: "Threads", icon: "/images/icon/share/threads.svg" },
  { key: "x", label: "X", icon: "/images/icon/share/x.svg" },
  { key: "reddit", label: "Reddit", icon: "/images/icon/share/reddit.svg" },
  {
    key: "linkedin",
    label: "LinkedIn",
    icon: "/images/icon/share/linkedin.svg",
  },
  { key: "naver", label: "Naver", icon: "/images/icon/share/naver.svg" },
  { key: "email", label: "Email", icon: "/images/icon/share/email.svg" },
  {
    key: "share_more",
    label: () => t("share_more"),
    icon: "/images/icon/share/more.svg",
    bgRound: true,
  },
];

function intentUrl(platform, link, title) {
  const l = encodeURIComponent(link);
  const tt = encodeURIComponent(title || link);
  const ttPlusL = encodeURIComponent(`${title || ""} ${link}`.trim());
  switch (platform) {
    case "whatsapp":
      return `whatsapp://send?text=${ttPlusL}`;
    case "line":
      return `https://line.me/R/share?text=${ttPlusL}`;
    case "telegram":
      return `https://t.me/share/url?text=${tt}&url=${l}`;
    case "messenger":
      return `fb-messenger://share/?link=${l}`;
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${l}`;
    case "threads":
      return `https://www.threads.com/intent/post?text=${ttPlusL}`;
    case "x":
      return `https://twitter.com/intent/tweet?url=${l}&text=${tt}`;
    case "reddit":
      return `https://www.reddit.com/submit?title=${tt}&url=${l}&type=LINK`;
    case "linkedin":
      return `https://www.linkedin.com/feed/?shareActive=true&text=${tt}&shareUrl=${l}`;
    case "naver":
      return `https://share.naver.com/web/shareView?url=${l}&title=${tt}`;
    case "email":
      return `mailto:?subject=${tt}&body=${l}`;
    default:
      return "";
  }
}

/* --------------------------------- 动作 ----------------------------------- */

function composeTrackedUrl(platform) {
  const base = String(props.shareUrl || "").trim();
  if (!base) return "";
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}utm_source=${platform}`;
}

async function handlePlatform(platform) {
  const tracked = composeTrackedUrl(platform);
  if (!tracked) {
    appToast.show(t("share_not_found"), { type: "warning" });
    emit("close");
    return;
  }

  if (platform === "copy_link") {
    try {
      await navigator.clipboard.writeText(tracked);
      appToast.show(t("share_link_copied"), { type: "success" });
    } catch {
      appToast.show(t("share_copy_failed"), { type: "warning" });
    }
    emit("close");
    return;
  }

  if (platform === "share_more") {
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function"
    ) {
      try {
        await navigator.share({ title: props.shareTitle, url: tracked });
      } catch {
        /* 用户取消 — 静默 */
      }
    }
    emit("close");
    return;
  }

  const url = intentUrl(platform, tracked, props.shareTitle);
  if (url) window.open(url, "_blank", "noopener,noreferrer");
  emit("close");
}

function resolveLabel(p) {
  return typeof p.label === "function" ? p.label() : p.label;
}

/* --------------------------------- 键盘/遮罩关闭 -------------------------- */

function onKeydown(e) {
  if (e.key === "Escape" && props.visible) emit("close");
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="visible"
        class="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4 backdrop-blur-[3px]"
        @click.self="emit('close')"
      >
        <div
          class="relative w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl"
        >
          <!-- 标题栏 -->
          <div
            class="flex items-center justify-between border-b border-gray-100 px-6 py-4"
          >
            <h2 class="text-lg font-bold text-gray-900">
              {{ t("share_with_friends") }}
            </h2>
            <button
              class="flex size-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              @click="emit('close')"
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

          <!-- 九宫格快捷分享 -->
          <div class="grid grid-cols-4 gap-4 px-6 py-6">
            <button
              v-for="p in PLATFORMS"
              :key="p.key"
              type="button"
              class="flex flex-col items-center gap-2 rounded-lg p-2 text-xs text-gray-700 transition-colors hover:bg-gray-50"
              @click="handlePlatform(p.key)"
            >
              <img
                :src="p.icon"
                :alt="`share to ${p.key}`"
                :class="
                  p.bgRound
                    ? 'size-[42px] rounded-full bg-white p-1'
                    : 'size-10'
                "
              />
              <span class="truncate">{{ resolveLabel(p) }}</span>
            </button>
          </div>

          <!-- 复制链接 -->
          <div class="px-6 pb-5">
            <button
              type="button"
              class="flex w-full items-center justify-center gap-3 rounded-xl bg-gray-100 py-3 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-200"
              @click="handlePlatform('copy_link')"
            >
              <span>{{ t("share_copy_link") }}</span>
              <img src="/images/icon/share/copy.svg" alt="" class="size-4" />
            </button>
          </div>

          <!-- 品牌徽标 -->
          <div
            v-if="props.showBranding && (siteLogo || siteName)"
            class="flex items-center justify-center gap-2 border-t border-gray-100 px-6 py-4"
          >
            <img
              v-if="siteLogo"
              :src="siteLogo"
              class="size-6 rounded-md"
              :alt="siteName"
            />
            <div class="text-base font-bold text-gray-900">{{ siteName }}</div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.18s ease;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
</style>
