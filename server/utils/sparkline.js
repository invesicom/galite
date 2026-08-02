/* ===================================================================
 * Sparkline 时间轴聚合
 *
 * 上游报表会省略无数据日期，因此数组下标不是时间身份。这里始终先按
 * dimension key 聚合，再在共享时间轴上补 0、分桶，保证总览第 N 个点
 * 恒等于同一时间桶内各项目第 N 个点之和。
 * =================================================================== */

export function addTimelinePoint(timeline, key, values) {
  const label = String(key || '').trim()
  if (!label) return timeline

  const point = timeline.get(label) || {}
  for (const [field, value] of Object.entries(values || {})) {
    point[field] = (Number(point[field]) || 0) + (Number(value) || 0)
  }
  timeline.set(label, point)
  return timeline
}

export function mergeTimeline(target, source) {
  if (!(source instanceof Map)) return target
  for (const [key, values] of source) addTimelinePoint(target, key, values)
  return target
}

export function collectTimelineLabels(timelines) {
  const labels = new Set()
  for (const timeline of timelines || []) {
    if (!(timeline instanceof Map)) continue
    for (const key of timeline.keys()) labels.add(key)
  }
  return Array.from(labels).sort()
}

export function timelineValues(timeline, labels, field, bucketSize = 0) {
  const points = (labels || []).map((label) => Number(timeline?.get(label)?.[field]) || 0)
  const size = Math.max(1, Math.trunc(Number(bucketSize) || 1))
  if (size === 1) return points

  const buckets = []
  for (let i = 0; i < points.length; i += size) {
    let total = 0
    for (let j = i; j < Math.min(i + size, points.length); j++) total += points[j]
    buckets.push(total)
  }
  return buckets
}
