// src/app/api/themes/[id]/route.ts
// Returns full theme detail including ticker weights and asset signals
// Called by HomeClient when user expands a theme inline

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const db = createServiceClient()
  const { id } = params

  // Fetch theme + ticker weights + signals in parallel
  const [themeRes, tickerRes] = await Promise.all([
    db.from('themes')
      .select('id, name, label, timeframe, conviction, momentum, brief, anchor_reason, anchored_since, expires_at, theme_type')
      .eq('id', id)
      .single(),

    db.from('theme_tickers')
      .select('ticker, final_weight, relevance, rationale, assets!inner(asset_type, name)')
      .eq('theme_id', id)
      .order('final_weight', { ascending: false })
      .limit(10),
  ])

  if (themeRes.error || !themeRes.data) {
    return NextResponse.json({ error: 'Theme not found' }, { status: 404 })
  }

  const tickers = tickerRes.data ?? []

  // Fetch signals for these tickers
  const tickerSymbols = tickers.map(t => t.ticker)
  const signalRes = tickerSymbols.length > 0
    ? await db.from('asset_signals')
        .select('ticker, signal, score, price_usd, change_pct')
        .in('ticker', tickerSymbols)
    : { data: [] }

  const signalMap = Object.fromEntries(
    (signalRes.data ?? []).map(s => [s.ticker, s])
  )

  return NextResponse.json({
    theme:     themeRes.data,
    tickers:   tickers.map(t => ({
      ticker:       t.ticker,
      name:         (t.assets as any)?.name ?? t.ticker,
      asset_type:   (t.assets as any)?.asset_type ?? null,
      final_weight: t.final_weight ?? 0,
      relevance:    t.relevance ?? 0,
      rationale:    t.rationale ?? null,
      signal:       signalMap[t.ticker]?.signal ?? null,
      score:        signalMap[t.ticker]?.score ?? null,
      price_usd:    signalMap[t.ticker]?.price_usd ?? null,
      change_pct:   signalMap[t.ticker]?.change_pct ?? null,
    })),
  })
}
