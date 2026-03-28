// src/app/api/cron/financials/route.ts
/**
 * GET /api/cron/financials
 *
 * Weekly cron — syncs company descriptions, market cap, exchange,
 * logo, and financial ratios from Polygon into the assets table.
 *
 * Processes tickers in bootstrap_priority order (1 first, 3 last).
 * Respects Polygon free tier: 5 req/min with 13s pause between batches.
 *
 * Schedule: add to vercel.json
 *   { "path": "/api/cron/financials", "schedule": "0 6 * * 1" }
 *   (Mondays at 6am UTC)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { syncTickerFinancials } from '@/lib/polygon-ticker'

export const maxDuration = 300

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db  = createServiceClient()
  const log: string[] = []

  try {
    // Fetch all active assets ordered by priority
    const { data: assets } = await db
      .from('assets')
      .select('ticker, asset_type, bootstrap_priority')
      .eq('is_active', true)
      .in('asset_type', ['stock', 'etf'])  // only stock/ETF have Polygon reference data
      .order('bootstrap_priority', { ascending: true })
      .order('ticker')

    if (!assets?.length) {
      return NextResponse.json({ ok: true, log: ['No active stock/ETF assets found'] })
    }

    const tickers = assets.map((a: any) => a.ticker)
    log.push(`Syncing financials for ${tickers.length} tickers`)

    const { synced, failed } = await syncTickerFinancials(db, tickers)

    log.push(`Synced: ${synced} · Failed: ${failed.length}`)
    if (failed.length > 0) {
      log.push(`Failed tickers: ${failed.slice(0, 10).join(', ')}${failed.length > 10 ? '...' : ''}`)
    }

    return NextResponse.json({ ok: true, synced, failed: failed.length, log })
  } catch (e) {
    console.error('[cron/financials]', e)
    return NextResponse.json({ ok: false, error: String(e), log }, { status: 500 })
  }
}
