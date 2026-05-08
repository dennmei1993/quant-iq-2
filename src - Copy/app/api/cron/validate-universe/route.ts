// src/app/api/cron/validate-universe/route.ts
// Runs daily before ingest jobs to deactivate stale/delisted tickers.
// Vercel cron config (vercel.json):
//   { "path": "/api/cron/validate-universe", "schedule": "0 6 * * 1-5" }

import { NextRequest, NextResponse } from 'next/server'
import { validateUniverse } from '@/lib/integrations/validateUniverse'

export const maxDuration = 120

export async function GET(req: NextRequest) {
  // ── Auth guard ──────────────────────────────────────────────
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    console.log('[CRON] validate-universe starting')
    const result = await validateUniverse()
    console.log('[CRON] validate-universe complete', result)

    return NextResponse.json({
      ok:     true,
      ...result,
      ran_at: new Date().toISOString(),
    })

  } catch (err) {
    const error = err as Error
    console.error('[CRON] validate-universe failed:', error.message)
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    )
  }
}
