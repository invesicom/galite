<template>
  <!-- ============================================================
       FilterChip - 单条筛选条件视觉显示
       --
       形态: "{维度} {操作符} {值} ✕"  (点击 chip 主体 = 编辑, 点 ✕ = 删除)
         如: "国家 is 德国 ✕" / "页面 包含 /blog ✕"
       --
       value 显示走 dim-i18n 翻译: filter.value 是 GA4 原值 (如 "(direct)"),
       UI 显示翻译后的"直接访问" — 数据层和展示层分离
       --
       可达性: 整个 chip 作为 button (role=button + tabindex + 键盘绑定)
              而非 <button> 元素, 因为 HTML 不允许 button 内嵌 button (✕)
       ============================================================ -->
  <span
    role="button"
    tabindex="0"
    class="group inline-flex h-10 max-w-full cursor-pointer items-center gap-1.5 rounded-full border border-dashed border-gray-300 bg-white px-3 text-sm text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50"
    @click="emit('edit')"
    @keydown.enter="emit('edit')"
    @keydown.space.prevent="emit('edit')"
  >
    <span class="truncate">
      <span class="text-gray-500">{{ $t(dimTitleKey(filter.dim)) }}</span>
      <!-- i18n-t 把 {value} 占位符替换为带样式的 slot, 让 op 模板按语言自然排序:
           中文 "以 /model 开头", 英文 "starts with /model" — value 嵌入位置随语言变 -->
      <i18n-t :keypath="matchOpTplKey(filter.match)" tag="span" class="mx-1 text-gray-700" scope="global">
        <template #value>
          <img
            v-if="isSearchProviderFilter && providerIcon"
            :src="providerIcon"
            :alt="displayValue"
            :title="displayValue"
            class="inline-block size-4 align-[-2px]"
          >
          <span v-else class="font-medium text-gray-900">{{ displayValue }}</span>
        </template>
      </i18n-t>
    </span>
    <!-- ✕ 删除按钮: stop 防止冒泡触发编辑 -->
    <button
      type="button"
      class="flex size-5 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-red-50 hover:text-red-500"
      @click.stop="emit('remove')"
    >
      <NuxtIcon name="ri:close-line" class="size-3.5" />
    </button>
  </span>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { dimTitleKey, matchOpTplKey } from '~/utils/filters'
import { localizeDimensionValue } from '~/utils/dimension-i18n'

const props = defineProps({
  filter: { type: Object, required: true },
})

const emit = defineEmits(['remove', 'edit'])

const { t } = useI18n()
const countryNames = useCountryNames()
onMounted(() => countryNames.ensureLoaded())

const PROVIDER_ICON = {
  gsc: '/images/icon/google-search-console.svg',
  bing: '/images/icon/bing-webmaster.svg',
}

const isSearchProviderFilter = computed(() => props.filter.dim === 'searchProvider')
const providerIcon = computed(() => PROVIDER_ICON[props.filter.value] || '')

/* 把 filter.value (原值) 翻译为本地化字符串显示
   country 维度优先走 countryNames (US -> 美国), 其他维度走通用 dim-i18n */
const displayValue = computed(() => {
  const v = props.filter.value
  if (props.filter.dim === 'searchProvider') {
    const key = `integrations.provider.${v}`
    const label = t(key)
    return label === key ? v : label
  }
  if (props.filter.dim === 'country') {
    return countryNames.nameOf(v) || localizeDimensionValue('country', v, t) || v
  }
  return localizeDimensionValue(props.filter.dim, v, t)
})
</script>
