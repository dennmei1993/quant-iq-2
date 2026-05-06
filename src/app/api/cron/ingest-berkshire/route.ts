// src/app/api/cron/ingest-berkshire/route.ts
// Dedicated route for Berkshire Hathaway 13F holdings.
// Runs on the same quarterly schedule as ingest-13f but as a
// separate job so it can be:
//   - Monitored independently in cron_logs
//   - Triggered manually without running all other 13F managers
//   - Given a higher maxDuration if needed
//
// Vercel cron config (vercel.json):
//   { "path": "/api/cron/ingest-berkshire", "schedule": "0 8 1 3,6,9,12 *" }
//   (1 hour before ingest-13f so logs are cleanly separated)

import { NextRequest, NextResponse } from 'next/server'
import { syncBerkshire } from '@/lib/integrations/sync13F'

export const maxDuration = 300 // 5 min

export async function GET(req: NextRequest) {
  // ── Auth guard ──────────────────────────────────────────────
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    console.log('[CRON] ingest-berkshire starting')
    const result = await syncBerkshire()
    console.log('[CRON] ingest-berkshire complete', result)

    return NextResponse.json({
      ok:     true,
      ...result,
      ran_at: new Date().toISOString(),
    })

  } catch (err) {
    const error = err as Error
    console.error('[CRON] ingest-berkshire failed:', error.message)
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    )
  }
}
