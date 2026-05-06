// src/app/api/cron/ingest-13f/route.ts
// Triggered by Vercel Cron or Supabase pg_cron on a quarterly schedule.
// Vercel cron config (vercel.json):
//   { "path": "/api/cron/ingest-13f", "schedule": "0 9 1 3,6,9,12 *" }
//
// Protected by CRON_SECRET env var — set the same value in your
// scheduler's Authorization header.

import { NextRequest, NextResponse } from 'next/server'
import { syncAll13F } from '@/lib/integrations/sync13F'

export const maxDuration = 300 // 5 min — 13F parsing can be slow

export async function GET(req: NextRequest) {
  // ── Auth guard ──────────────────────────────────────────────
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    console.log('[CRON] ingest-13f starting')
    const results = await syncAll13F()
    console.log('[CRON] ingest-13f complete', results)

    return NextResponse.json({
      ok:      true,
      results,
      ran_at:  new Date().toISOString(),
    })

  } catch (err) {
    const error = err as Error
    console.error('[CRON] ingest-13f failed:', error.message)
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    )
  }
}
