// src/app/api/market-snapshot/route.ts
/**
 * GET /api/market-snapshot
 * Returns market quotes using Polygon prev-close (free tier).
 * Uses ETF proxies labelled as their underlying indexes.
 * Cached 5 minutes.
 */
import { NextResponse } from 'next/server'

const POLY = 'https://api.polygon.io'

type Quote = {
  symbol:     string
  label:      string
  sublabel:   string   // e.g. "via SPY"
  price:      number | null
  change:     number | null
  change_pct: number | null
  dayHigh:    number | null
  dayLow:     number | null
}

const TICKERS = [
  { ticker: 'SPY',  label: 'S&P 500',    sublabel: 'via SPY',  isVix: false },
  { ticker: 'QQQ',  label: 'NASDAQ 100', sublabel: 'via QQQ',  isVix: false },
  { ticker: 'DIA',  label: 'Dow Jones',  sublabel: 'via DIA',  isVix: false },
  { ticker: 'VXX',  label: 'VIX',        sublabel: 'via VXX',  isVix: true  },
]

async function getPrevClose(ticker: string): Promise<any | null> {
  try {
    const key = process.env.POLYGON_API_KEY ?? ''
    const res = await fetch(
      `${POLY}/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${key}`,
      { next: { revalidate: 300 } }
    )
    if (!res.ok) return null
    const json = await res.json()
    return json.results?.[0] ?? null
  } catch { return null }
}

export async function GET() {
  const results = await Promise.all(TICKERS.map(t => getPrevClose(t.ticker)))

  const quotes: Quote[] = TICKERS.map((t, i) => {
    const r = results[i]
    return {
      symbol:     t.ticker,
      label:      t.label,
      sublabel:   t.sublabel,
      price:      r?.c  ?? null,
      change:     r?.c != null && r?.o != null ? r.c - r.o : null,
      change_pct: r?.c != null && r?.o != null ? ((r.c - r.o) / r.o) * 100 : null,
      dayHigh:    r?.h  ?? null,
      dayLow:     r?.l  ?? null,
    }
  })

  return NextResponse.json({ quotes, timestamp: new Date().toISOString() })
}
