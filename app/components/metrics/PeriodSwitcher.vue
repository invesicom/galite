<template>
  <!-- ============================================================
       PeriodSwitcher - 时段切换
       --
       options 由调用方传入: [{ value, label }]
         - 历史指标:  today/yesterday/7days/28days/90days (默认)
         - 实时窗口:  30min/5min/1min (实时页传)
         - 详情扩展:  默认 5 个 + 6months/1year (详情页传 7 个)
       v-model 双向绑定 period 字符串
       --
       两形态共存, 由 responsive prop 决定:
         responsive=false (默认): 始终 dropdown — 详情页 toolbar 紧凑, 横向像素稀缺
         responsive=true:         PC segmented + mobile dropdown
                                  — 列表 / 实时页横向空间充足, segmented 一眼看完全部周期
       --
       Tailwind hidden md:inline-flex / md:hidden 纯 CSS 切换两块 DOM,
       不依赖 JS 检测 viewport, 无 SSR / hydration 闪烁.
       ============================================================ -->
  <div>
    <!-- ============ 桌面 segmented control (仅 responsive=true 时显示) ============ -->
    <div
      v-if="responsive"
      class="hidden rounded-md border border-gray-200 bg-white p-1 text-sm md:inline-flex"
    >
      <button
        v-for="opt in resolvedOptions"
        :key="opt.value"
        type="button"
        :class="[
          'whitespace-nowrap rounded px-3.5 py-1.5 font-medium transition-colors',
          modelValue === opt.value
            ? 'bg-primary text-primary-text'
            : 'text-gray-600 hover:text-gray-900',
        ]"
        @click="emit('update:modelValue', opt.value)"
      >
        {{ opt.label }}
      </button>
      <!-- 自定义日期入口 (segmented 形态) -->
      <button
        v-if="allowCustom"
        type="button"
        :class="[
          'inline-flex items-center gap-1 whitespace-nowrap rounded px-3.5 py-1.5 font-medium transition-colors',
          isCustomActive
            ? 'bg-primary text-primary-text'
            : 'text-gray-600 hover:text-gray-900',
        ]"
        @click="emit('request-custom')"
      >
        <NuxtIcon name="ri:calendar-event-line" class="size-3.5 shrink-0" />
        <span>{{ isCustomActive ? currentLabel : $t('metrics.period.custom') }}</span>
      </button>
    </div>

    <!-- ============ Dropdown 形态
         responsive=false: 始终显示
         responsive=true:  仅 mobile 显示 (md:hidden) — segmented 在 PC 处理 ============ -->
    <div
      ref="dropdownRef"
      :class="['relative', responsive ? 'md:hidden' : '']"
    >
      <button
        type="button"
        :class="[
          'inline-flex h-9 items-center gap-1.5 rounded-md border bg-white px-2.5 text-sm transition-colors md:h-10 md:px-3',
          open
            ? 'border-primary/40 text-primary'
            : 'border-gray-200 text-gray-700 hover:bg-gray-50',
        ]"
        @click="open = !open"
      >
        <NuxtIcon
          name="ri:calendar-2-line"
          :class="['size-4 shrink-0', open ? 'text-primary' : 'text-gray-400']"
        />
        <span class="font-medium">{{ currentLabel }}</span>
        <NuxtIcon
          name="ri:arrow-down-s-line"
          :class="[
            'hidden size-3.5 shrink-0 text-gray-400 transition-transform md:inline',
            open ? 'rotate-180' : '',
          ]"
        />
      </button>
      <Transition name="modal-fade">
        <div
          v-if="open"
          class="absolute left-1/2 top-full z-20 mt-1 w-32 -translate-x-1/2 overflow-hidden rounded-md border border-gray-200 bg-white py-1 shadow-lg"
        >
          <button
            v-for="opt in resolvedOptions"
            :key="opt.value"
            type="button"
            :class="[
              'block w-full px-3 py-1.5 text-left text-sm transition-colors',
              modelValue === opt.value
                ? 'bg-primary/10 font-medium text-primary'
                : 'text-gray-700 hover:bg-gray-50',
            ]"
            @click="onPick(opt.value)"
          >
            {{ opt.label }}
          </button>
          <!-- 自定义日期入口: 分隔线 + 触发项 (custom 激活时高亮) -->
          <template v-if="allowCustom">
            <div class="my-1 border-t border-gray-100" />
            <button
              type="button"
              :class="[
                'flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-sm transition-colors',
                isCustomActive
                  ? 'bg-primary/10 font-medium text-primary'
                  : 'text-gray-700 hover:bg-gray-50',
              ]"
              @click="onCustom"
            >
              <NuxtIcon name="ri:calendar-event-line" class="size-3.5 shrink-0" />
              {{ $t('metrics.period.custom') }}
            </button>
          </template>
        </div>
      </Transition>
    </div>
  </div>
</template>

<script setup>
/* ============================================================
   PeriodSwitcher - 时段切换 (通用)
   props:
     modelValue (string): 当前选中值
     options    (array):  可选, 不传走默认历史周期 (5 个)
     responsive (bool):   true → PC segmented + mobile dropdown; false → 始终 dropdown
   emits: update:modelValue
   --
   dropdown 行为: open + click-outside 闭合, 选项点击后自动关闭
   ============================================================ */

import { computed, onMounted, onUnmounted, ref } from 'vue'
import { isCustomPeriod, parseCustomPeriod } from '~/utils/period'

const props = defineProps({
  modelValue: { type: String,  default: '7days' },
  options:    { type: Array,   default: null },
  responsive: { type: Boolean, default: false },
  /* allowCustom: 末尾追加"自定义"入口, 点击 emit request-custom 让父级弹日期选择器 */
  allowCustom: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue', 'request-custom'])

const { t, locale } = useI18n()

/* ---- 默认: 历史周期 5 个 (与 server/utils/constants.js::MetricsPeriod 对齐)
       详情页要 7 个 (含 6months / 1year), 在调用处显式传 options 覆盖 ---- */
const DEFAULT_OPTIONS = computed(() => [
  { value: 'today',     label: t('metrics.period.today') },
  { value: 'yesterday', label: t('metrics.period.yesterday') },
  { value: '7days',     label: t('metrics.period.7days') },
  { value: '28days',    label: t('metrics.period.28days') },
  { value: '90days',    label: t('metrics.period.90days') },
])

const resolvedOptions = computed(() => props.options || DEFAULT_OPTIONS.value)

/* ---- dropdown 状态 ---- */
const open = ref(false)
const dropdownRef = ref(null)

/* custom 值在按钮上显示成紧凑日期 (区间用 – 连接, 单日只显一个) */
function fmtShort(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Intl.DateTimeFormat(locale.value, { month: 'short', day: 'numeric' }).format(new Date(y, m - 1, d))
}

const isCustomActive = computed(() => isCustomPeriod(props.modelValue))

/* 当前 modelValue 对应的 label: custom 走日期格式化, 否则查 options */
const currentLabel = computed(() => {
  const custom = parseCustomPeriod(props.modelValue)
  if (custom) {
    return custom.start === custom.end
      ? fmtShort(custom.start)
      : `${fmtShort(custom.start)} – ${fmtShort(custom.end)}`
  }
  return resolvedOptions.value.find(o => o.value === props.modelValue)?.label || ''
})

function onPick(v) {
  open.value = false
  emit('update:modelValue', v)
}

/* "自定义"入口: 关闭 dropdown 并通知父级弹出日期选择器 */
function onCustom() {
  open.value = false
  emit('request-custom')
}

function onClickOutside(e) {
  if (!open.value) return
  if (dropdownRef.value && !dropdownRef.value.contains(e.target)) open.value = false
}
onMounted(()   => { if (import.meta.client) document.addEventListener('pointerdown', onClickOutside) })
onUnmounted(() => { if (import.meta.client) document.removeEventListener('pointerdown', onClickOutside) })
</script>
