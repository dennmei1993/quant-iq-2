// src/app/api/cron/ingest/route.ts
// Triggered by Vercel Cron every 15 minutes
// Fetches news → scores with Claude → stores in Supabase

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchNewsEvents } from '@/lib/ingest'
import { classifyEvent } from '@/lib/ai'

export const runtime = 'nodejs'
export const maxDuration = 60 // seconds

export async function GET(request: NextRequest) {
  // Verify this is called by Vercel Cron (or our own secret)
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const results = { fetched: 0, new: 0, scored: 0, errors: 0 }

  try {
    const articles = await fetchNewsEvents()
    results.fetched = articles.length

    for (const article of articles) {
      if (!article.title || !article.publishedAt) continue

      // Check if already ingested (by URL)
      const { data: existing } = await supabase
        .from('events')
        .select('id')
        .eq('source_url', article.url)
        .single()

      if (existing) continue

      // Insert raw event first
      const { data: event, error: insertError } = await supabase
        .from('events')
        .insert({
          headline: article.title,
          summary: article.description ?? null,
          source: article.source?.name ?? 'newsapi',
          source_url: article.url,
          published_at: article.publishedAt,
          ai_processed: false,
        })
        .select('id, headline, summary')
        .single()

      if (insertError || !event) { results.errors++; continue }
      results.new++

      // Score with Claude AI (rate-limit conscious — 1 per second)
      try {
        await new Promise(r => setTimeout(r, 1000))
        const classification = await classifyEvent(event.headline, event.summary ?? undefined)

        await supabase
          .from('events')
          .update({
            event_type: classification.event_type,
            sectors: classification.sectors,
            sentiment_score: classification.sentiment_score,
            impact_level: classification.impact_level,
            tickers: classification.tickers,
            ai_summary: classification.ai_summary,
            ai_processed: true,
          })
          .eq('id', event.id)

        results.scored++
      } catch (aiErr) {
        console.error(`AI classification failed for event ${event.id}:`, aiErr)
        results.errors++
      }
    }
  } catch (err) {
    console.error('Ingest cron error:', err)
    return NextResponse.json({ error: 'Ingest failed', details: String(err) }, { status: 500 })
  }

  return NextResponse.json({ success: true, ...results, timestamp: new Date().toISOString() })
}
