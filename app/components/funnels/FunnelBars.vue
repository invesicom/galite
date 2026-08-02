<template>
  <!-- ============================================================
       FunnelBars - 漏斗柱状图 (Plausible 风, 纯 div)
       --
       算法:
         每根 bar 的 "可见区域上限" = 上一步的累计转化率 (cum[i-1])
         浅色填充: 从 (1 - cum[i-1]) 到 (1 - cum[i]) — 即"本步流失"区域
         深色填充: 从 (1 - cum[i]) 到底 — 即"本步实际命中"
         第一步 cum[i-1] 默认 1, 浅色高度 = 0, 深色满高
       --
       这样视觉上每根 bar 嵌套在上一步剩余空间内, 自然呈现"漏斗递减":
         深色顶 = step.cumulative_conversion
         浅色顶 = prevStep.cumulative_conversion
         浅色 = prev_cum - cum = drop / firstUsers
       --
       props:
         data:          { steps[] } GA4 结果
         loading:       骨架开关
         expectedSteps: 漏斗配置, loading 时用它撑结构
       --
       UX:
         bar 顶部常显 cumulative_conversion 百分比
         hover bar → 结构化 tooltip (title + visitors row + dropoff row)
         最大流失步: 编号圆 + label 文字 amber
       ============================================================ -->
  <div>
    <!-- ===== Bars 区 ===== -->
    <div v-if="!renderSteps.length || (firstUsers === 0 && !loading)"
         class="flex h-44 items-center justify-center text-sm text-gray-400">
      {{ t('metrics.no_data') }}
    </div>
    <div v-else class="flex h-44 items-end justify-center gap-4 pt-9">
      <div
        v-for="(step, i) in renderSteps"
        :key="i"
        v-tooltip.cursor="loading ? undefined : barTooltip(step, i)"
        class="group/bar relative flex h-full w-full max-w-[4.5rem] cursor-help flex-col justify-end"
      >
        <!-- bar 顶部数字 (常显, 跟随深色顶部位置)
             两行: 主行 cumulative_conversion % (相对第一步) + 副行 users 数
             这里始终是"相对起点"视角, 跟 hover tooltip 的"相对前一步"区分
             z-10: 浮在浅色/深色填充之上, 避免 bar 中部位置数字被浅色覆盖 -->
        <div
          v-if="!loading"
          class="pointer-events-none absolute inset-x-0 z-10 -translate-y-full pb-1 text-center transition-all"
          :style="{ top: pctOfDarkTop(step) + '%' }"
        >
          <div class="text-xs font-semibold tabular-nums leading-tight text-gray-700">
            {{ formatPct(step.cumulative_conversion) }}
          </div>
          <div class="text-[11px] tabular-nums leading-tight text-gray-400">
            {{ formatInt(step.users) }}
          </div>
        </div>

        <!-- 浅色填充 (本步流失区域: (1-prev_cum) 到 (1-cum)) -->
        <div
          v-if="!loading"
          class="absolute inset-x-0 rounded-md bg-blue-50 transition-all"
          :style="lightStyle(step, i)"
        />
        <!-- 深色填充 (本步实际命中: (1-cum) 到底) -->
        <div
          v-if="loading"
          class="relative animate-pulse rounded-md bg-gray-200"
          :style="{ height: skeletonHeight(i) + '%' }"
        />
        <div
          v-else
          class="absolute inset-x-0 bottom-0 rounded-md bg-primary transition-all group-hover/bar:bg-primary/90"
          :style="{ top: pctOfDarkTop(step) + '%' }"
        />
      </div>
    </div>

    <!-- ===== Step labels (bar 下方, 跟 bar 同 max-width 对齐) =====
         编号已由位置感传达 (最左 step 1, 最右 step N), 去掉编号圆
         最大流失步用 label 文字 amber + 加粗即可
         leading-4 锁定行高 16px, 骨架 h-4 严格对齐 (避免亚像素抖动) -->
    <div v-if="renderSteps.length" class="mt-2 flex h-4 justify-center gap-4">
      <div
        v-for="(step, i) in renderSteps"
        :key="i"
        class="flex min-w-0 w-full max-w-[4.5rem] justify-center text-center"
      >
        <span v-if="loading" class="inline-block h-4 w-12 animate-pulse rounded bg-gray-100" />
        <span
          v-else
          :class="[
            'truncate text-xs leading-4',
            isBiggestDrop(i) ? 'font-semibold text-amber-600' : 'text-gray-500',
          ]"
        >
          {{ step.name || step.value || '—' }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
/* ============================================================
   FunnelBars - 纯展示, 不发请求
   --
   核心算法 (Plausible 风格):
     prev_cum = i === 0 ? 1 : steps[i-1].cumulative_conversion
     cur_cum  = step.cumulative_conversion
     浅色 (top, bottom 都用 %, height 由 CSS 自动算):
       top    = (1 - prev_cum) * 100
       bottom = cur_cum * 100
       → 高度 = 100 - top - bottom = prev_cum - cur_cum (= drop_rate × first占比)
     深色:
       top    = (1 - cur_cum) * 100
       bottom = 0
       → 高度 = cur_cum × 100
   --
   tooltip 信息分层 (v-tooltip 升级版接 object):
     title: prev_label → cur_label  (第一步: 只显示 cur_label)
     rows[0]: ● Visitors  N (cumulative_pct)
     rows[1] (仅 i>0): ● Dropoff   N (drop_rate_pct)
   ============================================================ */

import { computed } from 'vue'

const { t } = useI18n()

const props = defineProps({
  data:          { type: Object,  default: null },
  loading:       { type: Boolean, default: false },
  expectedSteps: { type: Array,   default: () => [] },
})

/* ---- 渲染源 ---- */
const renderSteps = computed(() => {
  if (props.loading) {
    if (props.expectedSteps?.length) return props.expectedSteps
    if (Array.isArray(props.data?.steps) && props.data.steps.length) return props.data.steps
    return [
      { kind: 'page', match: 'exact', value: '' },
      { kind: 'page', match: 'exact', value: '' },
      { kind: 'page', match: 'exact', value: '' },
    ]
  }
  return Array.isArray(props.data?.steps) ? props.data.steps : []
})

const firstUsers = computed(() => renderSteps.value[0]?.users || 0)

/* ---- 上一步累计转化率 (默认 1, 对应 i=0 时浅色高度为 0) ---- */
function prevCumulative(i) {
  if (i === 0) return 1
  return Number(renderSteps.value[i - 1]?.cumulative_conversion || 0)
}

/* ---- 深色顶部 (% from container top): bar 实际填充顶 ---- */
function pctOfDarkTop(step) {
  const cum = Number(step?.cumulative_conversion || 0)
  return Math.max(0, Math.min(100, (1 - cum) * 100))
}

/* ---- 浅色填充 style (top/bottom 双锚, 高度由 CSS 自动) ---- */
function lightStyle(step, i) {
  const prev = prevCumulative(i)
  const cur = Number(step?.cumulative_conversion || 0)
  /* 浅色顶: (1 - prev) * 100% (i=0 时 = 0%), 浅色底: cur * 100% */
  return {
    top: ((1 - prev) * 100) + '%',
    bottom: (cur * 100) + '%',
  }
}

/* ---- 骨架高度: 漏斗递减模拟 (90%/72%/54%/36%/18%) ---- */
function skeletonHeight(i) {
  const n = renderSteps.value.length || 1
  if (n === 1) return 70
  return Math.round(90 - (60 * i) / (n - 1))
}

/* ---- 最大流失步 (drop_rate 最大) ---- */
const biggestDropIndex = computed(() => {
  if (props.loading) return -1
  let bestIdx = -1
  let bestRate = 0
  for (let i = 1; i < renderSteps.value.length; i++) {
    const r = Number(renderSteps.value[i]?.drop_rate || 0)
    if (r > bestRate) { bestRate = r; bestIdx = i }
  }
  return bestRate > 0 ? bestIdx : -1
})
function isBiggestDrop(idx) {
  return biggestDropIndex.value > 0 && idx === biggestDropIndex.value
}

/* ---- step label: name (有则用) / value (无 name 时用) / 兜底 ---- */
function stepLabel(step) {
  return step?.name || step?.value || '—'
}

/* ---- 结构化 tooltip (传 object 给 v-tooltip 升级版) ----
   视角差异 (与 bar 顶部数字区分):
     bar 顶部:  cumulative_conversion (相对起点, 整体进度)
     tooltip:  step-to-step rate (相对前一步, 局部转化)
   --
   step-to-step rate = step.users / prev.users
     = 1 - drop_rate  (与后端 drop_rate 互补)
   第一步无 prev, rate=1 (100%); prev.users=0 时除零回退 0
   --
   第一步: 只显示 Visitors 一行 (无 Dropoff 概念)
   后续步: Visitors + Dropoff 两行, 标题 "prev → cur" */
function barTooltip(step, i) {
  const prev = i === 0 ? null : renderSteps.value[i - 1]
  const stepToStepRate = prev
    ? (Number(prev.users) > 0 ? step.users / prev.users : 0)
    : 1
  const visitorsRow = {
    color: 'primary',
    label: t('funnels.visitors'),
    value: formatInt(step.users),
    pct: formatPct(stepToStepRate),
  }
  if (i === 0) {
    return {
      title: stepLabel(step),
      rows: [visitorsRow],
    }
  }
  return {
    title: `${stepLabel(prev)} → ${stepLabel(step)}`,
    rows: [
      visitorsRow,
      {
        color: 'muted',
        label: t('funnels.dropoff'),
        value: formatInt(step.drop_users),
        pct: formatPct(step.drop_rate),
      },
    ],
  }
}

function formatInt(v) {
  const n = Number(v) || 0
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + 'B'
  if (n >= 1_000_000)     return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 10_000)        return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
  return n.toLocaleString()
}
function formatPct(v) {
  const n = Number(v) || 0
  const abs = Math.abs(n)
  const fixed = abs >= 0.1 ? 1 : 2
  return `${(abs * 100).toFixed(fixed)}%`
}
</script>
