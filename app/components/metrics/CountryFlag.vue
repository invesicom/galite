<script setup>
/* ============================================================
   CountryFlag - ISO 3166-1 alpha-2 国旗
   素材: /public/flags/{lowercase}.png (来自 ga-lite, 256+ 国家)
   --
   降级链:
     1. normalizeCode: 大写转小写, 不规范全名映射, 严格校验 2 字 ASCII
        非法格式 (如本地化"未知" / "Not set") 直接返空, 不发 404 请求
     2. slug 为空 → broken=true, 走 UFO SVG 占位 (语义: 无法识别该地区)
     3. <img> onerror (如 PNG 不在 256 国白名单内) → broken=true 切 UFO
   --
   设计哲学:
     - 不再用 xx.png 兜底 (太像地球, 跟正常国旗视觉混淆)
     - UFO 直观表达"位置不明", 跟 "(not set)" → "未知" 语义一致
     - 中性灰色, 不抢眼, 跟其他 country 同行视觉协调
   ============================================================ */

import { computed, ref, watch } from 'vue'

const props = defineProps({
  code: { type: String, default: '' },
  size: { type: Number, default: 16 },
})

/* ---- 全名 → ISO alpha-2 简易映射 (常见国家容错) ---- */
const SLUG_MAP = {
  'united states': 'us',
  'united kingdom': 'gb',
  'south korea': 'kr',
  'north korea': 'kp',
  'south africa': 'za',
  'czech republic': 'cz',
  'czechia': 'cz',
  'russia': 'ru',
  'taiwan': 'tw',
  'hong kong': 'hk',
}

function normalizeCode(raw) {
  const s = String(raw || '').trim().toLowerCase()
  if (!s) return ''
  if (SLUG_MAP[s]) return SLUG_MAP[s]
  /* "United States (US)" 提取括号内主码 */
  const paren = s.match(/\(([a-z]{2})\)/)
  if (paren) return paren[1]
  /* "us-tx" 提取主码 */
  if (/^[a-z]{2}-/.test(s)) return s.slice(0, 2)
  /* 严格 2 字 ASCII 才算合法 country code (排除"未知" / "Not set" 等本地化字符串) */
  if (/^[a-z]{2}$/.test(s)) return s
  return ''
}

const slug = computed(() => normalizeCode(props.code))
const broken = ref(false)

/* slug 为空 → 立刻 broken (避免发空 src 的 img 请求);
   slug 重新合法 → 重置 broken 让 <img> 重试 */
watch(
  slug,
  (v) => { broken.value = !v },
  { immediate: true },
)

const src = computed(() => `/flags/${slug.value}.png`)
</script>

<template>
  <!-- broken 态: UFO SVG 占位 (表达"无法识别地区") -->
  <span
    v-if="broken"
    :style="{ width: size + 'px', height: size + 'px' }"
    class="inline-flex shrink-0 items-center justify-center text-gray-400"
    role="img"
    aria-label="unknown region"
  >
    <svg
      :width="size"
      :height="size"
      viewBox="0 0 24 24"
      fill="currentColor"
      class="block"
    >
      <!-- 飞碟圆顶 (上半) -->
      <ellipse cx="12" cy="10.5" rx="4.5" ry="3" />
      <!-- 飞碟圆盘 (中部扁椭圆) -->
      <ellipse cx="12" cy="13" rx="9.5" ry="1.8" />
      <!-- 底部 3 灯 -->
      <circle cx="7" cy="16" r="0.8" />
      <circle cx="12" cy="17" r="0.8" />
      <circle cx="17" cy="16" r="0.8" />
    </svg>
  </span>

  <!-- 正常: <img> 国旗 (onerror 兜底切 broken) -->
  <img
    v-else
    :src="src"
    :width="size"
    :height="size"
    :style="{ width: size + 'px', height: size + 'px', objectFit: 'contain' }"
    class="inline-block shrink-0 rounded-sm"
    referrerpolicy="no-referrer"
    alt=""
    @error="broken = true"
  />
</template>
