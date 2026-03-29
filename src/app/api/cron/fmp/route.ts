// src/app/api/cron/fmp/route.ts
/**
 * GET /api/cron/fmp
 *
 * Weekly cron (Sundays 5am UTC) — syncs FMP financials for priority-1 tickers.
 * ~17 tickers, single batch call to FMP, completes in <10s.
 *
 * Add to vercel.json:
 *   { "path": "/api/cron/fmp", "schedule": "0 5 * * 0" }
 *
 * Auth: CRON_SECRET bearer token
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { syncFMPToAssets } from '@/lib/fmp'

export const maxDuration = 60

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db  = createServiceClient()
  const log: string[] = []

  try {
    const { data: assets } = await db
      .from('assets')
      .select('ticker')
      .eq('is_active', true)
      .eq('bootstrap_priority', 1)
      .in('asset_type', ['stock', 'etf'])  // FMP doesn't cover crypto/commodities
      .order('ticker')

    const tickers = (assets ?? []).map((a: any) => a.ticker)
    log.push(`Syncing FMP financials for ${tickers.length} priority-1 tickers...`)

    const { synced, failed } = await syncFMPToAssets(db, tickers)

    log.push(`Synced: ${synced} · Failed: ${failed.length}`)
    if (failed.length > 0) log.push(`Failed: ${failed.join(', ')}`)

    return NextResponse.json({ ok: true, synced, failed: failed.length, log })
  } catch (e) {
    console.error('[cron/fmp]', e)
    return NextResponse.json({ ok: false, error: String(e), log }, { status: 500 })
  }
}
