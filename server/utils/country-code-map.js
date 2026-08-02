/* ===================================================================
 * country-code-map.js — ISO 3166-1 alpha-2 ↔ alpha-3 全量映射
 *
 * 用途:
 *   - GSC 筛选转换: GA4 countryId 用 alpha-2 (US/DE/CN),
 *                  GSC country 维度用 alpha-3 (USA/DEU/CHN)
 *   - 跨 provider 维度筛选时统一国家代码必经一步
 *
 * 数据来源: ISO 3166-1 标准 (2024 现行), 共 ~250 条
 * 未识别原样返回 (容错): GA4/GSC 偶尔会返回特殊值如 "(not set)" / "ZZ",
 *                       不要让映射失败导致整个筛选挂掉.
 * =================================================================== */

const ALPHA2_TO_ALPHA3 = {
  AD: 'AND', AE: 'ARE', AF: 'AFG', AG: 'ATG', AI: 'AIA', AL: 'ALB', AM: 'ARM',
  AO: 'AGO', AQ: 'ATA', AR: 'ARG', AS: 'ASM', AT: 'AUT', AU: 'AUS', AW: 'ABW',
  AX: 'ALA', AZ: 'AZE',
  BA: 'BIH', BB: 'BRB', BD: 'BGD', BE: 'BEL', BF: 'BFA', BG: 'BGR', BH: 'BHR',
  BI: 'BDI', BJ: 'BEN', BL: 'BLM', BM: 'BMU', BN: 'BRN', BO: 'BOL', BQ: 'BES',
  BR: 'BRA', BS: 'BHS', BT: 'BTN', BV: 'BVT', BW: 'BWA', BY: 'BLR', BZ: 'BLZ',
  CA: 'CAN', CC: 'CCK', CD: 'COD', CF: 'CAF', CG: 'COG', CH: 'CHE', CI: 'CIV',
  CK: 'COK', CL: 'CHL', CM: 'CMR', CN: 'CHN', CO: 'COL', CR: 'CRI', CU: 'CUB',
  CV: 'CPV', CW: 'CUW', CX: 'CXR', CY: 'CYP', CZ: 'CZE',
  DE: 'DEU', DJ: 'DJI', DK: 'DNK', DM: 'DMA', DO: 'DOM', DZ: 'DZA',
  EC: 'ECU', EE: 'EST', EG: 'EGY', EH: 'ESH', ER: 'ERI', ES: 'ESP', ET: 'ETH',
  FI: 'FIN', FJ: 'FJI', FK: 'FLK', FM: 'FSM', FO: 'FRO', FR: 'FRA',
  GA: 'GAB', GB: 'GBR', GD: 'GRD', GE: 'GEO', GF: 'GUF', GG: 'GGY', GH: 'GHA',
  GI: 'GIB', GL: 'GRL', GM: 'GMB', GN: 'GIN', GP: 'GLP', GQ: 'GNQ', GR: 'GRC',
  GS: 'SGS', GT: 'GTM', GU: 'GUM', GW: 'GNB', GY: 'GUY',
  HK: 'HKG', HM: 'HMD', HN: 'HND', HR: 'HRV', HT: 'HTI', HU: 'HUN',
  ID: 'IDN', IE: 'IRL', IL: 'ISR', IM: 'IMN', IN: 'IND', IO: 'IOT', IQ: 'IRQ',
  IR: 'IRN', IS: 'ISL', IT: 'ITA',
  JE: 'JEY', JM: 'JAM', JO: 'JOR', JP: 'JPN',
  KE: 'KEN', KG: 'KGZ', KH: 'KHM', KI: 'KIR', KM: 'COM', KN: 'KNA', KP: 'PRK',
  KR: 'KOR', KW: 'KWT', KY: 'CYM', KZ: 'KAZ',
  LA: 'LAO', LB: 'LBN', LC: 'LCA', LI: 'LIE', LK: 'LKA', LR: 'LBR', LS: 'LSO',
  LT: 'LTU', LU: 'LUX', LV: 'LVA', LY: 'LBY',
  MA: 'MAR', MC: 'MCO', MD: 'MDA', ME: 'MNE', MF: 'MAF', MG: 'MDG', MH: 'MHL',
  MK: 'MKD', ML: 'MLI', MM: 'MMR', MN: 'MNG', MO: 'MAC', MP: 'MNP', MQ: 'MTQ',
  MR: 'MRT', MS: 'MSR', MT: 'MLT', MU: 'MUS', MV: 'MDV', MW: 'MWI', MX: 'MEX',
  MY: 'MYS', MZ: 'MOZ',
  NA: 'NAM', NC: 'NCL', NE: 'NER', NF: 'NFK', NG: 'NGA', NI: 'NIC', NL: 'NLD',
  NO: 'NOR', NP: 'NPL', NR: 'NRU', NU: 'NIU', NZ: 'NZL',
  OM: 'OMN',
  PA: 'PAN', PE: 'PER', PF: 'PYF', PG: 'PNG', PH: 'PHL', PK: 'PAK', PL: 'POL',
  PM: 'SPM', PN: 'PCN', PR: 'PRI', PS: 'PSE', PT: 'PRT', PW: 'PLW', PY: 'PRY',
  QA: 'QAT',
  RE: 'REU', RO: 'ROU', RS: 'SRB', RU: 'RUS', RW: 'RWA',
  SA: 'SAU', SB: 'SLB', SC: 'SYC', SD: 'SDN', SE: 'SWE', SG: 'SGP', SH: 'SHN',
  SI: 'SVN', SJ: 'SJM', SK: 'SVK', SL: 'SLE', SM: 'SMR', SN: 'SEN', SO: 'SOM',
  SR: 'SUR', SS: 'SSD', ST: 'STP', SV: 'SLV', SX: 'SXM', SY: 'SYR', SZ: 'SWZ',
  TC: 'TCA', TD: 'TCD', TF: 'ATF', TG: 'TGO', TH: 'THA', TJ: 'TJK', TK: 'TKL',
  TL: 'TLS', TM: 'TKM', TN: 'TUN', TO: 'TON', TR: 'TUR', TT: 'TTO', TV: 'TUV',
  TW: 'TWN', TZ: 'TZA',
  UA: 'UKR', UG: 'UGA', UM: 'UMI', US: 'USA', UY: 'URY', UZ: 'UZB',
  VA: 'VAT', VC: 'VCT', VE: 'VEN', VG: 'VGB', VI: 'VIR', VN: 'VNM', VU: 'VUT',
  WF: 'WLF', WS: 'WSM',
  XK: 'XKX',  /* 科索沃 — Google 实际使用此非标准代码 */
  YE: 'YEM', YT: 'MYT',
  ZA: 'ZAF', ZM: 'ZMB', ZW: 'ZWE',
}

/* 反向表 (用于 GSC dimension rows 国家显示时反查 alpha-2 给 CountryFlag) */
const ALPHA3_TO_ALPHA2 = Object.fromEntries(
  Object.entries(ALPHA2_TO_ALPHA3).map(([a2, a3]) => [a3, a2]),
)

/**
 * alpha-2 → alpha-3, 未识别原样返回 (容错)
 * @param {string} code  US / DE / "(not set)" / null 都允许
 * @returns {string}     USA / DEU / "(not set)" (原样)
 */
export function alpha2ToAlpha3(code) {
  const c = String(code || '').toUpperCase().trim()
  return ALPHA2_TO_ALPHA3[c] || c
}

/**
 * alpha-3 → alpha-2, 未识别原样返回
 */
export function alpha3ToAlpha2(code) {
  const c = String(code || '').toUpperCase().trim()
  return ALPHA3_TO_ALPHA2[c] || c
}
