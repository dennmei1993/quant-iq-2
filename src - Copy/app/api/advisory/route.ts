// src/app/api/advisory/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateAdvisoryMemo } from '@/lib/ai'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { portfolio_id } = await request.json()

  // Fetch holdings
  const { data: holdings } = await supabase
    .from('holdings')
    .select('ticker, name')
    .eq('portfolio_id', portfolio_id)

  if (!holdings?.length) {
    return NextResponse.json({ error: 'No holdings found' }, { status: 400 })
  }

  // Fetch recent high-impact events
  const { data: events } = await supabase
    .from('events')
    .select('headline, sentiment_score, impact_level')
    .eq('ai_processed', true)
    .in('impact_level', ['high', 'medium'])
    .order('published_at', { ascending: false })
    .limit(10)

  const memo = await generateAdvisoryMemo(
    holdings,
    events ?? [],
    'Fed on hold, inflation sticky at 3.1%, moderate growth'
  )

  // Store memo
  const { data: saved } = await supabase
    .from('advisory_memos')
    .insert({
      user_id: user.id,
      portfolio_id,
      memo_text: memo,
    })
    .select('id')
    .single()

  return NextResponse.json({ memo, memo_id: saved?.id })
}
