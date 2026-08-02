<template>
  <!-- ============================================================
       CustomDateModal - 自定义日期选择 (单日 / 起止区间)
       --
       骨架沿用 FilterAddModal: Teleport + bg-black/20 遮罩 + rounded-2xl 卡片
       + Header / Body / Footer 三段 + 取消/应用双按钮.
       --
       结构:
         Header: 标题 + ✕
         Body:   [单日 | 区间] 模式切换 → 月历 (上一月/下一月 + 7×6 网格)
         Footer: 已选区间摘要 + 取消 / 应用
       --
       零依赖: 纯 Date + Intl, 全程"日历日期字符串(YYYY-MM-DD)"语义,
       字典序比较即时间序比较, 无时区歧义.
       网格永远 42 格 (6 周 × 7 天), 越界日期 disabled — 哨兵式消除头尾特判.
       ============================================================ -->
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="visible"
        class="fixed inset-0 z-[60] flex items-center justify-center bg-black/20 p-4 backdrop-blur-[3px]"
        @click.self="onClose"
      >
        <div class="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl">
          <!-- ============ Header ============ -->
          <div class="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-3.5">
            <h3 class="text-base font-semibold text-gray-900">{{ $t('metrics.period.custom_title') }}</h3>
            <button
              type="button"
              class="flex size-8 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              @click="onClose"
            >
              <NuxtIcon name="ri:close-line" class="size-4" />
            </button>
          </div>

          <!-- ============ Body ============ -->
          <div class="px-5 py-4">
            <!-- 月份导航 -->
            <div class="flex items-center justify-between">
              <button
                type="button"
                :disabled="!canPrev"
                class="flex size-8 items-center justify-center rounded-md text-gray-500 transition-colors enabled:hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-300"
                @click="shiftMonth(-1)"
              >
                <NuxtIcon name="ri:arrow-left-s-line" class="size-5" />
              </button>
              <span class="text-sm font-medium text-gray-800">{{ monthTitle }}</span>
              <button
                type="button"
                :disabled="!canNext"
                class="flex size-8 items-center justify-center rounded-md text-gray-500 transition-colors enabled:hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-300"
                @click="shiftMonth(1)"
              >
                <NuxtIcon name="ri:arrow-right-s-line" class="size-5" />
              </button>
            </div>

            <!-- 星期表头 -->
            <div class="mt-3 grid grid-cols-7 gap-1 text-center text-xs text-gray-400">
              <span v-for="(w, i) in weekdayLabels" :key="i" class="py-1">{{ w }}</span>
            </div>

            <!-- 日期网格 (42 格) -->
            <div class="mt-1 grid grid-cols-7 gap-1" @mouseleave="hover = null">
              <button
                v-for="cell in grid"
                :key="cell.iso"
                type="button"
                :disabled="cell.disabled"
                :class="cellClass(cell)"
                @click="pick(cell)"
                @mouseenter="hover = cell.disabled ? hover : cell.iso"
              >
                {{ cell.day }}
              </button>
            </div>
          </div>

          <!-- ============ Footer ============ -->
          <div class="flex items-center justify-between gap-3 border-t border-gray-100 px-5 py-3">
            <span class="min-w-0 truncate text-sm text-gray-500">
              {{ summaryText || $t('metrics.period.custom_hint') }}
            </span>
            <div class="flex shrink-0 items-center gap-2">
              <button
                type="button"
                class="rounded-full px-4 py-1.5 text-sm text-gray-500 hover:bg-gray-50"
                @click="onClose"
              >
                {{ $t('common.cancel') }}
              </button>
              <button
                type="button"
                class="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-text hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="!canApply"
                @click="onApply"
              >
                {{ $t('metrics.period.custom_apply') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
/* ============================================================
   CustomDateModal
   props:
     visible    显隐 (父控制)
     modelValue 当前 period — 若为 custom 形态则回填日历
     minDate    最早可选 ISO (默认 today - 16 个月, 对齐 GSC 滚动窗口)
     maxDate    最晚可选 ISO (默认 today)
   emits:
     close
     apply({ start, end })  ISO 字符串 (单日则 start === end)
   ============================================================ */

import { computed, ref, watch } from 'vue'
import { parseCustomPeriod } from '~/utils/period'

const props = defineProps({
  visible:    { type: Boolean, default: false },
  modelValue: { type: String,  default: '' },
  minDate:    { type: String,  default: '' },
  maxDate:    { type: String,  default: '' },
})

const emit = defineEmits(['close', 'apply'])

const { locale } = useI18n()

/* ---- 日历日期 <-> 本地 Date (统一用本地日历分量, 与用户感知的"今天"一致) ---- */
function ymd(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
function isoToDate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}
function localToday() {
  return ymd(new Date())
}
function addMonths(iso, months) {
  const [y, m, d] = iso.split('-').map(Number)
  return ymd(new Date(y, m - 1 + months, d))   /* Date 自动归一化月份溢出 */
}

/* ---- 边界: 默认 [today-16m, today] ---- */
const maxIso = computed(() => props.maxDate || localToday())
const minIso = computed(() => props.minDate || addMonths(maxIso.value, -16))

/* ---- 选择状态 (纯区间; 单日 = 同一天点两次 start===end) ---- */
const startSel = ref(null)
const endSel = ref(null)
const hover = ref(null)

/* ---- 当前展示的年/月 (0-indexed month) ---- */
const viewYear = ref(0)
const viewMonth = ref(0)

/* ---- 打开时初始化: 回填 custom modelValue, 否则空选 + 定位到 max 所在月 ---- */
function reset() {
  const parsed = parseCustomPeriod(props.modelValue)
  if (parsed) {
    startSel.value = parsed.start
    endSel.value = parsed.end
    const anchor = isoToDate(parsed.start)
    viewYear.value = anchor.getFullYear()
    viewMonth.value = anchor.getMonth()
  } else {
    startSel.value = null
    endSel.value = null
    const anchor = isoToDate(maxIso.value)
    viewYear.value = anchor.getFullYear()
    viewMonth.value = anchor.getMonth()
  }
  hover.value = null
}
watch(() => props.visible, (v) => { if (v) reset() })

/* ---- 月份导航 (限制在 [minIso, maxIso] 覆盖的月份内) ---- */
const canPrev = computed(() => `${viewYear.value}-${String(viewMonth.value + 1).padStart(2, '0')}` > minIso.value.slice(0, 7))
const canNext = computed(() => `${viewYear.value}-${String(viewMonth.value + 1).padStart(2, '0')}` < maxIso.value.slice(0, 7))
function shiftMonth(delta) {
  if (delta < 0 && !canPrev.value) return
  if (delta > 0 && !canNext.value) return
  const d = new Date(viewYear.value, viewMonth.value + delta, 1)
  viewYear.value = d.getFullYear()
  viewMonth.value = d.getMonth()
}

/* ---- 42 格网格 (周一起始, 越界 disabled) ---- */
const grid = computed(() => {
  const y = viewYear.value
  const m = viewMonth.value
  const first = new Date(y, m, 1)
  const offset = (first.getDay() + 6) % 7   /* 周一=0 */
  const today = localToday()
  const cells = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(y, m, 1 - offset + i)
    const iso = ymd(d)
    cells.push({
      iso,
      day: d.getDate(),
      inMonth: d.getMonth() === m,
      isToday: iso === today,
      disabled: iso < minIso.value || iso > maxIso.value,
    })
  }
  return cells
})

/* ---- 星期表头 / 月份标题 (Intl 本地化, 仅 visible 时客户端渲染, 无 SSR 顾虑) ---- */
const weekdayLabels = computed(() => {
  const fmt = new Intl.DateTimeFormat(locale.value, { weekday: 'short' })
  /* 2024-01-01 是周一, 顺序生成周一→周日的本地化短名 */
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2024, 0, 1 + i)))
})
const monthTitle = computed(() =>
  new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'long' })
    .format(new Date(viewYear.value, viewMonth.value, 1)),
)

/* ---- 点选: 两步法 (起→止, 越界重开). 单日 = 同一天点两次 (第二次 iso===start → end=start) ---- */
function pick(cell) {
  if (cell.disabled) return
  const iso = cell.iso
  /* 无起点 / 已选完整 → 重开; 有起点无终点 → 落终点 (早于起点则改起点) */
  if (!startSel.value || endSel.value) {
    startSel.value = iso
    endSel.value = null
  } else if (iso >= startSel.value) {
    endSel.value = iso
  } else {
    startSel.value = iso
  }
}

/* ---- 区间预览终点: 已选终点优先, 否则用 hover (有起点无终点时) ---- */
const previewEnd = computed(() => {
  if (endSel.value) return null
  if (!startSel.value || !hover.value) return null
  return hover.value >= startSel.value ? hover.value : null
})

function cellClass(cell) {
  const base = 'flex h-9 items-center justify-center rounded-md text-sm transition-colors'
  if (cell.disabled) return `${base} cursor-not-allowed text-gray-200`

  const isStart = cell.iso === startSel.value
  const isEnd = cell.iso === endSel.value
  const upper = endSel.value || previewEnd.value
  const inRange = startSel.value && upper && cell.iso > startSel.value && cell.iso < upper

  if (isStart || isEnd) return `${base} bg-primary font-medium text-primary-text`
  if (inRange) return `${base} bg-primary/10 text-primary`
  const tone = cell.inMonth ? 'text-gray-700' : 'text-gray-400'
  const todayRing = cell.isToday ? ' ring-1 ring-inset ring-primary/40' : ''
  return `${base} ${tone} hover:bg-gray-100${todayRing}`
}

/* ---- 应用条件 + 摘要 (起止都选定才可应用; 单日即 start===end) ---- */
const canApply = computed(() => !!(startSel.value && endSel.value))

function fmtDay(iso) {
  if (!iso) return ''
  return new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'short', day: 'numeric' })
    .format(isoToDate(iso))
}
const summaryText = computed(() => {
  if (!startSel.value) return ''
  if (!endSel.value || startSel.value === endSel.value) return fmtDay(startSel.value)
  return `${fmtDay(startSel.value)} – ${fmtDay(endSel.value)}`
})

function onApply() {
  if (!canApply.value) return
  emit('apply', { start: startSel.value, end: endSel.value })
  emit('close')
}
function onClose() {
  emit('close')
}
</script>
