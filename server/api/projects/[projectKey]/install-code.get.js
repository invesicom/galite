/* ===================================================================
 *  GET /api/projects/[projectKey]/install-code
 *
 *  返回项目首个 GA4 mount 的 measurement_id (gtag 安装代码用)
 *
 *  Lazy backfill:
 *    早期版本 listProperties 拉 dataStreams 时只取了 defaultUri, 丢了
 *    measurementId — 通过 "挂载已有 property" 路径接入的 GA4, 其
 *    resource_meta 缺 measurement_id 字段. 这里检测到缺失时, 现场拉一次
 *    dataStreams 并回写 resource_meta, 修复历史数据.
 *
 *  返回:
 *    { measurement_id: 'G-XXXXXXXX' }    // 成功或 lazy 补回成功
 *    { measurement_id: '' }              // 项目无 GA4 mount, 或 token 失效
 *
 *  设计意图:
 *    - 单一职责: 仅服务"安装代码"场景, 不走 fetchDetail (避免详情页慢)
 *    - 失败静默: 拉不到也返回空字符串, 让前端展示 no_id 引导
 * =================================================================== */

import { and, eq } from 'drizzle-orm'
import { project_data_source } from '../../../database/schema'
import { loadProjectAndSources } from '../../../utils/metrics-helpers'
import { providerOf } from '../../../utils/providers'
import { getAccessToken } from '../../../utils/data-source-token'
import { RecordStatus } from '../../../utils/constants'

/* ---- 安全解析 JSON, 异常返回空对象 ---- */
function parseMeta(raw) {
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

export default defineEventHandler(async (event) => {
  const projectKey = getRouterParam(event, 'projectKey')
  const db = await useDb(event)

  /* ---- 鉴权 + 项目归属 + 拉 GA4 sources (含 auth row) ---- */
  const { sources, jwtSecret, siteConfig } = await loadProjectAndSources(event, db, projectKey)

  /* ---- 没有 GA4 mount: 直接返回空字符串 (前端展示 no_id 引导) ---- */
  if (!sources.length) return reqSuccess({ measurement_id: '' })

  /* ---- 优先选 status=1 的 mount; 兜底取第一个 ---- */
  const picked = sources.find((s) => s.auth?.status === RecordStatus.ACTIVE) || sources[0]
  const meta = parseMeta(picked.ds.resource_meta)

  /* ---- 命中缓存: resource_meta 已有 measurement_id ---- */
  if (meta.measurement_id) {
    return reqSuccess({ measurement_id: meta.measurement_id })
  }

  /* ---- Lazy backfill: 拉 dataStreams 取 measurementId ---- */
  if (picked.auth?.status !== RecordStatus.ACTIVE) {
    return reqSuccess({ measurement_id: '' })
  }
  let measurementId = ''
  try {
    const accessToken = await getAccessToken(db, picked.auth, jwtSecret, siteConfig)
    const provider = providerOf('ga4')
    const stream = await provider.fetchWebStreamInfo(accessToken, picked.ds.resource_id)
    measurementId = stream?.measurementId || ''
  } catch (err) {
    console.warn('[install-code] backfill failed:', err?.message || err)
    return reqSuccess({ measurement_id: '' })
  }

  if (!measurementId) return reqSuccess({ measurement_id: '' })

  /* ---- 回写 resource_meta (含原有字段, 不破坏 website_uri / timezone 等) ---- */
  const nextMeta = { ...meta, measurement_id: measurementId }
  try {
    await db.update(project_data_source)
      .set({
        resource_meta: JSON.stringify(nextMeta),
        updated_at: Math.floor(Date.now() / 1000),
      })
      .where(and(
        eq(project_data_source.id, picked.ds.id),
        eq(project_data_source.status, RecordStatus.ACTIVE),
      ))
  } catch (err) {
    /* 回写失败不影响本次返回, 下次请求会再尝试 lazy backfill */
    console.warn('[install-code] resource_meta write-back failed:', err?.message || err)
  }

  return reqSuccess({ measurement_id: measurementId })
})
