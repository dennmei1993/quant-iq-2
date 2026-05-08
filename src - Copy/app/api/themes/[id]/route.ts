// src/app/api/themes/[id]/route.ts
// Returns full theme detail for the home page inline panel.
// Ensures all theme tickers have signal rows before returning —
// calls sync-prices for any missing, waits for completion.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    if (!id) return NextResponse.json({ error: 'Missing theme id' }, { status: 400 })

    const db = createServiceClient()

    // ── 1. Fetch theme + ticker weights ──────────────────────────────────────
    const [themeRes, tickerRes] = await Promise.all([
      db.from('themes')
        .select('id, name, label, timeframe, conviction, momentum, brief, anchor_reason, anchored_since, expires_at, theme_type')
        .eq('id', id)
        .maybeSingle(),
      db.from('theme_tickers')
        .select('ticker, final_weight, relevance, rationale, assets!inner(asset_type)')
        .eq('theme_id', id)
        .order('final_weight', { ascending: false })
        .limit(10),
    ])

    if (!themeRes.data) {
      return NextResponse.json({ error: 'Theme not found' }, { status: 404 })
    }

    const tickerWeights = (tickerRes.data ?? []).map((r: any) => ({
      ticker:       r.ticker as string,
      final_weight: r.final_weight ?? 0,
      relevance:    r.relevance    ?? 0,
      rationale:    r.rationale    ?? null,
      asset_type:   r.assets?.asset_type ?? null,
    }))

    const symbols = tickerWeights.map(t => t.ticker)
    if (symbols.length === 0) {
      return NextResponse.json({ theme: themeRes.data, tickers: [] })
    }

    // ── 2. Check which tickers are missing from asset_signals ────────────────
    const { data: existingSignals } = await db
      .from('asset_signals')
      .select('ticker, signal, score, price_usd, change_pct')
      .in('ticker', symbols)

    const signalByTicker = new Map(
      (existingSignals ?? []).map(s => [s.ticker, s])
    )

    const missingSignals = symbols.filter(t => !signalByTicker.has(t))

    // ── 3. Sync missing tickers — wait for completion ────────────────────────
    if (missingSignals.length > 0) {
      const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.betteroption.com.au'
      try {
        await fetch(
          `${base}/api/admin/sync-prices?tickers=${missingSignals.join(',')}`,
          {
            method:  'POST',
            headers: { 'x-admin-secret': process.env.ADMIN_SECRET ?? '' },
            signal:  AbortSignal.timeout(25_000),
          }
        )
      } catch { /* sync failed — will fall back to daily_prices below */ }

      // Re-fetch signals after sync
      const { data: freshSignals } = await db
        .from('asset_signals')
        .select('ticker, signal, score, price_usd, change_pct')
        .in('ticker', missingSignals)

      for (const s of freshSignals ?? []) {
        signalByTicker.set(s.ticker, s)
      }
    }

    // ── 4. For tickers still missing price, fall back to daily_prices ────────
    const stillNeedPrice = symbols.filter(t => {
      const s = signalByTicker.get(t)
      return !s || s.price_usd == null
    })

    const dailyPriceMap = new Map<string, number>()
    if (stillNeedPrice.length > 0) {
      const rows = await Promise.all(
        stillNeedPrice.map(ticker =>
          db.from('daily_prices')
            .select('ticker, close')
            .eq('ticker', ticker)
            .order('date', { ascending: false })
            .limit(1)
            .maybeSingle()
            .then(r => r.data)
        )
      )
      for (const row of rows) {
        if (row?.ticker && row.close != null) {
          dailyPriceMap.set(row.ticker, Number(row.close))
        }
      }
    }

    // ── 5. Build final tickers array ─────────────────────────────────────────
    const tickers = tickerWeights.map(t => {
      const sig = signalByTicker.get(t.ticker)
      return {
        ...t,
        signal:     sig?.signal     ?? null,
        score:      sig?.score      ?? null,
        price_usd:  sig?.price_usd  != null
                      ? sig.price_usd
                      : (dailyPriceMap.get(t.ticker) ?? null),
        change_pct: sig?.change_pct ?? null,
      }
    })

    return NextResponse.json({ theme: themeRes.data, tickers })

  } catch (e: any) {
    console.error('[api/themes/[id]]', e)
    return NextResponse.json({ error: e.message ?? 'Server error' }, { status: 500 })
  }
}
