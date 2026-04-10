// src/app/api/themes/[id]/route.ts
// Returns full theme detail for the home page inline panel
// Syncs missing asset_signals on demand before returning

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

    if (!id) {
      return NextResponse.json({ error: 'Missing theme id' }, { status: 400 })
    }

    const { theme, signalMap } = await fetchThemeDetail(id)

    if (!theme) {
      return NextResponse.json({ error: 'Theme not found' }, { status: 404 })
    }

    // Build initial tickers array
    let tickers = theme.ticker_weights.map(t => ({
      ...t,
      ...(signalMap[t.ticker] ?? { signal: null, score: null, price_usd: null, change_pct: null }),
    }))

    // Find tickers missing from asset_signals entirely
    const missingTickers = tickers
      .filter((t: any) => t.price_usd == null && t.signal == null)
      .map((t: any) => t.ticker as string)

    if (missingTickers.length > 0) {
      try {
        // Trigger sync — same endpoint the ticker page uses
        const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.betteroption.com.au'
        await fetch(`${base}/api/admin/sync-prices?tickers=${missingTickers.join(',')}`, {
          method:  'POST',
          headers: { 'x-admin-secret': process.env.ADMIN_SECRET ?? '' },
          signal:  AbortSignal.timeout(15_000),
        })

        // Re-fetch fresh signals for the synced tickers
        const db = createServiceClient()
        const { data: freshRows } = await db
          .from('asset_signals')
          .select('ticker, signal, score, price_usd, change_pct')
          .in('ticker', missingTickers)

        if (freshRows?.length) {
          const freshMap: Record<string, any> = { ...signalMap }
          for (const row of freshRows) {
            freshMap[row.ticker] = {
              signal:     row.signal,
              score:      row.score,
              price_usd:  row.price_usd,
              change_pct: row.change_pct,
            }
          }
          // Rebuild tickers with fresh data
          tickers = theme.ticker_weights.map(t => ({
            ...t,
            ...(freshMap[t.ticker] ?? { signal: null, score: null, price_usd: null, change_pct: null }),
          }))
        }
      } catch {
        // Sync failed — return what we have
      }
    }

    return NextResponse.json({ theme, tickers })

  } catch (e: any) {
    console.error('[api/themes/[id]]', e)
    return NextResponse.json(
      { error: e.message ?? 'Internal server error' },
      { status: 500 }
    )
  }
}
