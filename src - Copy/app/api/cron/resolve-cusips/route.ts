// src/app/api/cron/resolve-cusips/route.ts
// Resolves unresolved holdings_13f CUSIPs → tickers in small daily batches.
// Runs daily after ingest jobs so it always processes the freshest unresolved rows.
//
// Vercel cron config (vercel.json):
//   { "path": "/api/cron/resolve-cusips", "schedule": "0 10 * * 1-5" }

import { NextRequest, NextResponse } from 'next/server'
import { resolvePendingCusips } from '@/lib/integrations/resolveCusips'

export const maxDuration = 120 // 2 min — 100 CUSIPs × 1.5s ≈ 15s, well within limit

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    console.log('[CRON] resolve-cusips starting')
    const result = await resolvePendingCusips()
    console.log('[CRON] resolve-cusips complete', result)

    return NextResponse.json({ ok: true, ...result, ran_at: new Date().toISOString() })

  } catch (err) {
    const error = err as Error
    console.error('[CRON] resolve-cusips failed:', error.message)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
}
