/* ===========================================================
   维度固定值的多语言映射
   --
   GA4 维度返回的某些固定字符串 (如 "(direct)" / "desktop") 是
   技术术语, 运营 / 终端用户不易理解. 这里提供 dim + value → i18n key
   的查表, 让 BarList / DimensionDetailModal 显示本地化文本.
   --
   仅枚举型固定值 (来源 / 设备) 走翻译, 像 URL path / browser name /
   country code 这类无穷集或专有名词保留原文.
   --
   实现策略: 双查表 (dim → value-i18n_key), localize() 内 t() 调用
   未命中时返原值 (兜底 GA4 未来新增枚举).
   =========================================================== */

/* ---- 通用占位值 (GA4 任意维度都可能返, 不属于某个特定 dimension) ----
   (not set):  GA4 采集不到该字段时的兜底值, 流量来源 / 国家 / 浏览器 / ... 都可能出现
   (other):    GA4 维度基数过大时聚合的"其他" bucket
   这层放最外, 所有维度共享 — 不要在每个 DIM_VALUE_I18N 里重复登记 */
const COMMON_VALUE_I18N = {
  '(not set)': 'dimensions.common.not_set',
  '(other)':   'dimensions.common.other',
}

/* ---- 维度专属枚举 (仅特定 dim 才出现的固定值) ---- */
const DIM_VALUE_I18N = {
  /* 流量来源: (direct) 是 GA4 固定特殊值, 表示直接访问 */
  sessionSource: {
    '(direct)': 'dimensions.source.direct',
  },
  /* 设备类型: GA4 固定枚举 (小写) */
  deviceCategory: {
    desktop:    'dimensions.device.desktop',
    mobile:     'dimensions.device.mobile',
    tablet:     'dimensions.device.tablet',
    'smart tv': 'dimensions.device.smart_tv',
  },
}

/* ---- 维度值本地化 ----
   双层查表 (优先维度专属, 兜底通用占位):
     1) DIM_VALUE_I18N[dimKey] — 该维度独有的枚举 (sessionSource.(direct) 等)
     2) COMMON_VALUE_I18N      — 跨维度通用占位 ((not set) / (other))
   两层都未命中或 i18n 未命中 → 返原值 */
export function localizeDimensionValue(dimKey, rawValue, t) {
  /* 1) 维度专属枚举 */
  const map = DIM_VALUE_I18N[dimKey]
  if (map) {
    const key = map[rawValue] || map[String(rawValue).toLowerCase().trim()]
    if (key) {
      const localized = t(key)
      if (localized !== key) return localized
    }
  }
  /* 2) 通用占位 (任意维度共享) */
  const commonKey = COMMON_VALUE_I18N[rawValue]
  if (commonKey) {
    const localized = t(commonKey)
    if (localized !== commonKey) return localized
  }
  return rawValue
}
