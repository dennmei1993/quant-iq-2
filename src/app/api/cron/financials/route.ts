// src/app/api/cron/financials/route.ts
/**
 * GET /api/cron/financials
 *
 * Daily cron — syncs prices + signals into asset_signals for all tickers.
 * Descriptions/market caps are synced separately via /api/admin/sync-details.
 *
 * Auth: CRON_SECRET bearer token
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchPricesForTickers, fetchSparklinesForTickers } from '@/lib/polygon'

export const maxDuration = 300

function deriveSignal(pct: number): 'buy' | 'watch' | 'hold' | 'avoid' {
  if (pct >= 2)   return 'buy'
  if (pct >= 0.5) return 'watch'
  if (pct >= -1)  return 'hold'
  return 'avoid'
}

function deriveSignalScore(pct: number): number {
  return Math.round(Math.min(100, Math.max(0, 50 + pct * 10)))
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db  = createServiceClient()
  const log: string[] = []

  try {
    const { data: allAssets } = await db
      .from('assets')
      .select('ticker')
      .eq('is_active', true)

    const tickers = (allAssets ?? []).map((a: any) => a.ticker)
    log.push(`Syncing prices for ${tickers.length} tickers...`)

    const prices     = await fetchPricesForTickers(tickers)
    const sparklines = await fetchSparklinesForTickers([...prices.keys()])

    const rows = [...prices.keys()].map(t => {
      const p    = prices.get(t)!
      const bars = sparklines.get(t) ?? []
      return {
        ticker:     t,
        price_usd:  p.price,
        change_pct: p.change_pct,
        signal:     deriveSignal(p.change_pct),
        score:      deriveSignalScore(p.change_pct),
        sparkline:  bars.map((b: any) => b.c),
        updated_at: new Date().toISOString(),
      }
    })

    if (rows.length > 0) {
      await (db.from('asset_signals') as any)
        .upsert(rows, { onConflict: 'ticker' })
    }

    log.push(`Prices synced: ${prices.size} / ${tickers.length}`)

    return NextResponse.json({ ok: true, synced: prices.size, total: tickers.length, log })
  } catch (e) {
    console.error('[cron/financials]', e)
    return NextResponse.json({ ok: false, error: String(e), log }, { status: 500 })
  }
}
