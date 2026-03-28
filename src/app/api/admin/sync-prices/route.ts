// src/app/api/admin/sync-prices/route.ts
/**
 * POST /api/admin/sync-prices
 *
 * Manual trigger — syncs prices for ALL 152 tickers.
 * 152 tickers ÷ 5 per batch × 13s = ~400s — run locally or extend timeout.
 * Use priority param to sync a subset:
 *   ?priority=1  — ~23 tickers (~65s)
 *   ?priority=2  — priority 1+2 (~100 tickers, ~260s)
 *   ?priority=3  — all 152 tickers (~400s, may timeout on Vercel)
 *
 * Auth: ADMIN_SECRET header
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

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-admin-secret')
  if (secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const priority = parseInt(req.nextUrl.searchParams.get('priority') ?? '2')
  const db       = createServiceClient()
  const log: string[] = []

  try {
    const query = db
      .from('assets')
      .select('ticker, bootstrap_priority')
      .eq('is_active', true)
      .lte('bootstrap_priority', priority)
      .order('bootstrap_priority')
      .order('ticker')

    const { data: assets } = await query
    const tickers = (assets ?? []).map((a: any) => a.ticker)
    log.push(`Syncing prices for ${tickers.length} tickers (priority ≤ ${priority})...`)

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

    log.push(`Done: ${prices.size} / ${tickers.length} prices synced`)
    return NextResponse.json({ ok: true, synced: prices.size, total: tickers.length, log })
  } catch (e) {
    console.error('[admin/sync-prices]', e)
    return NextResponse.json({ ok: false, error: String(e), log }, { status: 500 })
  }
}
