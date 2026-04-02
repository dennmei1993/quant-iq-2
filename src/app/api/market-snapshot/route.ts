// src/app/api/market-snapshot/route.ts
/**
 * GET /api/market-snapshot
 * Returns live index quotes from FMP stable/quote endpoint.
 * Uses real indexes: S&P 500, Dow Jones, NASDAQ, VIX.
 * Cached for 5 minutes.
 */
import { NextResponse } from 'next/server'

const FMP_BASE = 'https://financialmodelingprep.com/stable'

type Quote = {
  symbol:      string
  label:       string
  price:       number | null
  change:      number | null
  change_pct:  number | null
  dayHigh:     number | null
  dayLow:      number | null
}

const INDEXES = [
  { symbol: '^GSPC', label: 'S&P 500'   },
  { symbol: '^DJI',  label: 'Dow Jones'  },
  { symbol: '^IXIC', label: 'NASDAQ'     },
  { symbol: '^VIX',  label: 'VIX'        },
]

export async function GET() {
  try {
    const key     = process.env.FMP_API_KEY ?? ''
    const symbols = INDEXES.map(i => i.symbol).join(',')
    const url     = `${FMP_BASE}/batch-quote?symbols=${encodeURIComponent(symbols)}&apikey=${key}`

    const res  = await fetch(url, { next: { revalidate: 300 } })
    if (!res.ok) throw new Error(`FMP error: ${res.status}`)

    const json: any[] = await res.json()

    const quotes: Quote[] = INDEXES.map(idx => {
      const r = json.find((q: any) =>
        q.symbol === idx.symbol || q.symbol === idx.symbol.replace('^', '')
      )
      return {
        symbol:     idx.symbol,
        label:      idx.label,
        price:      r?.price          ?? null,
        change:     r?.change         ?? null,
        change_pct: r?.changePercentage ?? null,
        dayHigh:    r?.dayHigh        ?? null,
        dayLow:     r?.dayLow         ?? null,
      }
    })

    return NextResponse.json({ quotes, timestamp: new Date().toISOString() })
  } catch (e) {
    console.error('[market-snapshot]', e)
    return NextResponse.json({ quotes: [], error: String(e), timestamp: new Date().toISOString() })
  }
}
