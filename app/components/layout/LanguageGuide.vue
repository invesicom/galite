<script setup>
/* ========================================================================== *
 * LanguageGuide — 浏览器语言引导切换
 *
 * 触发条件 (全部满足才显示):
 *   1. 浏览器语言能匹配站点支持的某个 locale (精确 / 基础语言 / alias)
 *   2. 该 locale 与当前页面 locale 不同
 *   3. 用户未在过去 30 天内 dismiss
 *
 * 设计:
 *   - 仅客户端运行 (onMounted), SSR 安全
 *   - 文案覆盖全部 25 种语言，用 browserLang 选择用户能理解的提示
 *     即"用用户母语提示是否切换", 不依赖 vue-i18n 当前 locale
 *   - 底部 fixed toast, 不打断用户操作 (pointer-events 仅在按钮区生效)
 *   - 跳转用 nuxt-i18n 的 switchLocalePath, 保留当前路径与 query
 *
 * 哲学: 引导是一次邀请, 不是强制. 用户母语提示比英文 "switch language" 更友好,
 *       30 天 dismissal 缓存防止打扰
 * ========================================================================== */

import { computed, onMounted, ref } from 'vue'

const { locales, locale: currentLocale } = useI18n()
const switchLocalePath = useSwitchLocalePath()
const router = useRouter()

const visible = ref(false)
const browserLang = ref('') /* 命中的目标 locale code */

const CACHE_KEY = 'lang_guide_dismissed_v1'
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000 /* 30 天 */

/* 25 种语言的提示文案（使用各自母语） */
const COPY = {
  en: { prompt: 'Switch to the English version?', yes: 'Yes', no: 'No' },
  'zh-cn': { prompt: '是否切换到中文（简体）版本？', yes: '是', no: '否' },
  'zh-tw': { prompt: '是否切換到中文（繁體）版本？', yes: '是', no: '否' },
  de: { prompt: 'Zur deutschen Version wechseln?', yes: 'Ja', no: 'Nein' },
  es: { prompt: '¿Cambiar a la versión en español?', yes: 'Sí', no: 'No' },
  fr: { prompt: 'Passer à la version française ?', yes: 'Oui', no: 'Non' },
  ru: { prompt: 'Переключиться на русскую версию?', yes: 'Да', no: 'Нет' },
  ja: { prompt: '日本語版に切り替えますか？', yes: 'はい', no: 'いいえ' },
  it: { prompt: 'Passare alla versione italiana?', yes: 'Sì', no: 'No' },
  ko: { prompt: '한국어 버전으로 전환할까요?', yes: '예', no: '아니오' },
  ar: { prompt: 'هل تريد التبديل إلى النسخة العربية؟', yes: 'نعم', no: 'لا' },
  'pt-pt': { prompt: 'Mudar para a versão em português?', yes: 'Sim', no: 'Não' },
  nl: { prompt: 'Overschakelen naar de Nederlandse versie?', yes: 'Ja', no: 'Nee' },
  cs: { prompt: 'Přejít na českou verzi?', yes: 'Ano', no: 'Ne' },
  uk: { prompt: 'Перейти на українську версію?', yes: 'Так', no: 'Ні' },
  hi: { prompt: 'क्या हिंदी संस्करण पर स्विच करें?', yes: 'हाँ', no: 'नहीं' },
  tr: { prompt: 'Türkçe sürüme geçilsin mi?', yes: 'Evet', no: 'Hayır' },
  fa: { prompt: 'به نسخه فارسی برویم؟', yes: 'بله', no: 'خیر' },
  id: { prompt: 'Beralih ke versi bahasa Indonesia?', yes: 'Ya', no: 'Tidak' },
  th: { prompt: 'สลับเป็นภาษาไทยหรือไม่?', yes: 'ใช่', no: 'ไม่' },
  bn: { prompt: 'বাংলা সংস্করণে যাবেন?', yes: 'হ্যাঁ', no: 'না' },
  ur: { prompt: 'کیا اردو ورژن پر جانا ہے؟', yes: 'ہاں', no: 'نہیں' },
  uz: { prompt: "O'zbekcha versiyaga o'tulsinmi?", yes: 'Ha', no: "Yo'q" },
  vi: { prompt: 'Chuyển sang phiên bản tiếng Việt?', yes: 'Có', no: 'Không' },
  pl: { prompt: 'Przełączyć na wersję polską?', yes: 'Tak', no: 'Nie' },
}

/* alias: 把浏览器返回的细粒度 locale 收敛到我们支持的 code */
const ALIAS = {
  zh: 'zh-cn',
  'zh-hans': 'zh-cn',
  'zh-hans-cn': 'zh-cn',
  'zh-hant': 'zh-tw',
  'zh-hant-tw': 'zh-tw',
  'zh-hk': 'zh-tw',
  pt: 'pt-pt',
  'pt-br': 'pt-pt',
}

const supportedSet = computed(
  () => new Set(locales.value.map((l) => String(l.code).toLowerCase())),
)

/* 标准化: trim + 全小写 + 下划线转中划线 */
function normalize(s) {
  return String(s || '').toLowerCase().replace('_', '-').trim()
}

/* 把任意浏览器 locale 解析成站点支持的 locale code, 命中不到返回空 */
function resolveBrowserLang() {
  if (typeof navigator === 'undefined') return ''
  const raw = navigator.language || navigator.userLanguage || ''
  const norm = normalize(raw)
  if (!norm) return ''

  const set = supportedSet.value

  /* 1. 精确匹配 */
  if (set.has(norm)) return norm

  /* 2. alias 映射 */
  if (ALIAS[norm] && set.has(ALIAS[norm])) return ALIAS[norm]

  /* 3. 基础语言匹配 (en-US → en) */
  const base = norm.split('-')[0]
  if (set.has(base)) return base
  if (ALIAS[base] && set.has(ALIAS[base])) return ALIAS[base]

  /* 4. 同基础语言的任一 locale (zh-MO → zh-cn 之类) */
  for (const code of set) {
    if (code.split('-')[0] === base) return code
  }

  return ''
}

/* localStorage dismissal 缓存 */
function isDismissed() {
  if (typeof window === 'undefined') return false
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return false
    const at = Number(raw)
    if (!Number.isFinite(at) || at <= 0) return false
    return Date.now() - at < CACHE_TTL_MS
  } catch {
    return false
  }
}
function markDismissed() {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(CACHE_KEY, String(Date.now()))
  } catch { /* noop */ }
}

const copy = computed(() => COPY[browserLang.value] || null)

function emitTrack(eventName) {
  if (typeof window === 'undefined') return
  /* 复用 tracking 三件套全局壳 (plugins/tracking.client.js 注入); 缺失时静默 */
  try {
    if (typeof window.emitGa4Event === 'function') {
      window.emitGa4Event(eventName, {
        event_category: 'language_guide',
        event_label: browserLang.value,
      })
    }
  } catch { /* noop */ }
}

function onAccept() {
  emitTrack('language_guide_yes')
  markDismissed()
  visible.value = false
  const target = switchLocalePath(browserLang.value)
  if (target) router.push(target)
}

function onDismiss() {
  emitTrack('language_guide_no')
  markDismissed()
  visible.value = false
}

onMounted(() => {
  if (isDismissed()) return

  const target = resolveBrowserLang()
  if (!target) return
  if (target === normalize(currentLocale.value)) return
  if (!COPY[target]) return /* 无文案则不打扰 */

  browserLang.value = target
  visible.value = true
})
</script>

<template>
  <Transition name="lang-guide-fade">
    <div
      v-if="visible && copy"
      class="lang-guide"
      role="alert"
      aria-live="polite"
    >
      <div class="lang-guide-card">
        <div class="lang-guide-message">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6" />
            <path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" stroke="currentColor" stroke-width="1.4" />
          </svg>
          <span>{{ copy.prompt }}</span>
        </div>
        <div class="lang-guide-actions">
          <button type="button" class="lang-guide-btn lang-guide-btn-yes" @click="onAccept">
            {{ copy.yes }}
          </button>
          <button type="button" class="lang-guide-btn lang-guide-btn-no" @click="onDismiss">
            {{ copy.no }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.lang-guide {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 16px;
  /* z-index 85 = 优先级第一档 "非阻塞引导":
   *   高于 AgeGateModal (z-80) 让访客在年龄确认前能先选母语
   *   低于 ToastContainer (z-90) 让操作反馈仍能压它一头 */
  z-index: 85;
  display: flex;
  justify-content: center;
  padding: 0 16px;
  pointer-events: none; /* 整层不挡其他交互, 只在卡片上启用 */
}

.lang-guide-card {
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
  padding: 14px 18px;
  background: #18181c;
  color: #f5f7ff;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.32);
  font-size: 14px;
  font-weight: 500;
  max-width: 100%;
}

.lang-guide-message {
  display: flex;
  align-items: center;
  gap: 8px;
  text-align: center;
  justify-content: center;
}
.lang-guide-message svg {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.7);
}

.lang-guide-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
}
.lang-guide-btn {
  min-width: 64px;
  padding: 7px 16px;
  border-radius: 999px;
  border: none;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s ease, background 0.15s ease;
}
.lang-guide-btn-yes {
  background: #fff;
  color: #111;
}
.lang-guide-btn-yes:hover { opacity: 0.92; }
.lang-guide-btn-no {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}
.lang-guide-btn-no:hover { background: rgba(255, 255, 255, 0.16); }

/* 桌面: 横排紧凑 */
@media (min-width: 768px) {
  .lang-guide-card {
    flex-direction: row;
    align-items: center;
    gap: 16px;
    width: auto;
    margin: 0 auto;
  }
  .lang-guide-message {
    text-align: left;
    justify-content: flex-start;
  }
}

/* 渐入/渐出 */
.lang-guide-fade-enter-active,
.lang-guide-fade-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}
.lang-guide-fade-enter-from,
.lang-guide-fade-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
