/* ===========================================================
   Config Store - 站点配置状态
   职责: 管理 unchanged + translated 双层配置结构
   核心: getTranslated 将翻译覆盖层合并到不变基底
   =========================================================== */

import { defineStore } from 'pinia'

export const useConfigStore = defineStore('config', () => {

  const siteId = ref('')
  const siteName = ref('')
  const unchanged = ref({})
  const translated = ref({})
  const loaded = ref(false)

  function getTranslated(locale) {
    const base = unchanged.value
    const layer = translated.value[locale]
    if (!layer) return { ...base }
    return mergeDeep(base, layer)
  }

  function setConfig(config) {
    siteId.value = config?.siteId || ''
    unchanged.value = config?.unchanged || {}
    translated.value = config?.translated || {}
    siteName.value = config?.siteName || unchanged.value.site_name || 'GA Lite'
    loaded.value = true
  }

  function clearConfig() {
    siteId.value = ''
    siteName.value = ''
    unchanged.value = {}
    translated.value = {}
    loaded.value = false
  }

  return {
    siteId, siteName, unchanged, translated, loaded,
    getTranslated, setConfig, clearConfig,
  }
})

function mergeDeep(target, source) {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    const srcVal = source[key]
    const tgtVal = result[key]
    if (isPlainObject(srcVal) && isPlainObject(tgtVal)) {
      result[key] = mergeDeep(tgtVal, srcVal)
    } else if (Array.isArray(srcVal) && Array.isArray(tgtVal)) {
      result[key] = mergeArrays(tgtVal, srcVal)
    } else {
      result[key] = srcVal
    }
  }
  return result
}

function mergeArrays(target, source) {
  const len = Math.max(target.length, source.length)
  const result = []
  for (let i = 0; i < len; i++) {
    const s = i < source.length ? source[i] : undefined
    const t = i < target.length ? target[i] : undefined
    if (s !== undefined && t !== undefined && isPlainObject(s) && isPlainObject(t)) {
      result.push(mergeDeep(t, s))
    } else {
      result.push(s !== undefined ? s : t)
    }
  }
  return result
}

function isPlainObject(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val)
}
