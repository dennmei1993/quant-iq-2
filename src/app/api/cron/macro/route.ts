/**
 * app/api/cron/macro/route.ts
 *
 * Scores all 6 macro aspects from recent classified events.
 * Run after the ingest cron — e.g. 10:00 UTC daily.
 *
 * Flow:
 *  1. Fetch last 7 days of classified events
 *  2. For each aspect: filter relevant events → compute score → Claude commentary
 *  3. Upsert into macro_scores (one row per aspect)
 *
 * Manual trigger:
 *   Invoke-WebRequest -Uri "https://your-app.vercel.app/api/cron/macro" `
 *     -Headers @{ "Authorization" = "Bearer YOUR_CRON_SECRET" } `
 *     -Method GET -UseBasicParsing
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import {
  ASPECT_CONFIG,
  scoreAspect,
  type MacroAspect,
  type ScoringEvent,
} from '@/lib/macro'

export const runtime     = 'nodejs'
export const maxDuration = 300

const ASPECTS: MacroAspect[] = ['fed', 'inflation', 'labour', 'growth', 'geopolitical', 'credit']

export async function GET(req: NextRequest) {
  const isVercelCron = req.headers.get('x-vercel-cron') === '1'
  const isManualRun  = req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`

  if (!isVercelCron && !isManualRun) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const log:    string[] = []
  const errors: string[] = []
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  // ── 1. Fetch events from last 7 days ──────────────────────────────────────
  const eventsResult = await (supabase
    .from('events')
    .select('id, headline, ai_summary, event_type, sectors, sentiment_score, impact_score, published_at')
    .eq('ai_processed', true)
    .gte('published_at', since)
    .order('published_at', { ascending: false })
    .limit(200) as unknown as Promise<{ data: ScoringEvent[] | null }>)

  const events = eventsResult.data ?? []
  log.push(`Loaded ${events.length} events from last 7 days`)

  if (!events.length) {
    return NextResponse.json({ ok: true, message: 'No events to score', log })
  }

  // ── 2. Score each aspect ──────────────────────────────────────────────────
  const scores = []

  for (const aspect of ASPECTS) {
    try {
      log.push(`Scoring ${ASPECT_CONFIG[aspect].label}...`)

      // Delay between Claude calls
      if (scores.length > 0) await new Promise(r => setTimeout(r, 1000))

      const score = await scoreAspect(aspect, events)
      scores.push(score)

      log.push(`  ${aspect}: ${score.score > 0 ? '+' : ''}${score.score} (${score.direction}, ${score.event_count} events)`)
    } catch (err) {
      errors.push(`${aspect} scoring failed: ${String(err)}`)
    }
  }

  // ── 3. Upsert into macro_scores ───────────────────────────────────────────
  if (scores.length > 0) {
    const upsertResult = await (supabase
      .from('macro_scores') as any)
      .upsert(
        scores.map(s => ({
          aspect:      s.aspect,
          score:       s.score,
          direction:   s.direction,
          commentary:  s.commentary,
          event_count: s.event_count,
          scored_at:   s.scored_at,
        })),
        { onConflict: 'aspect' }
      )
    const upsertErr = (upsertResult as any).error

    if (upsertErr) {
      errors.push(`Upsert failed: ${upsertErr.message}`)
    } else {
      log.push(`Upserted ${scores.length} macro scores`)
    }
  }

  return NextResponse.json({
    ok:     errors.length === 0,
    scored: scores.length,
    log,
    errors,
    ts:     new Date().toISOString(),
  })
}
