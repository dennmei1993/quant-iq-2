// src/app/api/events/route.ts
// Query params: limit, impact (min score 0-10), sector, since (ISO), event_type
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type EventRow = {
  id:              string
  headline:        string
  event_type:      string | null
  sectors:         string[] | null
  sentiment_score: number | null
  impact_score:    number | null
  tickers:         string[] | null
  ai_summary:      string | null
  published_at:    string
  source:          string | null
}

const SELECT = 'id, headline, event_type, sectors, sentiment_score, impact_score, tickers, ai_summary, published_at, source'

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const p         = req.nextUrl.searchParams
    const limit     = Math.min(Number(p.get('limit') ?? 100), 500)
    const impact    = p.get('impact')      // minimum impact_score e.g. "5"
    const sector    = p.get('sector')
    const since     = p.get('since')
    const eventType = p.get('event_type')

    const defaultSince = since ?? new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()

    // ── Pass 1: events within the requested time window ──
    let q = supabase
      .from('events')
      .select(SELECT)
      .eq('ai_processed', true)
      .gte('published_at', defaultSince)
      .order('impact_score', { ascending: false })
      .order('published_at', { ascending: false })
      .limit(limit)

    if (impact)    q = q.gte('impact_score', Number(impact))
    if (sector)    q = q.contains('sectors', [sector])
    if (eventType) q = q.eq('event_type', eventType)

    const { data, error } = await q
    if (error) throw error

    let events: EventRow[] = (data as EventRow[]) ?? []

    // ── Pass 2: backfill with older events if window is sparse ──
    if (events.length < limit && !since) {
      const needed      = limit - events.length
      const existingIds = events.map(e => e.id)

      let backfillQ = supabase
        .from('events')
        .select(SELECT)
        .eq('ai_processed', true)
        .lt('published_at', defaultSince)
        .order('impact_score', { ascending: false })
        .order('published_at', { ascending: false })
        .limit(needed)

      if (impact)    backfillQ = backfillQ.gte('impact_score', Number(impact))
      if (sector)    backfillQ = backfillQ.contains('sectors', [sector])
      if (eventType) backfillQ = backfillQ.eq('event_type', eventType)
      if (existingIds.length) {
        backfillQ = backfillQ.not('id', 'in', `(${existingIds.map(id => `"${id}"`).join(',')})`)
      }

      const { data: backfill } = await backfillQ
      events.push(...((backfill as EventRow[]) ?? []))
    }

    return NextResponse.json({ events, count: events.length })
  } catch (e) {
    console.error('[api/events]', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}