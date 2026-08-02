/* ===================================================================
 * v1 · 漏斗详情 (开放 API)
 *
 * GET /api/v1/funnels/{funnelKey}
 *   Authorization: Bearer sk-xxxxxxxxxxxx
 *
 * 与内部 /api/funnels/{funnelKey} 字段一字不差
 * =================================================================== */

import { loadOwnedFunnel } from '../../../../utils/funnel-access'
import { parseSteps, shapeStep } from '../../../../utils/funnel-steps'

export default defineEventHandler(async (event) => {
  await guardV1(event)

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
