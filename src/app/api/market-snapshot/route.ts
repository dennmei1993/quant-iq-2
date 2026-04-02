// src/app/api/market-snapshot/route.ts
/**
 * GET /api/market-snapshot
 * Returns live index quotes and VIX from Polygon prev-close endpoint.
 * Called client-side from the dashboard — cached for 5 minutes.
 */
import { NextResponse } from 'next/server'

const POLY = 'https://api.polygon.io'
const KEY  = process.env.POLYGON_API_KEY ?? ''

type Quote = {
  ticker:     string
  label:      string
  price:      number | null
  change:     number | null
  change_pct: number | null
}

async function getPrevClose(ticker: string): Promise<Quote | null> {
  try {
    const res  = await fetch(
      `${POLY}/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${KEY}`,
      { next: { revalidate: 300 } }  // cache 5 minutes
    )
    if (!res.ok) return null
    const json = await res.json()
    const r    = json.results?.[0]
    if (!r) return null

    return {
      ticker,
      label:      ticker,
      price:      r.c  ?? null,
      change:     r.c != null && r.o != null ? r.c - r.o : null,
      change_pct: r.c != null && r.o != null ? ((r.c - r.o) / r.o) * 100 : null,
    }
  } catch { return null }
}

export async function GET() {
  // Fetch all in parallel
  const [spy, qqq, dia, vix] = await Promise.all([
    getPrevClose('SPY'),   // S&P 500
    getPrevClose('QQQ'),   // NASDAQ
    getPrevClose('DIA'),   // Dow Jones
    getPrevClose('VIXY'),  // VIX proxy ETF (free tier)
  ])

  const labels: Record<string, string> = {
    SPY:  'S&P 500',
    QQQ:  'NASDAQ',
    DIA:  'Dow Jones',
    VIXY: 'VIX',
  }

  const quotes = [spy, qqq, dia, vix]
    .filter(Boolean)
    .map(q => ({ ...q!, label: labels[q!.ticker] ?? q!.ticker }))

  return NextResponse.json({ quotes, timestamp: new Date().toISOString() })
}
