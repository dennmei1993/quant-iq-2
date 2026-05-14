// src/app/api/signals/route.ts
// GET /api/signals?tickers=AAPL,GOOG,TSLA
// Returns latest price from daily_prices + signal data from asset_signals
// Used by workspace to price watchlist items not already in holdings

import { NextRequest, NextResponse } from 'next/server'
import { requireUser, errorResponse } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  try {
    const { supabase } = await requireUser()
    const tickerParam = req.nextUrl.searchParams.get('tickers') ?? ''
    const tickers = tickerParam.split(',').map(t => t.trim().toUpperCase()).filter(Boolean)

    if (!tickers.length) return NextResponse.json({ signals: [] })

    // Fetch latest price per ticker from daily_prices
    // Use a subquery pattern: for each ticker get the row with the most recent date
    const { data: prices, error: priceErr } = await supabase
      .from('daily_prices')
      .select('ticker, date, close')
      .in('ticker', tickers)
      .order('date', { ascending: false })

    if (priceErr) throw priceErr

    // Keep only the latest row per ticker
    const latestPrice: Record<string, number> = {}
    for (const row of (prices ?? [])) {
      if (!latestPrice[row.ticker] && row.close != null) {
        latestPrice[row.ticker] = parseFloat(row.close)
      }
    }

    // Also fetch signal data (for signal/score)
    const { data: sigData } = await supabase
      .from('asset_signals')
      .select('ticker, signal, score, price_usd, change_pct')
      .in('ticker', tickers)

    const signalMap: Record<string, any> = {}
    for (const s of (sigData ?? [])) signalMap[s.ticker] = s

    // Merge: prefer daily_prices close as the price source
    const result = tickers.map(ticker => ({
      ticker,
      price_usd:  latestPrice[ticker] ?? signalMap[ticker]?.price_usd ?? null,
      change_pct: signalMap[ticker]?.change_pct ?? null,
      signal:     signalMap[ticker]?.signal ?? null,
      score:      signalMap[ticker]?.score ?? null,
    }))

    return NextResponse.json({ signals: result })
  } catch (e) {
    const { body, status } = errorResponse(e)
    return NextResponse.json(body, { status })
  }
}
