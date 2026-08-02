<script setup>
/* ===========================================================
   McpConnectModal - MCP 连接配置弹窗
   --
   职责: 给已登录用户提供 2 种 MCP 接入文案 (AI 提示 / 手动 JSON),
          一键复制即可粘到客户端 (Claude Desktop / Cursor / Cline / Continue)
   --
   设计:
     - 无需密钥: MCP 端走 OAuth 2.1 + PKCE, 首次调用时浏览器跳授权页
     - URL 来源: D1 自定义 Origin 或当前请求 Origin + '/api/mcp'
     - 站点 key: siteName 取小写 + 去非字母数字, 兜底 'mcp'
     - 默认 tab = 发送给 AI，降低首次接入门槛
   =========================================================== */

const props = defineProps({
  visible: { type: Boolean, default: false },
})

const emit = defineEmits(['close'])

const { t, locale } = useI18n()
const { show: showToast } = useToast()
const configStore = useConfigStore()
const { publicOrigin } = useSiteConfig()

/* ---- 站点身份 ---- */
const resolvedConfig = computed(() => configStore.getTranslated(locale.value) || {})
const siteName = computed(() => String(resolvedConfig.value.site_name || configStore.siteName || 'MCP'))
const mcpKey = computed(() => {
  const slug = String(siteName.value).toLowerCase().replace(/[^a-z0-9]/g, '')
  return slug || 'mcp'
})

/* ---- MCP endpoint ---- */
const mcpEndpoint = computed(() => `${publicOrigin.value}/api/mcp`)

/* ---- Tab 切换 (默认: AI 提示) ---- */
const activeTab = ref('ai')
const tabs = computed(() => [
  { key: 'ai',     label: t('mcp_connect.tab_ai') },
  { key: 'manual', label: t('mcp_connect.tab_manual') },
])

/* ---- 两种接入文案 ----
   AI prompt 首句走 i18n (含 {name} 占位), 跟随当前语言;
   下两行 Server URL / Type 是 client 可识别的固定标记, 保留英文以确保 AI 解析稳定 */
const aiSnippet = computed(() => (
  `${t('mcp_connect.ai_prompt', { name: siteName.value })}\n`
  + `Server URL: ${mcpEndpoint.value}\n`
  + `Type: http`
))

const manualSnippet = computed(() => JSON.stringify({
  mcpServers: {
    [mcpKey.value]: {
      type: 'http',
      url: mcpEndpoint.value,
    },
  },
}, null, 2))

const currentSnippet = computed(() => activeTab.value === 'ai' ? aiSnippet.value : manualSnippet.value)

/* ---- 复制 ---- */
async function copySnippet() {
  if (!import.meta.client) return
  try {
    await navigator.clipboard.writeText(currentSnippet.value)
    showToast(t('mcp_connect.copied'), { type: 'success' })
  } catch {
    showToast(t('mcp_connect.copy_failed'), { type: 'error' })
  }
}

/* ---- ESC 关闭 ---- */
function onKeydown(e) { if (e.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="visible"
        class="fixed inset-0 z-[70] flex items-center justify-center bg-black/25 p-4 backdrop-blur-[3px]"
        @click.self="emit('close')"
      >
        <div class="relative w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-xl">

          <!-- 头部 -->
          <div class="flex items-center justify-between border-b border-gray-100 px-6 py-4">
            <h2 class="text-lg font-bold text-gray-900">{{ t('mcp_connect.title') }}</h2>
            <button
              class="flex size-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              :aria-label="t('common.close')"
              @click="emit('close')"
            >
              <NuxtIcon name="ri:close-line" class="size-5" />
            </button>
          </div>

          <!-- 主体 -->
          <div class="space-y-4 px-6 py-5">
            <!-- 无密钥说明 -->
            <p class="text-sm text-gray-500">
              {{ t('mcp_connect.no_key_hint') }}
            </p>

            <!-- Tab 切换 -->
            <div class="inline-flex rounded-full border border-gray-200 bg-gray-50 p-1">
              <button
                v-for="tab in tabs"
                :key="tab.key"
                type="button"
                class="rounded-full px-4 py-1.5 text-xs font-medium transition-all sm:text-sm"
                :class="activeTab === tab.key
                  ? 'bg-white text-primary shadow-sm ring-1 ring-primary/30'
                  : 'text-gray-500 hover:text-gray-700'"
                @click="activeTab = tab.key"
              >
                {{ tab.label }}
              </button>
            </div>

            <!-- 代码块 + Copy -->
            <div class="relative">
              <pre class="overflow-x-auto rounded-xl border border-gray-200 bg-gray-50 p-4 pr-20 text-xs leading-relaxed text-gray-800"><code>{{ currentSnippet }}</code></pre>
              <button
                type="button"
                class="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-white px-2.5 py-1 text-xs font-medium text-gray-600 shadow-sm ring-1 ring-gray-200 transition-colors hover:bg-gray-50 hover:text-gray-900"
                @click="copySnippet"
              >
                <NuxtIcon name="ri:file-copy-line" class="size-3.5" />
                {{ t('mcp_connect.copy') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
