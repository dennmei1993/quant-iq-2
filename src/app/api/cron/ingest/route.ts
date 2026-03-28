/**
 * src/app/api/cron/ingest/route.ts — RSS edition
 *
 * Flow:
 *  1. Fetch all enabled RSS feeds concurrently
 *  2. Deduplicate against events already in the DB (by url)
 *  3. Insert new raw events
 *  4. Classify each with Claude (1-second delay between calls)
 *  5. Generate alerts for users with holdings
 *
 * NOTE: Polygon price sync moved to /api/cron/financials to avoid timeout.
 *
 * Auth: CRON_SECRET bearer token
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchAllFeeds } from '@/lib/rss-parser'
import { activeSources } from '@/lib/rss-sources'
import { classifyEvent } from '@/lib/ai'
import { generateAlertsForAllUsers } from '@/lib/alerts'
import { generateWatchlistAlerts } from '@/lib/watchlist-alerts'

export const runtime     = 'nodejs'
export const maxDuration = 300

function isAuthorised(req: NextRequest): boolean {
  const auth   = req.headers.get('authorization') ?? ''
  const secret = process.env.CRON_SECRET ?? ''
  return secret.length > 0 && auth === `Bearer ${secret}`
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

  const incomingUrls = articles.map(a => a.url)
  const { data: existingRows } = await supabase
    .from('events')
    .select('source_url')
    .in('source_url', incomingUrls)
    .not('source_url', 'is', null) as { data: { source_url: string }[] | null }

  const existingUrls  = new Set((existingRows ?? []).map(r => r.source_url))
  const newArticles   = articles.filter(a => !existingUrls.has(a.url))
  log.push(`${newArticles.length} new articles after URL deduplication (${articles.length - newArticles.length} already stored)`)

  // ── Step 2b: Fuzzy headline deduplication ────────────────────────────────

  const dedupedArticles = fuzzyDeduplicateHeadlines(newArticles, 0.85)
  const fuzzyRemoved    = newArticles.length - dedupedArticles.length
  if (fuzzyRemoved > 0) log.push(`Removed ${fuzzyRemoved} cross-feed duplicates (fuzzy match)`)

  // ── Step 3 & 4: Insert + classify ────────────────────────────────────────

  const MAX_PER_RUN = 20
  const toInsert    = dedupedArticles.slice(0, MAX_PER_RUN)
  let classified    = 0
  let insertFailed  = 0

  for (const article of toInsert) {
    const insertResult = await (supabase.from('events') as any)
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
    if (insertErr || !inserted) { insertFailed++; continue }

    await new Promise(r => setTimeout(r, 1000))

    try {
      const classification = await classifyEvent(article.headline, article.summary)
      await (supabase.from('events') as any)
        .update({
          event_type:      classification.event_type,
          sectors:         classification.sectors,
          sentiment_score: classification.sentiment_score,
          impact_score:    classification.impact_score,
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

  // ── Backlog: classify previously unprocessed events ───────────────────────

  try {
    const { data: backlog } = await supabase
      .from('events')
      .select('id, headline, ai_summary')
      .eq('ai_processed', false)
      .order('created_at', { ascending: true })
      .limit(MAX_PER_RUN) as { data: { id: string; headline: string; ai_summary: string | null }[] | null }

    if (backlog?.length) {
      log.push(`Processing ${backlog.length} backlog events...`)
      let backlogClassified = 0
      for (const event of backlog) {
        await new Promise(r => setTimeout(r, 1000))
        try {
          const classification = await classifyEvent(event.headline, event.ai_summary)
          await (supabase.from('events') as any)
            .update({
              event_type:      classification.event_type,
              sectors:         classification.sectors,
              sentiment_score: classification.sentiment_score,
              impact_score:    classification.impact_score,
              tickers:         classification.tickers,
              ai_summary:      classification.ai_summary,
              ai_processed:    true,
            })
            .eq('id', event.id)
          backlogClassified++
        } catch (err) {
          errors.push(`Backlog classification failed for ${event.id}: ${String(err)}`)
        }
      }
      log.push(`Backlog: ${backlogClassified} / ${backlog.length} classified`)
    }
  } catch (err) {
    errors.push(`Backlog fetch failed: ${String(err)}`)
  }

  // ── Step 5: Alert generation ──────────────────────────────────────────────

  log.push('Generating alerts...')
  try {
    const count = await generateAlertsForAllUsers(supabase)
    log.push(`Created ${count} new alerts`)
    const watchlistAlerts = await generateWatchlistAlerts(supabase)
    log.push(`Created ${watchlistAlerts} watchlist theme alerts`)
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

// ─── Fuzzy headline deduplication ────────────────────────────────────────────

function fuzzyDeduplicateHeadlines<T extends { headline: string; publishedAt: string }>(
  articles: T[], threshold: number
): T[] {
  const sorted = [...articles].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  )
  const accepted: T[] = []
  const acceptedNorm: string[] = []
  for (const article of sorted) {
    const norm   = normaliseHeadline(article.headline)
    const isDupe = acceptedNorm.some(e => levenshteinSimilarity(norm, e) >= threshold)
    if (!isDupe) { accepted.push(article); acceptedNorm.push(norm) }
  }
  return accepted
}

function normaliseHeadline(h: string): string {
  return h.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1.0
  if (!a.length || !b.length) return 0.0
  const maxLen = Math.max(a.length, b.length)
  if (Math.min(a.length, b.length) / maxLen < 0.6) return 0.0
  return 1 - levenshteinDistance(a, b) / maxLen
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length, n = b.length
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  let curr = new Array(n + 1).fill(0)
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]
}
