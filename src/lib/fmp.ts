// src/lib/fmp.ts
/**
 * Financial Modeling Prep (FMP) API helpers.
 * Starter plan: 300 req/min — no batching delays needed.
 *
 * Fetches per ticker (single API call to /profile endpoint):
 *   P/E TTM, P/B, EPS TTM, Beta, Dividend Yield,
 *   52W High/Low, Revenue TTM, Profit Margin,
 *   Analyst price target, Analyst rating
 */

const BASE = 'https://financialmodelingprep.com/stable'

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Single ticker profile ────────────────────────────────────────────────────

export async function fetchFMPProfile(ticker: string): Promise<FMPProfile | null> {
  try {
    const url = `${BASE}/profile?symbol=${ticker}&apikey=${fmpKey()}`
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return null

    const json = await res.json()
    const r    = Array.isArray(json) ? json[0] : json
    if (!r?.symbol) return null

    return {
      ticker:         ticker,
      pe_ratio:       safe(r.pe),
      pb_ratio:       safe(r.priceToBookRatio),
      eps:            safe(r.eps),
      beta:           safe(r.beta),
      dividend_yield: safe(r.lastDiv) && safe(r.price)
                        ? safe(((r.lastDiv * 4) / r.price) * 100)  // annualised %
                        : safe(r.dividendYield ?? r.lastDiv),
      week_52_high:   safe(r.range?.split('-')?.[1]) ?? safe(r['52WeekHigh']),
      week_52_low:    safe(r.range?.split('-')?.[0]) ?? safe(r['52WeekLow']),
      revenue:        safe(r.revenue),
      profit_margin:  safe(r.netProfitMargin) ?? (
                        safe(r.revenue) && safe(r.netIncome)
                          ? (r.netIncome / r.revenue) * 100
                          : null
                      ),
      analyst_target: safe(r.targetPrice) ?? null,
      analyst_rating: r.rating ?? null,
      description:    r.description ?? null,
      market_cap:     safe(r.mktCap),
      exchange:       r.exchange ?? r.exchangeShortName ?? null,
      logo_url:       r.image ?? null,
      employees:      safe(r.fullTimeEmployees),
    }
  } catch (e) {
    console.error(`[fmp] profile ${ticker} error:`, e)
    return null
  }
}

// ─── Batch fetch (Starter: 300 req/min — no delays needed) ───────────────────

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
      const url = `${BASE}/profile?symbols=${joined}&apikey=${fmpKey()}`
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
      if (!res.ok) continue

      const json = await res.json()
      const rows = Array.isArray(json) ? json : [json]

      for (const r of rows) {
        if (!r?.symbol) continue
        const t = r.symbol.toUpperCase()
        result.set(t, {
          ticker:         t,
          pe_ratio:       safe(r.pe),
          pb_ratio:       safe(r.priceToBookRatio),
          eps:            safe(r.eps),
          beta:           safe(r.beta),
          dividend_yield: safe(r.lastDiv) && safe(r.price)
                            ? parseFloat(((r.lastDiv * 4 / r.price) * 100).toFixed(4))
                            : safe(r.dividendYield),
          week_52_high:   safe(r['52WeekHigh']) ?? safe(r.range?.split('-')?.[1]),
          week_52_low:    safe(r['52WeekLow'])  ?? safe(r.range?.split('-')?.[0]),
          revenue:        safe(r.revenue),
          profit_margin:  safe(r.netProfitMargin) ?? (
                            r.revenue && r.netIncome
                              ? parseFloat(((r.netIncome / r.revenue) * 100).toFixed(4))
                              : null
                          ),
          analyst_target: safe(r.targetPrice) ?? null,
          analyst_rating: r.rating ?? null,
          description:    r.description ?? null,
          market_cap:     safe(r.mktCap),
          exchange:       r.exchangeShortName ?? r.exchange ?? null,
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

// ─── Write profiles to assets table ──────────────────────────────────────────

export async function syncFMPToAssets(
  db:       any,
  tickers:  string[]
): Promise<{ synced: number; failed: string[] }> {
  const profiles = await fetchFMPProfiles(tickers)
  let synced = 0
  const failed: string[] = []

  for (const [ticker, p] of profiles) {
    try {
      const update: Record<string, any> = {
        financials_updated_at: new Date().toISOString(),
      }

      // Only set fields that have real values
      if (p.pe_ratio       != null) update.pe_ratio        = p.pe_ratio
      if (p.pb_ratio       != null) update.pb_ratio        = p.pb_ratio
      if (p.eps            != null) update.eps             = p.eps
      if (p.beta           != null) update.beta            = p.beta
      if (p.dividend_yield != null) update.dividend_yield  = p.dividend_yield
      if (p.week_52_high   != null) update.week_52_high    = p.week_52_high
      if (p.week_52_low    != null) update.week_52_low     = p.week_52_low
      if (p.revenue        != null) update.revenue         = p.revenue
      if (p.profit_margin  != null) update.profit_margin   = p.profit_margin
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
