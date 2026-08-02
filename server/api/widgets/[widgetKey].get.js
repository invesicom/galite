/* ===================================================================
 * GET /api/widgets/{widgetKey}
 *
 * 免登录 iframe 数据出口. 不读取 password unlock cookie.
 * =================================================================== */

import { and, eq } from 'drizzle-orm'
import {
  project_list,
  public_profile,
  public_project_setting,
  public_widget,
} from '../../database/schema'
import { RecordStatus } from '../../utils/constants'
import { getFirst } from '../../utils/db'
import {
  PublicProjectMode,
  listProfilePublicProjects,
  publicProfileColumns,
  resolvePublicMode,
  withPublicProfileBranding,
} from '../../utils/public/public-access'
import { shapePublicProfile, shapePublicMetricsDto, shapePublicProjectIdentity } from '../../utils/public/public-dto'
import { loadPublicProfileMetrics, loadPublicProjectMetrics } from '../../utils/public/public-metrics'

function unavailable() {
  return reqSuccess({ status: 'widget_unavailable' })
}

function widgetMode(widget, profileMode, projectMode) {
  const resolved = resolvePublicMode(profileMode, projectMode || 'inherit', false)
  if (resolved === PublicProjectMode.HIDDEN || resolved === PublicProjectMode.PASSWORD) return resolved
  if (widget.visibility_mode === PublicProjectMode.SEMI_PUBLIC) return PublicProjectMode.SEMI_PUBLIC
  return resolved === PublicProjectMode.PUBLIC ? PublicProjectMode.PUBLIC : PublicProjectMode.SEMI_PUBLIC
}

export default defineEventHandler(async (event) => {
  const widgetKey = getRouterParam(event, 'widgetKey')
  const db = await useDb(event)
  const siteId = event.context.siteId || ''
  if (!siteId) return unavailable()

  const widget = await getFirst(
    db.select().from(public_widget)
      .where(and(
        eq(public_widget.project_id, siteId),
        eq(public_widget.widget_key, widgetKey),
        eq(public_widget.status, RecordStatus.ACTIVE),
      ))
      .limit(1),
  )
  if (!widget) return unavailable()

  const profile = await getFirst(
    db.select(publicProfileColumns).from(public_profile)
      .where(and(
        eq(public_profile.project_id, siteId),
        eq(public_profile.union_id, widget.union_id),
      ))
      .limit(1),
  )
  if (!profile) return unavailable()
  const publicProfile = await withPublicProfileBranding(db, profile)

  const widgetMeta = {
    widget_key: widget.widget_key,
    scope: widget.scope,
    widget_type: widget.widget_type,
    title: widget.title || '',
    theme: widget.theme || 'light',
    accent_color: widget.accent_color || '',
    period: widget.period,
    metric: widget.metric,
    visibility_mode: widget.visibility_mode,
  }

  if (widget.scope === 'profile') {
    const rows = await listProfilePublicProjects(db, publicProfile)
    const visible = rows
      .filter((row) => row.setting?.public_project_key)
      .map((row) => ({
        ...row,
        mode: resolvePublicMode(publicProfile.visibility_mode, row.setting.visibility_mode, false),
      }))
    const data = await loadPublicProfileMetrics(event, db, publicProfile, visible, widget.period)
    return reqSuccess({
      status: 'ok',
      widget: widgetMeta,
      profile: shapePublicProfile(publicProfile, null),
      data,
    })
  }

  const project = await getFirst(
    db.select().from(project_list)
      .where(and(
        eq(project_list.project_id, siteId),
        eq(project_list.union_id, widget.union_id),
        eq(project_list.project_key, widget.project_key || ''),
        eq(project_list.status, RecordStatus.ACTIVE),
      ))
      .limit(1),
  )
  if (!project) return unavailable()

  const setting = await getFirst(
    db.select().from(public_project_setting)
      .where(and(
        eq(public_project_setting.project_id, siteId),
        eq(public_project_setting.union_id, widget.union_id),
        eq(public_project_setting.project_key, project.project_key),
      ))
      .limit(1),
  )
  const mode = widgetMode(widget, publicProfile.visibility_mode, setting?.visibility_mode || 'inherit')
  if (mode === PublicProjectMode.HIDDEN || mode === PublicProjectMode.PASSWORD) return unavailable()

  const metricSetting = {
    ...(setting || {}),
    public_project_key: setting?.public_project_key || widget.widget_key,
  }
  const metrics = await loadPublicProjectMetrics(event, db, {
    project,
    setting: metricSetting,
    mode,
    period: widget.period,
    includeDimensions: false,
  })

  return reqSuccess({
    status: 'ok',
    widget: widgetMeta,
    data: shapePublicMetricsDto({
      mode,
      project: shapePublicProjectIdentity({ project, setting: metricSetting, mode, index: 0 }),
      traffic: metrics.traffic,
      search: metrics.search,
    }),
  })
})
