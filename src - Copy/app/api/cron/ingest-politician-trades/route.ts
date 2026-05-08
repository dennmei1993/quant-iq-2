// src/app/api/cron/ingest-politician-trades/route.ts
// Triggered daily on weekdays.
// Vercel cron config (vercel.json):
//   { "path": "/api/cron/ingest-politician-trades", "schedule": "0 8 * * 1-5" }
//
// Source: Financial Modeling Prep (FMP) API — free tier, 250 calls/day
//   Senate: https://financialmodelingprep.com/stable/senate-latest
//   House:  https://financialmodelingprep.com/stable/house-latest
// Requires: FMP_API_KEY env var — sign up at https://financialmodelingprep.com

import { NextRequest, NextResponse } from 'next/server'
import { syncPoliticianTrades } from '@/lib/integrations/syncPoliticianTrades'

export const maxDuration = 60

export async function GET(req: NextRequest) {
  // ── Auth guard ──────────────────────────────────────────────
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    console.log('[CRON] ingest-politician-trades starting')
    const result = await syncPoliticianTrades()
    console.log('[CRON] ingest-politician-trades complete', result)

    return NextResponse.json({
      ok:     true,
      ...result,
      ran_at: new Date().toISOString(),
    })

  } catch (err) {
    const error = err as Error
    console.error('[CRON] ingest-politician-trades failed:', error.message)
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    )
  }
}
