/**
 * lib/polygon-ticker.ts
 *
 * Polygon.io helpers for the ticker detail page.
 * Fetches company info, latest price, and 30-day OHLC bars.
 */

const BASE = 'https://api.polygon.io'
const KEY  = () => process.env.POLYGON_API_KEY ?? ''

export interface TickerDetails {
  ticker:       string
  name:         string
  description:  string | null
  market_cap:   number | null
  sector:       string | null
  industry:     string | null
  exchange:     string | null
  employees:    number | null
  homepage:     string | null
  logo_url:     string | null
  list_date:    string | null
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

/** Company reference data — description, market cap, sector etc */
export async function fetchTickerDetails(ticker: string): Promise<TickerDetails | null> {
  try {
    const res  = await fetch(`${BASE}/v3/reference/tickers/${ticker}?apiKey=${KEY()}`, {
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const json = await res.json()
    const r    = json.results
    if (!r) return null

    return {
      ticker:      r.ticker,
      name:        r.name ?? ticker,
      description: r.description ?? null,
      market_cap:  r.market_cap ?? null,
      sector:      r.sic_description ?? null,
      industry:    r.sic_description ?? null,
      exchange:    r.primary_exchange ?? null,
      employees:   r.total_employees ?? null,
      homepage:    r.homepage_url ?? null,
      logo_url:    r.branding?.logo_url
                     ? `${r.branding.logo_url}?apiKey=${KEY()}`
                     : null,
      list_date:   r.list_date ?? null,
    }
  } catch {
    return null
  }
}

/** Previous session close — price, change%, volume */
export async function fetchTickerPrice(ticker: string): Promise<TickerPrice | null> {
  try {
    const res  = await fetch(`${BASE}/v2/aggs/ticker/${ticker}/prev?apiKey=${KEY()}`, {
      signal: AbortSignal.timeout(8000),
    })
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

/** 30 trading days of daily OHLC bars for sparkline/chart */
export async function fetchTickerBars(ticker: string, days = 30): Promise<DayBar[]> {
  try {
    const to   = new Date()
    const from = new Date(Date.now() - days * 1.5 * 24 * 60 * 60 * 1000) // buffer for weekends
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

/** Format market cap to human-readable string */
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
