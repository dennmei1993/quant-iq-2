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
import { generateWatchlistAlerts } from '@/lib/watchlist-alerts'

export const runtime     = 'nodejs'
export const maxDuration = 300  // 5 minutes — requires Vercel Pro or cron function

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
  log.push(`${newArticles.length} new articles after URL deduplication (${articles.length - newArticles.length} already stored)`)

  // ── Step 2b: Fuzzy headline deduplication (cross-feed) ───────────────────
  // Multiple feeds carry the same wire story with near-identical headlines.
  // Cluster by 85% Levenshtein similarity, keep newest per cluster.
  const dedupedArticles = fuzzyDeduplicateHeadlines(newArticles, 0.85)
  const fuzzyRemoved = newArticles.length - dedupedArticles.length
  if (fuzzyRemoved > 0) {
    log.push(`Removed ${fuzzyRemoved} cross-feed duplicates (fuzzy match)`)
  }

  // ── Step 3 & 4: Insert + classify ────────────────────────────────────────
  // Cap at 20 new articles per run to stay within timeout budget.
  // Remaining articles will be picked up on subsequent cron runs.
  // Also pick up any previously inserted but unclassified articles (backlog).
  const MAX_PER_RUN = 20

  // First process new articles from this fetch
  const toInsert = dedupedArticles.slice(0, MAX_PER_RUN)

  // ── Step 3 & 4: Insert + classify ────────────────────────────────────────

  let classified = 0
  let insertFailed = 0

  for (const article of toInsert) {
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
  // Picks up ai_processed=false rows from prior runs that hit timeout.
  // Runs after new inserts so fresh articles are prioritised.
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

/**
 * Remove near-duplicate headlines across feeds.
 * Uses normalised Levenshtein similarity — no external dependencies.
 *
 * Algorithm:
 *  1. Normalise each headline (lowercase, strip punctuation, collapse whitespace)
 *  2. Compare each article against all already-accepted articles
 *  3. If similarity >= threshold, discard the older one (keep newest)
 *  4. O(n²) but n is small (~150 articles/run) so negligible cost
 *
 * @param articles  Articles already URL-deduplicated
 * @param threshold 0.0–1.0, recommended 0.85
 */
function fuzzyDeduplicateHeadlines<T extends { headline: string; publishedAt: string }>(
  articles: T[],
  threshold: number
): T[] {
  // Sort newest first so when we drop a duplicate we keep the newer one
  const sorted = [...articles].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  )

  const accepted: T[] = []
  const acceptedNorm: string[] = []

  for (const article of sorted) {
    const norm = normaliseHeadline(article.headline)

    const isDupe = acceptedNorm.some(
      existing => levenshteinSimilarity(norm, existing) >= threshold
    )

    if (!isDupe) {
      accepted.push(article)
      acceptedNorm.push(norm)
    }
  }

  return accepted
}

/** Lowercase, strip punctuation, collapse whitespace */
function normaliseHeadline(h: string): string {
  return h
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Levenshtein similarity: 1.0 = identical, 0.0 = completely different.
 * Optimised with early exit when similarity can't reach threshold.
 */
function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1.0
  if (!a.length || !b.length) return 0.0

  // Early exit: if length difference alone makes similarity impossible
  const maxLen = Math.max(a.length, b.length)
  const minLen = Math.min(a.length, b.length)
  if (minLen / maxLen < 0.6) return 0.0  // fast reject very different lengths

  const dist = levenshteinDistance(a, b)
  return 1 - dist / maxLen
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length

  // Use two rows instead of full matrix to save memory
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  let curr = new Array(n + 1).fill(0)

  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(
        curr[j - 1] + 1,       // insertion
        prev[j] + 1,           // deletion
        prev[j - 1] + cost     // substitution
      )
    }
    ;[prev, curr] = [curr, prev]
  }

  return prev[n]
}
