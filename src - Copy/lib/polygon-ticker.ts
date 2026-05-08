// src/lib/polygon-ticker.ts
/**
 * Polygon.io helpers for ticker detail page and financial data sync.
 *
 * Exports:
 *   fetchTickerDetails()     — company info, financials, for ticker page
 *   fetchTickerPrice()       — previous close price + change%
 *   fetchTickerBars()        — 30-day OHLC bars for sparkline
 *   syncTickerFinancials()   — upsert financials into assets table (for cron)
 *   formatMarketCap()        — human-readable market cap string
 *   formatVolume()           — human-readable volume string
 */

const BASE = 'https://api.polygon.io'
const KEY  = () => process.env.POLYGON_API_KEY ?? ''

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TickerDetails {
  ticker:         string
  name:           string
  description:    string | null
  market_cap:     number | null
  sector:         string | null
  industry:       string | null
  exchange:       string | null
  employees:      number | null
  homepage:       string | null
  logo_url:       string | null
  list_date:      string | null
  pe_ratio:       number | null
  eps:            number | null
  dividend_yield: number | null
  week_52_high:   number | null
  week_52_low:    number | null
  beta:           number | null
}

export interface TickerPrice {
  ticker:     string
  close:      number | null
  open:       number | null
  high:       number | null
  low:        number | null
  volume:     number | null
  change:     number | null
  change_pct: number | null
  date:       string | null
}

export interface DayBar {
  date:   string
  close:  number
  open:   number
  high:   number
  low:    number
  volume: number
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

/** Company reference data + financials from /v3/reference/tickers/{ticker} */
export async function fetchTickerDetails(ticker: string): Promise<TickerDetails | null> {
  try {
    const res  = await fetch(
      `${BASE}/v3/reference/tickers/${ticker}?apiKey=${KEY()}`,
      { signal: AbortSignal.timeout(8000) }
    )
    if (!res.ok) return null
    const json = await res.json()
    const r    = json.results
    if (!r) return null

    return {
      ticker:         r.ticker,
      name:           r.name ?? ticker,
      description:    r.description ?? null,
      market_cap:     r.market_cap ?? null,
      sector:         r.sic_description ?? null,
      industry:       r.sic_description ?? null,
      exchange:       r.primary_exchange ?? null,
      employees:      r.total_employees ?? null,
      homepage:       r.homepage_url ?? null,
      logo_url:       r.branding?.logo_url
                        ? `${r.branding.logo_url}?apiKey=${KEY()}`
                        : null,
      list_date:      r.list_date ?? null,
      // Financial ratios — available on some plans
      pe_ratio:       r.weighted_shares_outstanding
                        ? null  // computed separately if needed
                        : null,
      eps:            null,
      dividend_yield: null,
      week_52_high:   null,
      week_52_low:    null,
      beta:           null,
    }
  } catch {
    return null
  }
}

/** Snapshot — 52w high/low, prev close, day change */
export async function fetchTickerSnapshot(ticker: string): Promise<{
  week_52_high: number | null
  week_52_low:  number | null
  prev_close:   number | null
  change_pct:   number | null
} | null> {
  try {
    const res  = await fetch(
      `${BASE}/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}?apiKey=${KEY()}`,
      { signal: AbortSignal.timeout(8000) }
    )
    if (!res.ok) return null
    const json = await res.json()
    const t    = json.ticker
    if (!t) return null

    return {
      week_52_high: t.day?.h ?? null,
      week_52_low:  t.day?.l ?? null,
      prev_close:   t.prevDay?.c ?? null,
      change_pct:   t.todaysChangePerc ?? null,
    }
  } catch {
    return null
  }
}

/** Previous session close */
export async function fetchTickerPrice(ticker: string): Promise<TickerPrice | null> {
  try {
    const res  = await fetch(
      `${BASE}/v2/aggs/ticker/${ticker}/prev?apiKey=${KEY()}`,
      { signal: AbortSignal.timeout(8000) }
    )
    if (!res.ok) return null
    const json = await res.json()
    const r    = json.results?.[0]
    if (!r) return null

    const change     = r.c - r.o
    const change_pct = r.o > 0 ? ((r.c - r.o) / r.o) * 100 : null

    return {
      ticker,
      close:      r.c ?? null,
      open:       r.o ?? null,
      high:       r.h ?? null,
      low:        r.l  ?? null,
      volume:     r.v  ?? null,
      change:     parseFloat(change.toFixed(4)),
      change_pct: change_pct !== null ? parseFloat(change_pct.toFixed(3)) : null,
      date:       r.t  ? new Date(r.t).toISOString().split('T')[0] : null,
    }
  } catch {
    return null
  }
}

/** 30 trading days of daily OHLC bars */
export async function fetchTickerBars(ticker: string, days = 30): Promise<DayBar[]> {
  try {
    const to   = new Date()
    const from = new Date(Date.now() - days * 1.5 * 24 * 60 * 60 * 1000)
    const fmt  = (d: Date) => d.toISOString().split('T')[0]

    const res  = await fetch(
      `${BASE}/v2/aggs/ticker/${ticker}/range/1/day/${fmt(from)}/${fmt(to)}?adjusted=true&sort=asc&limit=${days}&apiKey=${KEY()}`,
      { signal: AbortSignal.timeout(8000) }
    )
    if (!res.ok) return []
    const json = await res.json()

    return (json.results ?? []).map((r: any) => ({
      date:   new Date(r.t).toISOString().split('T')[0],
      close:  r.c,
      open:   r.o,
      high:   r.h,
      low:    r.l,
      volume: r.v,
    }))
  } catch {
    return []
  }
}

/**
 * Sync financials for a batch of tickers into the assets table.
 * Called from a cron or admin route.
 * Respects Polygon free tier: 5 req/min → 13s sleep between batches of 5.
 */
export async function syncTickerFinancials(
  db: any,
  tickers: string[],
  batchSize = 5,
  sleepMs   = 13_000
): Promise<{ synced: number; failed: string[] }> {
  let synced = 0
  const failed: string[] = []

  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize)

    await Promise.all(batch.map(async ticker => {
      try {
        const details = await fetchTickerDetails(ticker)
        if (!details) { failed.push(ticker); return }

        await (db.from('assets') as any)
          .update({
            name:                  details.name,
            description:           details.description,
            market_cap:            details.market_cap,
            exchange:              details.exchange,
            logo_url:              details.logo_url,
            pe_ratio:              details.pe_ratio,
            eps:                   details.eps,
            dividend_yield:        details.dividend_yield,
            week_52_high:          details.week_52_high,
            week_52_low:           details.week_52_low,
            beta:                  details.beta,
            financials_updated_at: new Date().toISOString(),
          })
          .eq('ticker', ticker)

        synced++
      } catch {
        failed.push(ticker)
      }
    }))

    // Rate limit pause between batches (skip after last batch)
    if (i + batchSize < tickers.length) {
      await new Promise(r => setTimeout(r, sleepMs))
    }
  }

  return { synced, failed }
}

// ─── Formatters ───────────────────────────────────────────────────────────────

export function formatMarketCap(cap: number | null): string {
  if (!cap) return '—'
  if (cap >= 1e12) return `$${(cap / 1e12).toFixed(2)}T`
  if (cap >= 1e9)  return `$${(cap / 1e9).toFixed(2)}B`
  if (cap >= 1e6)  return `$${(cap / 1e6).toFixed(1)}M`
  return `$${cap.toLocaleString()}`
}

export function formatVolume(vol: number | null): string {
  if (!vol) return '—'
  if (vol >= 1e9) return `${(vol / 1e9).toFixed(2)}B`
  if (vol >= 1e6) return `${(vol / 1e6).toFixed(1)}M`
  if (vol >= 1e3) return `${(vol / 1e3).toFixed(0)}K`
  return vol.toLocaleString()
}
