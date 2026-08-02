/* ===========================================================
   country-tier - 国家流量分级 (T1/T2/T3, 营销视角)
   --
   T1: 发达 / 高购买力市场 (16)
   T2: 高潜力新兴市场      (26)
   T3: 其它跟踪市场        (40+)
   未在表中的国家显示空字符串.
   --
   分类仅用于详情页中的国家维度辅助标记。
   =========================================================== */

const TIER_MAP = {
  /* ---- T1 ---- */
  US: 'T1', JP: 'T1', KR: 'T1', CA: 'T1', GB: 'T1', AU: 'T1', DE: 'T1', FR: 'T1',
  ES: 'T1', NL: 'T1', SE: 'T1', NO: 'T1', DK: 'T1', TW: 'T1', HK: 'T1', MO: 'T1',

  /* ---- T2 ---- */
  RU: 'T2', BR: 'T2', MX: 'T2', TH: 'T2', MY: 'T2', AE: 'T2', ZA: 'T2', TR: 'T2',
  EG: 'T2', SG: 'T2', IT: 'T2', NG: 'T2', IL: 'T2', NZ: 'T2', KW: 'T2', PL: 'T2',
  CH: 'T2', QA: 'T2', BE: 'T2', AT: 'T2', GR: 'T2', CZ: 'T2', HU: 'T2', CR: 'T2',
  FI: 'T2', IE: 'T2',

  /* ---- T3 ---- */
  IN: 'T3', ID: 'T3', PH: 'T3', VN: 'T3', SA: 'T3', PK: 'T3', CO: 'T3', AR: 'T3',
  CL: 'T3', IQ: 'T3', PE: 'T3', BD: 'T3', KZ: 'T3', MA: 'T3', KE: 'T3', KH: 'T3',
  RO: 'T3', UA: 'T3', OM: 'T3', EC: 'T3', JO: 'T3', PT: 'T3', UZ: 'T3', GH: 'T3',
  MM: 'T3', LB: 'T3', VE: 'T3', DZ: 'T3', BG: 'T3', BY: 'T3', DO: 'T3', GT: 'T3',
  IR: 'T3', BO: 'T3', CI: 'T3', BH: 'T3', NP: 'T3', SK: 'T3', TN: 'T3', HN: 'T3',
}

export function getCountryTier(code) {
  if (!code) return ''
  return TIER_MAP[String(code).toUpperCase()] || ''
}
