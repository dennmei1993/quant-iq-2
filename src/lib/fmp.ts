// src/lib/fmp.ts
/**
 * Financial Modeling Prep (FMP) API helpers.
 * Starter plan: 300 req/min â€” no batching delays needed.
 *
 * Fetches per ticker (single API call to /profile endpoint):
 *   P/E TTM, P/B, EPS TTM, Beta, Dividend Yield,
 *   52W High/Low, Revenue TTM, Profit Margin,
 *   Analyst price target, Analyst rating
 */

const BASE = 'https://financialmodelingprep.com/stable'

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface FMPProfile {
  ticker:             string
  pe_ratio:           number | null
  pb_ratio:           number | null
  eps:                number | null
  beta:               number | null
  dividend_yield:     number | null
  week_52_high:       number | null
  week_52_low:        number | null
  revenue:            number | null
  profit_margin:      number | null
  analyst_target:     number | null
  analyst_rating:     string | null  // 'Strong Buy' | 'Buy' | 'Hold' | 'Sell' | 'Strong Sell'
  description:        string | null
  market_cap:         number | null
  exchange:           string | null
  logo_url:           string | null
  employees:          number | null
}

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function fmpKey(): string {
  const key = process.env.FMP_API_KEY
  if (!key) throw new Error('FMP_API_KEY is not set')
  return key
}

function safe(val: any): number | null {
  const n = parseFloat(val)
  return isNaN(n) ? null : n
}

// â”€â”€â”€ Single ticker profile â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function fetchFMPProfile(ticker: string): Promise<FMPProfile | null> {
  try {
    const url = `${BASE}/profile/${ticker}?apikey=${fmpKey()}`
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return null

    const json = await res.json()
    const r    = Array.isArray(json) ? json[0] : json
    if (!r?.symbol && !r?.companyName) return null

    // Parse 52w range from "169.21-288.62" format
    const rangeParts = r.range?.split('-') ?? []
    const week52Low  = safe(rangeParts[0])
    const week52High = safe(rangeParts[rangeParts.length - 1])

    // Annualise dividend yield: (lastDividend * 4) / price * 100
    const divYield = r.lastDividend && r.price
      ? parseFloat(((r.lastDividend * 4 / r.price) * 100).toFixed(4))
      : null

    return {
      ticker:         ticker,
      pe_ratio:       safe(r.pe) ?? null,           // not in stable profile, fetched separately
      pb_ratio:       null,                          // not in stable profile
      eps:            safe(r.eps) ?? null,           // not in stable profile
      beta:           safe(r.beta),
      dividend_yield: divYield,
      week_52_high:   week52High,
      week_52_low:    week52Low,
      revenue:        null,                          // not in stable profile
      profit_margin:  null,                          // not in stable profile
      analyst_target: safe(r.targetPrice) ?? null,
      analyst_rating: r.rating ?? null,
      description:    r.description ?? null,
      market_cap:     safe(r.marketCap),
      exchange:       r.exchange ?? r.exchangeFullName ?? null,
      logo_url:       r.image ?? null,
      employees:      safe(r.fullTimeEmployees),
    }
  } catch (e) {
    console.error(`[fmp] profile ${ticker} error:`, e)
    return null
  }
}

// â”€â”€â”€ Batch fetch (Starter: 300 req/min â€” no delays needed) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function fetchFMPProfiles(
  tickers: string[]
): Promise<Map<string, FMPProfile>> {
  const result = new Map<string, FMPProfile>()

  // FMP supports comma-separated tickers in one call
  // Max ~50 per request to keep response size manageable
  const BATCH = 50

  for (let i = 0; i < tickers.length; i += BATCH) {
    const batch   = tickers.slice(i, i + BATCH)
    const joined  = batch.join(',')

    try {
      const url = `${BASE}/profile/${joined}?apikey=${fmpKey()}`
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
      if (!res.ok) continue

      const json = await res.json()
      const rows = Array.isArray(json) ? json : [json]

      for (const r of rows) {
        if (!r?.symbol) continue
        const t = r.symbol.toUpperCase()
        const rParts  = r.range?.split('-') ?? []
        const r52Low  = safe(rParts[0])
        const r52High = safe(rParts[rParts.length - 1])
        const rDiv    = r.lastDividend && r.price
          ? parseFloat(((r.lastDividend * 4 / r.price) * 100).toFixed(4))
          : null

        result.set(t, {
          ticker:         t,
          pe_ratio:       safe(r.pe) ?? null,
          pb_ratio:       null,
          eps:            safe(r.eps) ?? null,
          beta:           safe(r.beta),
          dividend_yield: rDiv,
          week_52_high:   r52High,
          week_52_low:    r52Low,
          revenue:        null,
          profit_margin:  null,
          analyst_target: safe(r.targetPrice) ?? null,
          analyst_rating: r.rating ?? null,
          description:    r.description ?? null,
          market_cap:     safe(r.marketCap),
          exchange:       r.exchange ?? r.exchangeFullName ?? null,
          logo_url:       r.image ?? null,
          employees:      safe(r.fullTimeEmployees),
        })
      }
    } catch (e) {
      console.error(`[fmp] batch ${i}-${i + BATCH} error:`, e)
    }
  }

  return result
}

// â”€â”€â”€ TTM Ratios (PE, PB, EPS, Revenue, Profit Margin) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// These come from a separate endpoint: /stable/ratios-ttm

export async function fetchFMPRatios(ticker: string): Promise<{
  pe_ratio:      number | null
  pb_ratio:      number | null
  eps:           number | null
  revenue:       number | null
  profit_margin: number | null
  dividend_yield:number | null
} | null> {
  try {
    const url  = `${BASE}/ratios-ttm/${ticker}?apikey=${fmpKey()}`
    const res  = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return null
    const json = await res.json()
    const r    = Array.isArray(json) ? json[0] : json
    if (!r) return null

    return {
      pe_ratio:      safe(r.priceToEarningsRatioTTM),
      pb_ratio:      safe(r.priceToBookRatioTTM),
      eps:           safe(r.netIncomePerShareTTM),
      revenue:       safe(r.revenuePerShareTTM),
      profit_margin: r.netProfitMarginTTM != null
                       ? parseFloat((r.netProfitMarginTTM * 100).toFixed(2))
                       : null,
      dividend_yield: r.dividendYieldTTM != null
                        ? parseFloat((r.dividendYieldTTM * 100).toFixed(4))
                        : null,
    }
  } catch (e) { console.error(`[fmp] fetch error:`, e); return null }
}

// â”€â”€â”€ Write profiles to assets table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function syncFMPToAssets(
  db:       any,
  tickers:  string[]
): Promise<{ synced: number; failed: string[] }> {
  const profiles = await fetchFMPProfiles(tickers)
  let synced = 0
  const failed: string[] = []

  for (const [ticker, p] of profiles) {
    try {
      // Also fetch TTM ratios for PE, PB, EPS, Revenue, Profit Margin
      const ratios = await fetchFMPRatios(ticker)

      const update: Record<string, any> = {
        financials_updated_at: new Date().toISOString(),
      }

      // Only set fields that have real values
      // Prefer ratios TTM over profile values
      const pe    = ratios?.pe_ratio      ?? p.pe_ratio
      const pb    = ratios?.pb_ratio      ?? p.pb_ratio
      const eps   = ratios?.eps           ?? p.eps
      const rev   = ratios?.revenue       ?? p.revenue
      const margin= ratios?.profit_margin ?? p.profit_margin

      if (pe     != null) update.pe_ratio        = pe
      if (pb     != null) update.pb_ratio        = pb
      if (eps    != null) update.eps             = eps
      if (p.beta           != null) update.beta            = p.beta
      if (p.dividend_yield != null) update.dividend_yield  = p.dividend_yield
      // Override with TTM dividend yield from ratios if available (more accurate)
      if ((ratios as any)?.dividend_yield != null) update.dividend_yield = (ratios as any).dividend_yield
      if (p.week_52_high   != null) update.week_52_high    = p.week_52_high
      if (p.week_52_low    != null) update.week_52_low     = p.week_52_low
      if (rev    != null) update.revenue         = rev
      if (margin != null) update.profit_margin   = margin
      if (p.analyst_target != null) update.analyst_target  = p.analyst_target
      if (p.analyst_rating != null) update.analyst_rating  = p.analyst_rating
      if (p.description    != null) update.description     = p.description
      if (p.market_cap     != null) update.market_cap      = p.market_cap
      if (p.exchange       != null) update.exchange        = p.exchange
      if (p.logo_url       != null) update.logo_url        = p.logo_url

      await (db.from('assets') as any)
        .update(update)
        .eq('ticker', ticker)

      synced++
    } catch {
      failed.push(ticker)
    }
  }

  // Tickers that got no profile from FMP
  for (const t of tickers) {
    if (!profiles.has(t)) failed.push(t)
  }

  return { synced, failed }
}
