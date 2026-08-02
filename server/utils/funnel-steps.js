/* ===================================================================
 * 漏斗步骤定义 - 校验 / 归一化 / 反序列化
 *
 * steps_config DB 中是 longtext, 形态:
 *   [{ name?, kind:'page'|'event',
 *      match:'exact'|'contains'|'starts_with'|'ends_with',
 *      value }]
 *
 * 设计:
 *   - 单步归一化集中处理 trim / 截长 / 小写化 / event 强制 exact
 *   - 数组级别只做 size 校验 + 单步归一化结果聚合
 *   - 错误信息用业务化的 i18n key 形态字符串, 前端能直接 t() 映射
 * =================================================================== */

export const FUNNEL_STEP_KINDS    = ['page', 'event']
export const FUNNEL_MATCH_MODES   = ['exact', 'contains', 'starts_with', 'ends_with']
export const FUNNEL_MIN_STEPS     = 2
export const FUNNEL_MAX_STEPS     = 5
export const FUNNEL_NAME_MAX      = 80
export const FUNNEL_VALUE_MAX     = 500
export const FUNNELS_PER_PROJECT_MAX = 20

/* ---- 单步归一化: 容错 + 安全截长 + event 强制 exact ---- */
function normalizeStep(raw) {
  const kind = String(raw?.kind || '').trim().toLowerCase()
  if (!FUNNEL_STEP_KINDS.includes(kind)) return { error: 'invalid_step_kind' }

  const value = String(raw?.value || '').trim()
  if (!value) return { error: 'step_value_required' }

  /* event 步骤 GA4 funnelEventFilter 仅支持精确匹配, 强制 override */
  let match = String(raw?.match || 'exact').trim().toLowerCase()
  if (kind === 'event') match = 'exact'
  if (!FUNNEL_MATCH_MODES.includes(match)) return { error: 'invalid_match_mode' }

  const name = String(raw?.name || '').trim().slice(0, FUNNEL_NAME_MAX)
  return {
    step: {
      kind,
      match,
      value: value.slice(0, FUNNEL_VALUE_MAX),
      name,
    },
  }
}

/* ---- 数组归一化: 全部步合法才返成功 ---- */
export function normalizeSteps(rawList) {
  if (!Array.isArray(rawList)) return { error: 'steps_required' }
  if (rawList.length < FUNNEL_MIN_STEPS) return { error: 'min_2_steps' }
  if (rawList.length > FUNNEL_MAX_STEPS) return { error: `max_${FUNNEL_MAX_STEPS}_steps` }

  const out = []
  for (const raw of rawList) {
    const r = normalizeStep(raw)
    if (r.error) return { error: r.error }
    out.push(r.step)
  }
  return { steps: out }
}

/* ---- 反序列化 (DB longtext -> array, 容错) ---- */
export function parseSteps(raw) {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

/* ---- 出参形态归一: 始终返合法 step (前端不用判 undefined) ---- */
export function shapeStep(s) {
  return {
    name:  String(s?.name || ''),
    kind:  FUNNEL_STEP_KINDS.includes(s?.kind) ? s.kind : 'page',
    match: FUNNEL_MATCH_MODES.includes(s?.match) ? s.match : 'exact',
    value: String(s?.value || ''),
  }
}
