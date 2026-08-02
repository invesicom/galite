/* ===================================================================
 * 漏斗详情
 *
 * GET /api/funnels/{funnelKey}
 *
 * 返回: { funnel, project }
 *   funnel  - funnel_key / project_key / name / steps[] / created_at
 *   project - project_key / name / site_url / logo_url
 *     (前端进详情时省一次额外请求, 同时让 UI 知道归属哪个站点)
 * =================================================================== */

import { loadOwnedFunnel } from '../../../utils/funnel-access'
import { parseSteps, shapeStep } from '../../../utils/funnel-steps'

export default defineEventHandler(async (event) => {
  const funnelKey = getRouterParam(event, 'funnelKey')
  const db = await useDb(event)
  const { funnel, project } = await loadOwnedFunnel(event, db, funnelKey)

  const steps = parseSteps(funnel.steps_config).map(shapeStep)

  return reqSuccess({
    funnel: {
      funnel_key: funnel.funnel_key,
      project_key: funnel.project_key,
      name: funnel.name || '',
      step_count: steps.length,
      steps,
      created_at: funnel.created_at,
      updated_at: funnel.updated_at,
    },
    project: {
      project_key: project.project_key,
      name: project.name,
      site_url: project.site_url || '',
      logo_url: project.logo_url || '',
    },
  })
})
