/* ===================================================================
 * Bing Webmaster provider - API Key 接入
 *
 *  Bing Webmaster API 第一版只接搜索表现数据:
 *    - GetUserSites              站点列表
 *    - GetRankAndTrafficStats    站点每日 clicks / impressions
 *    - GetQueryStats             query 维度
 *    - GetPageStats              page 维度
 *
 *  约定:
 *    apiKey 存在 data_source_auth.access_token_enc (scope='api_key')
 *    runReport 输出对齐 GSC: { rows: [{ keys, clicks, impressions, ctr, position }] }
 * =================================================================== */

export const authMode = 'api_key'

const ENDPOINT = 'https://ssl.bing.com/webmaster/api.svc/json'
const SUPPORTED_DIMS = new Set(['query', 'page', 'date', 'dateHour', 'yearMonth'])

function credentialOf(args = {}) {
  return String(args.apiKey || args.accessToken || '').trim()
}

function normalizeRows(payload) {
  if (Array.isArray(payload?.d)) return payload.d
  if (Array.isArray(payload)) return payload
  return []
}

function parseBingDate(value) {
  const raw = String(value || '')
  const ms = Number(
    raw.match(/\/Date\((-?\d+)/)?.[1]
    || raw.match(/^(\d{10,13})$/)?.[1]
    || 0,
  )
  if (ms > 0) return new Date(ms).toISOString().slice(0, 10)
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

function inRange(date, startDate, endDate) {
  if (!date) return false
  return date >= String(startDate || '') && date <= String(endDate || '')
}

function compactLabel(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  try {
    const u = new URL(s)
    return u.hostname.replace(/^www\./, '') || s
  } catch {
    return s.replace(/^https?:\/\//, '').replace(/\/$/, '')
  }
}

async function bingGet(method, { apiKey, params = {} }) {
  const key = credentialOf({ apiKey })
  if (!key) throw createError({ statusCode: 401, message: 'bing_api_key_required' })

  const qs = new URLSearchParams({ apikey: key })
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
  }

  const res = await fetch(`${ENDPOINT}/${method}?${qs.toString()}`, {
    headers: { Accept: 'application/json' },
  })
  const text = await res.text().catch(() => '')
  let data = null
  try { data = text ? JSON.parse(text) : null } catch {}

  if (!res.ok || data?.ErrorCode) {
    const message = String(data?.Message || text || '').slice(0, 200)
    if (res.status === 401 || /InvalidApiKey|AccessDenied|Unauthorized/i.test(message)) {
      throw createError({ statusCode: 401, message: 'token_invalid', data: message })
    }
    if (res.status === 429 || /quota|rate/i.test(message)) {
      throw createError({ statusCode: 503, message: 'bing_rate_limited', data: message })
    }
    throw createError({ statusCode: res.status || 502, message: 'bing_api_error', data: message })
  }
  return data
}

export async function validateApiKey({ apiKey }) {
  await listProperties({ apiKey })
  return true
}

export async function listProperties(args = {}) {
  const apiKey = credentialOf(args)
  const resp = await bingGet('GetUserSites', { apiKey })
  const validShape = Array.isArray(resp) || Array.isArray(resp?.d)
  if (!validShape) {
    throw createError({ statusCode: 502, message: 'bing_sites_response_invalid' })
  }
  const rows = normalizeRows(resp)
  if (rows.some((site) => !String(site?.Url || '').trim())) {
    throw createError({ statusCode: 502, message: 'bing_site_identity_missing' })
  }
  return rows
    .filter((site) => site?.Url && site.IsVerified !== false)
    .map((site) => {
      const siteUrl = String(site.Url || '').trim()
      return {
        id: siteUrl,
        label: compactLabel(siteUrl),
        meta: {
          site_url: siteUrl,
          kind: 'url-prefix',
          is_verified: site.IsVerified !== false,
          provider: 'bing',
        },
      }
    })
}

function rowValue(row, key) {
  return Number(row?.[key]) || 0
}

function toMetricRow(row, dim) {
  const date = parseBingDate(row?.Date)
  const clicks = rowValue(row, 'Clicks')
  const impressions = rowValue(row, 'Impressions')
  const position = rowValue(row, 'AvgImpressionPosition') || rowValue(row, 'AvgClickPosition')
  const keys = []

  if (dim === 'query') {
    keys.push(String(row?.Query || '').trim())
  } else if (dim === 'page') {
    keys.push(String(row?.Url || row?.Page || row?.Query || '').trim())
  } else if (dim === 'yearMonth') {
    keys.push(date.slice(0, 7))
  } else if (dim === 'dateHour') {
    keys.push(`${date} 00`)
  } else if (dim === 'date') {
    keys.push(date)
  }

  if (dim && !keys[0]) return null
  return {
    keys,
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position,
    _date: date,
  }
}

function stripInternal(row) {
  const { _date, ...publicRow } = row
  return publicRow
}

function latestSnapshotDate(rows, endDate) {
  return rows
    .map((row) => row._date)
    .filter((date) => date && date <= String(endDate || ''))
    .sort()
    .pop() || ''
}

function filterRowsByPeriod(rows, dim, startDate, endDate) {
  const list = Array.isArray(rows) ? rows : []
  if (dim === 'query' || dim === 'page') {
    const undated = list.filter((row) => !row._date)
    const inWindow = list.filter((row) => row._date && inRange(row._date, startDate, endDate))
    if (inWindow.length || undated.length) return [...inWindow, ...undated]

    /* Bing query/page stats are weekly snapshots and can lag behind the selected window. */
    const latest = latestSnapshotDate(list, endDate)
    return latest ? list.filter((row) => row._date === latest) : []
  }
  return list.filter((row) => inRange(row._date, startDate, endDate))
}

function methodForDim(dim) {
  if (dim === 'query') return 'GetQueryStats'
  if (dim === 'page') return 'GetPageStats'
  return 'GetRankAndTrafficStats'
}

export async function runReport({
  apiKey,
  accessToken,
  siteUrl,
  startDate,
  endDate,
  dimensions = [],
  rowLimit = 50,
}) {
  const key = credentialOf({ apiKey, accessToken })
  if (!siteUrl) throw createError({ statusCode: 400, message: 'bing_site_url_required' })
  const requested = Array.isArray(dimensions) ? dimensions.find((d) => SUPPORTED_DIMS.has(d)) : ''
  const dim = requested || ''
  const method = methodForDim(dim)
  const resp = await bingGet(method, { apiKey: key, params: { siteUrl } })
  const rows = normalizeRows(resp)
    .map((row) => toMetricRow(row, dim))
    .filter(Boolean)
  const periodRows = filterRowsByPeriod(rows, dim, startDate, endDate)

  if (dim === 'query' || dim === 'page') {
    periodRows.sort((a, b) => (b.impressions || 0) - (a.impressions || 0))
  } else {
    periodRows.sort((a, b) => String(a.keys?.[0] || '').localeCompare(String(b.keys?.[0] || '')))
  }

  if (!dim) return { rows: periodRows.map(stripInternal) }
  return {
    rows: periodRows
      .slice(0, Math.min(Math.max(Number(rowLimit) || 50, 1), 25000))
      .map(stripInternal),
  }
}

export function extractTotals(report) {
  const rows = Array.isArray(report?.rows) ? report.rows : []
  if (!rows.length) return { impressions: 0, clicks: 0, ctr: 0, position: 0 }
  let impressions = 0
  let clicks = 0
  let posWeighted = 0
  let posImpressions = 0
  for (const r of rows) {
    const imp = Number(r.impressions) || 0
    const pos = Number(r.position) || 0
    impressions += imp
    clicks += Number(r.clicks) || 0
    if (imp > 0 && pos > 0) {
      posWeighted += pos * imp
      posImpressions += imp
    }
  }
  return {
    impressions,
    clicks,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: posImpressions > 0 ? posWeighted / posImpressions : 0,
  }
}

export function aggregateMetrics(totalsList) {
  if (!Array.isArray(totalsList) || !totalsList.length) {
    return { impressions: 0, clicks: 0, ctr: 0, position: 0 }
  }
  return extractTotals({ rows: totalsList })
}
