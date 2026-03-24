/**
 * app/api/cron/ingest/route.ts  — RSS edition
 *
 * Replaces the NewsAPI fetch with the RSS parser.
 * Everything downstream (Claude classification, Polygon sync,
 * alert generation) is unchanged.
 *
 * Flow:
 *  1. Fetch all enabled RSS feeds concurrently
 *  2. Deduplicate against events already in the DB (by url)
 *  3. Insert new raw events
 *  4. Classify each with Claude (1-second delay between calls)
 *  5. Sync Polygon prices for all assets
 *  6. Generate alerts for users with holdings
 *
 * Auth: CRON_SECRET bearer token
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchAllFeeds } from '@/lib/rss-parser'
import { activeSources } from '@/lib/rss-sources'
import { classifyEvent } from '@/lib/ai'
import { fetchPricesForTickers, fetchSparklinesForTickers } from '@/lib/polygon'
import { generateAlertsForAllUsers } from '@/lib/alerts'

function isAuthorised(req: NextRequest): boolean {
  const auth   = req.headers.get('authorization') ?? ''
  const secret = process.env.CRON_SECRET ?? ''
  return secret.length > 0 && auth === `Bearer ${secret}`
}

function deriveSignal(pct: number): 'buy' | 'watch' | 'hold' | 'avoid' {
  if (pct >= 2)  return 'buy'
  if (pct >= 0.5) return 'watch'
  if (pct >= -1) return 'hold'
  return 'avoid'
}

function deriveSignalScore(pct: number): number {
  return Math.round(Math.min(100, Math.max(0, 50 + pct * 10)))
}

export async function GET(req: NextRequest) {
  if (!isAuthorised(req)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const log: string[] = []
  const errors: string[] = []

  // ── Step 1: Fetch RSS feeds ───────────────────────────────────────────────

  log.push(`Fetching ${activeSources.length} RSS feeds...`)

  const articles = await fetchAllFeeds(activeSources)
  log.push(`Fetched ${articles.length} articles across all feeds`)

  // ── Step 2: Deduplicate against DB ───────────────────────────────────────
  // Batch-check which URLs are already stored to avoid N+1 queries.
  // We check the most recent 500 event URLs to keep the query fast.

  const incomingUrls = articles.map(a => a.url)

  const { data: existingRows } = await supabase
    .from('events')
    .select('source_url')
    .in('source_url', incomingUrls)
    .not('source_url', 'is', null) as { data: { source_url: string }[] | null }

  const existingUrls = new Set((existingRows ?? []).map(r => r.source_url))

  const newArticles = articles.filter(a => !existingUrls.has(a.url))
  log.push(`${newArticles.length} new articles after deduplication (${articles.length - newArticles.length} already stored)`)

  // ── Step 3 & 4: Insert + classify ────────────────────────────────────────

  let classified = 0
  let insertFailed = 0

  for (const article of newArticles) {
    // Insert raw event
    const insertResult = await (supabase
      .from('events') as any)
      .insert({
        headline:     article.headline,
        source:       'rss',
        source_name:  article.sourceName,
        source_url:   article.url,
        published_at: article.publishedAt,
        ai_processed: false,
      })
      .select('id')
      .single()

    const inserted  = (insertResult as any).data as { id: string } | null
    const insertErr = (insertResult as any).error

    if (insertErr || !inserted) {
      insertFailed++
      continue
    }

    // 1-second delay between Claude calls (rate limit protection)
    await new Promise(r => setTimeout(r, 1000))

    try {
      const classification = await classifyEvent(article.headline, article.summary)

      await (supabase.from('events') as any)
        .update({
          event_type:      classification.event_type,
          sectors:         classification.sectors,
          sentiment_score: classification.sentiment_score,
          impact_level:    classification.impact_level,
          tickers:         classification.tickers,
          ai_summary:      classification.ai_summary,
          ai_processed:    true,
        })
        .eq('id', inserted.id)

      classified++
    } catch (aiErr) {
      errors.push(`Claude failed for event ${inserted.id}: ${String(aiErr)}`)
    }
  }

  log.push(`Classified: ${classified} events, insert failures: ${insertFailed}`)

  // ── Step 5: Polygon price sync ───────────────────────────────────────────

  log.push('Syncing Polygon prices...')

  try {
    const { data: assets } = await supabase
      .from('assets')
      .select('ticker') as { data: { ticker: string }[] | null }

    const tickers = (assets ?? []).map(a => a.ticker)

    if (tickers.length > 0) {
      const prices     = await fetchPricesForTickers(tickers)
      const sparklines = await fetchSparklinesForTickers([...prices.keys()])

      const rows = [...prices.keys()].map(t => {
        const p    = prices.get(t)!
        const bars = sparklines.get(t) ?? []
        return {
          ticker:     t,
          price_usd:  p.price,
          change_pct: p.change_pct,
          signal:     deriveSignal(p.change_pct),
          score:      deriveSignalScore(p.change_pct),
          // sparkline stored as number[] (close prices only) to match real schema
          sparkline:  bars.map(b => b.c),
          updated_at: new Date().toISOString(),
        }
      })

      if (rows.length > 0) {
        await (supabase.from('asset_signals') as any)
          .upsert(rows, { onConflict: 'ticker' })
      }

      log.push(`Polygon: ${prices.size} / ${tickers.length} prices synced`)
    }
  } catch (err) {
    errors.push(`Polygon sync failed: ${String(err)}`)
  }

  // ── Step 6: Alert generation ─────────────────────────────────────────────

  log.push('Generating alerts...')
  try {
    const count = await generateAlertsForAllUsers(supabase)
    log.push(`Created ${count} new alerts`)
  } catch (err) {
    errors.push(`Alert generation failed: ${String(err)}`)
  }

  return NextResponse.json({
    status: errors.length === 0 ? 'ok' : 'partial',
    log,
    errors,
    ts: new Date().toISOString(),
  })
}
