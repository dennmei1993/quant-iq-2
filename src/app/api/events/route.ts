// src/app/api/events/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20'), 50)
  const impact = searchParams.get('impact')       // 'high' | 'medium' | 'low'
  const sector = searchParams.get('sector')
  const since = searchParams.get('since')         // ISO timestamp

  let query = supabase
    .from('events')
    .select('id, headline, ai_summary, source, published_at, event_type, sectors, sentiment_score, impact_level, tickers')
    .eq('ai_processed', true)
    .order('published_at', { ascending: false })
    .limit(limit)

  if (impact) query = query.eq('impact_level', impact)
  if (sector) query = query.contains('sectors', [sector])
  if (since) query = query.gte('published_at', since)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ events: data })
}
