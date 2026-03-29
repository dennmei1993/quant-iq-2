// src/lib/fmp.ts
/**
 * Financial Modeling Prep (FMP) API helpers.
 * Starter plan — uses stable endpoints:
 *   /stable/ratios-ttm       → PE, PB, EPS, dividend yield, profit margin
 *   /stable/key-metrics-ttm  → market cap, revenue, beta
 *   /stable/grades-consensus → analyst rating consensus
 *
 * Note: /stable/profile returns [] on Starter plan — skipped.
 */

const BASE = 'https://financialmodelingprep.com/stable'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FMPProfile {
  ticker:          string
  pe_ratio:        number | null
  pb_ratio:        number | null
  eps:             number | null
  beta:            number | null
  dividend_yield:  number | null
  week_52_high:    number | null
  week_52_low:     number | null
  revenue:         number | null
  profit_margin:   number | null
  analyst_target:  number | null
  analyst_rating:  string | null
  market_cap:      number | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmpKey(): string {
  const key = process.env.FMP_API_KEY
  if (!key) throw new Error('FMP_API_KEY is not set')
  return key
}

function safe(val: any): number | null {
  const n = parseFloat(val)
  return isNaN(n) ? null : n
}

async function fmpFetch(url: string): Promise<any> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return null
    const json = await res.json()
    return Array.isArray(json) ? json[0] : json
  } catch (e) {
    console.error(`[fmp] fetch error ${url.split('?')[0]}:`, e)
    return null
  }
}

// ─── Single ticker fetch ──────────────────────────────────────────────────────

export async function fetchFMPProfile(ticker: string): Promise<FMPProfile | null> {
  const [ratios, metrics, grades] = await Promise.all([
    fmpFetch(`${BASE}/ratios-ttm?symbol=${ticker}&apikey=${fmpKey()}`),
    fmpFetch(`${BASE}/key-metrics-ttm?symbol=${ticker}&apikey=${fmpKey()}`),
    fmpFetch(`${BASE}/grades-consensus?symbol=${ticker}&apikey=${fmpKey()}`),
  ])

  // All three failed — ticker not supported
  if (!ratios && !metrics && !grades) return null

  return {
    ticker,
    pe_ratio:       safe(ratios?.priceToEarningsRatioTTM),
    pb_ratio:       safe(ratios?.priceToBookRatioTTM),
    eps:            safe(ratios?.netIncomePerShareTTM),
    beta:           safe(metrics?.beta),
    dividend_yield: ratios?.dividendYieldTTM != null
                      ? parseFloat((ratios.dividendYieldTTM * 100).toFixed(4))
                      : null,
    week_52_high:   null,   // not available on Starter plan without profile
    week_52_low:    null,
    revenue:        safe(metrics?.revenuePerShareTTM),
    profit_margin:  ratios?.netProfitMarginTTM != null
                      ? parseFloat((ratios.netProfitMarginTTM * 100).toFixed(2))
                      : null,
    analyst_target: safe(grades?.priceTarget) ?? safe(grades?.targetConsensus),
    analyst_rating: grades?.consensus ?? null,
    market_cap:     safe(metrics?.marketCap),
  }
}

// ─── Batch fetch ──────────────────────────────────────────────────────────────

export async function fetchFMPProfiles(
  tickers: string[]
): Promise<Map<string, FMPProfile>> {
  const result = new Map<string, FMPProfile>()

  // FMP Starter: 300 req/min — fetch all tickers concurrently in batches of 10
  const BATCH = 10
  for (let i = 0; i < tickers.length; i += BATCH) {
    const batch = tickers.slice(i, i + BATCH)
    await Promise.all(batch.map(async ticker => {
      const profile = await fetchFMPProfile(ticker)
      if (profile) result.set(ticker, profile)
    }))
  }

  return result
}

// ─── Write to assets table ────────────────────────────────────────────────────

export async function syncFMPToAssets(
  db:      any,
  tickers: string[]
): Promise<{ synced: number; failed: string[] }> {
  const profiles = await fetchFMPProfiles(tickers)
  let synced = 0
  const failed: string[] = []

  for (const [ticker, p] of profiles) {
    try {
      const update: Record<string, any> = {
        financials_updated_at: new Date().toISOString(),
      }

      if (p.pe_ratio       != null) update.pe_ratio       = p.pe_ratio
      if (p.pb_ratio       != null) update.pb_ratio       = p.pb_ratio
      if (p.eps            != null) update.eps            = p.eps
      if (p.beta           != null) update.beta           = p.beta
      if (p.dividend_yield != null) update.dividend_yield = p.dividend_yield
      if (p.revenue        != null) update.revenue        = p.revenue
      if (p.profit_margin  != null) update.profit_margin  = p.profit_margin
      if (p.analyst_rating != null) update.analyst_rating = p.analyst_rating
      if (p.analyst_target != null) update.analyst_target = p.analyst_target
      if (p.market_cap     != null) update.market_cap     = p.market_cap

      await (db.from('assets') as any)
        .update(update)
        .eq('ticker', ticker)

      synced++
    } catch (e) {
      console.error(`[fmp] sync error ${ticker}:`, e)
      failed.push(ticker)
    }
  }

  // Tickers with no FMP data
  for (const t of tickers) {
    if (!profiles.has(t)) failed.push(t)
  }

  return { synced, failed }
}
