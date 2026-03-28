// src/app/api/cron/financials/route.ts
/**
 * GET /api/cron/financials
 *
 * Weekly cron (Mondays 6am UTC) — two steps:
 *  1. Sync prices + signals into asset_signals for ALL 152 tickers
 *  2. Sync company descriptions, market cap etc into assets table (stocks/ETFs only)
 *
 * Step 1 runs first so signals are always fresh even if step 2 rate-limits.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { syncTickerFinancials } from '@/lib/polygon-ticker'
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
    // ── Step 1: Price sync → asset_signals (all asset types) ─────────────────
    log.push('Step 1: Syncing prices for all active tickers...')

    const { data: allAssets } = await db
      .from('assets')
      .select('ticker')
      .eq('is_active', true)

    const allTickers = (allAssets ?? []).map((a: any) => a.ticker)
    log.push(`Found ${allTickers.length} active tickers`)

    if (allTickers.length > 0) {
      try {
        const prices     = await fetchPricesForTickers(allTickers)
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

        log.push(`Prices synced: ${prices.size} / ${allTickers.length} tickers`)
      } catch (e) {
        log.push(`Price sync failed: ${String(e)}`)
      }
    }

    // ── Step 2: Financials → assets table (stocks + ETFs only) ───────────────
    log.push('Step 2: Syncing financials (descriptions, market cap etc)...')

    const { data: stockEtfAssets } = await db
      .from('assets')
      .select('ticker, asset_type, bootstrap_priority')
      .eq('is_active', true)
      .in('asset_type', ['stock', 'etf'])
      .order('bootstrap_priority', { ascending: true })
      .order('ticker')

    if (!stockEtfAssets?.length) {
      log.push('No active stock/ETF assets found for financials sync')
      return NextResponse.json({ ok: true, log })
    }

    const tickers = stockEtfAssets.map((a: any) => a.ticker)
    log.push(`Syncing financials for ${tickers.length} stock/ETF tickers`)

    const { synced, failed } = await syncTickerFinancials(db, tickers)
    log.push(`Financials synced: ${synced} · Failed: ${failed.length}`)
    if (failed.length > 0) {
      log.push(`Failed: ${failed.slice(0, 10).join(', ')}${failed.length > 10 ? '...' : ''}`)
    }

    return NextResponse.json({ ok: true, synced, failed: failed.length, log })
  } catch (e) {
    console.error('[cron/financials]', e)
    return NextResponse.json({ ok: false, error: String(e), log }, { status: 500 })
  }
}
