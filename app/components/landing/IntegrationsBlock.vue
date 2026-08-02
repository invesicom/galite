<template>
  <!-- ============================================================
       IntegrationsBlock — 一图概括 MCP 生态
       --
       去除 chip 容器, 改成"图标 + 名字"网格. 无边框、无阴影、无卡片,
       让 logo 自带的形状对比讲故事. 桌面 4 列两行 = 8 个常见 MCP client,
       移动 2 列四行. 顶部 H2 + 副标题, 不要 eyebrow / 不要底部小字.
       真正的连接入口在 dash sidebar McpConnectModal — 这里只做"我能接谁".
       ============================================================ -->
  <section class="border-t border-gray-100 bg-white">
    <div class="mx-auto max-w-5xl px-4 py-16 text-center sm:px-6 sm:py-24 lg:py-28">
      <h2 class="text-3xl font-semibold tracking-tight text-gray-900 sm:text-4xl lg:text-5xl">
        {{ $t('landing.mcp.title') }}
      </h2>
      <p class="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-gray-700 sm:mt-6 sm:text-lg">
        {{ $t('landing.mcp.subtitle') }}
      </p>

      <!-- ---- 图标网格 ---- -->
      <div class="mx-auto mt-12 grid max-w-3xl grid-cols-2 gap-x-6 gap-y-10 sm:mt-14 sm:grid-cols-4 sm:gap-x-8 sm:gap-y-12">
        <div
          v-for="tool in tools"
          :key="tool.name"
          class="flex flex-col items-center"
        >
          <img
            :src="tool.icon"
            :alt="tool.name"
            class="size-12 sm:size-14"
            loading="lazy"
          />
          <p class="mt-3 text-sm text-gray-700 sm:text-base">{{ tool.name }}</p>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
/* 8 个主流 MCP-aware AI client / 工具.
   文件名带空格用 URL encode (%20), 直接走 nuxt public 静态资源. */
const tools = [
  { name: 'Claude Code', icon: '/images/icon/claudecode-color%201.svg' },
  { name: 'Cursor',      icon: '/images/icon/cursor.png' },
  { name: 'Gemini',      icon: '/images/icon/gemini.png' },
  { name: 'Perplexity',  icon: '/images/icon/perplexity.png' },
  { name: 'OpenCode',    icon: '/images/icon/opencode%201.svg' },
  { name: 'OpenClaw',    icon: '/images/icon/openclaw-color%201.svg' },
  { name: 'Codex',       icon: '/images/icon/codex-color.svg' },
  { name: 'Hermes',      icon: '/images/icon/hermes.png' },
]
</script>
