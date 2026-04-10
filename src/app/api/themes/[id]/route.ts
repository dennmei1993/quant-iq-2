// src/app/api/themes/[id]/route.ts
// Returns full theme detail for the home page inline panel.
// For tickers missing from asset_signals, falls back to daily_prices directly.

import { NextRequest, NextResponse } from 'next/server'
import { fetchThemeDetail } from '@/lib/themes'
import { createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    if (!id) return NextResponse.json({ error: 'Missing theme id' }, { status: 400 })

    const { theme, signalMap } = await fetchThemeDetail(id)
    if (!theme) return NextResponse.json({ error: 'Theme not found' }, { status: 404 })

    // Build initial tickers
    let tickers: any[] = theme.ticker_weights.map(t => ({
      ...t,
      ...(signalMap[t.ticker] ?? { signal: null, score: null, price_usd: null, change_pct: null }),
    }))

    // Find tickers still missing price — Polygon may not cover them
    const stillMissingPrice = tickers
      .filter(t => t.price_usd == null)
      .map(t => t.ticker)

    if (stillMissingPrice.length > 0) {
      // Try sync-prices first (covers Polygon-listed assets)
      try {
        const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.betteroption.com.au'
        await fetch(`${base}/api/admin/sync-prices?tickers=${stillMissingPrice.join(',')}`, {
          method:  'POST',
          headers: { 'x-admin-secret': process.env.ADMIN_SECRET ?? '' },
          signal:  AbortSignal.timeout(12_000),
        })
      } catch { /* sync failed — fall through to daily_prices */ }

      // Regardless of sync outcome, fetch latest price from daily_prices
      // This covers ETFs/assets not on Polygon
      const db = createServiceClient()
      const priceResults = await Promise.all(
        stillMissingPrice.map(ticker =>
          db.from('daily_prices')
            .select('ticker, close, date')
            .eq('ticker', ticker)
            .order('date', { ascending: false })
            .limit(1)
            .maybeSingle()
            .then(r => r.data)
        )
      )

      // Also re-fetch asset_signals in case sync-prices just populated them
      const { data: freshSignals } = await db
        .from('asset_signals')
        .select('ticker, signal, score, price_usd, change_pct')
        .in('ticker', stillMissingPrice)

      const freshSignalMap: Record<string, any> = {}
      for (const row of freshSignals ?? []) {
        freshSignalMap[row.ticker] = row
      }

      // daily_prices price map as final fallback
      const dailyPriceMap: Record<string, number> = {}
      for (const row of priceResults) {
        if (row?.ticker && row?.close != null) dailyPriceMap[row.ticker] = row.close
      }

      // Rebuild tickers with best available data
      tickers = theme.ticker_weights.map(t => {
        const existing = signalMap[t.ticker]
        const fresh    = freshSignalMap[t.ticker]
        const sig      = fresh ?? existing

        return {
          ...t,
          signal:     sig?.signal     ?? null,
          score:      sig?.score      ?? null,
          // Price priority: asset_signals (fresh) → asset_signals (existing) → daily_prices
          price_usd:  sig?.price_usd  != null ? sig.price_usd : (dailyPriceMap[t.ticker] ?? null),
          change_pct: sig?.change_pct ?? null,
        }
      })
    }

    return NextResponse.json({ theme, tickers })

  } catch (e: any) {
    console.error('[api/themes/[id]]', e)
    return NextResponse.json({ error: e.message ?? 'Server error' }, { status: 500 })
  }
}
