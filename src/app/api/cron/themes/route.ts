// src/app/api/cron/themes/route.ts
// Runs hourly — clusters recent events into investment themes

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { generateTheme } from '@/lib/ai'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  // Fetch high-impact events from the last 48 hours
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
  const { data: events } = await supabase
    .from('events')
    .select('id, headline, sectors, sentiment_score, impact_level')
    .eq('ai_processed', true)
    .in('impact_level', ['high', 'medium'])
    .gte('published_at', cutoff)
    .order('sentiment_score', { ascending: false })
    .limit(30)

  if (!events?.length) {
    return NextResponse.json({ message: 'No events to cluster', themes: 0 })
  }

  const timeframes: Array<'1m' | '3m' | '6m'> = ['1m', '3m', '6m']
  let themesGenerated = 0

  for (const timeframe of timeframes) {
    try {
      await new Promise(r => setTimeout(r, 2000)) // Rate limit

      const themeData = await generateTheme(
        events.map(e => ({
          headline: e.headline,
          sectors: e.sectors ?? [],
          sentiment_score: e.sentiment_score ?? 0,
        })),
        timeframe
      )

      // Deactivate old themes for this timeframe before inserting new ones
      await supabase
        .from('themes')
        .update({ is_active: false })
        .eq('timeframe', timeframe)
        .eq('is_active', true)

      // Insert new theme
      const expiresAt = new Date()
      expiresAt.setHours(expiresAt.getHours() + (timeframe === '1m' ? 24 : timeframe === '3m' ? 72 : 168))

      await supabase.from('themes').insert({
        name: themeData.name,
        label: themeData.label,
        timeframe,
        conviction: themeData.conviction,
        momentum: themeData.momentum,
        brief: themeData.brief,
        supporting_event_ids: events.slice(0, 5).map(e => e.id),
        candidate_tickers: themeData.candidate_tickers,
        is_active: true,
        expires_at: expiresAt.toISOString(),
      })

      themesGenerated++
    } catch (err) {
      console.error(`Theme generation failed for ${timeframe}:`, err)
    }
  }

  return NextResponse.json({ success: true, themes: themesGenerated, timestamp: new Date().toISOString() })
}
