/**
 * src/app/api/cron/ingest/route.ts — RSS edition (with timing logs)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchAllFeeds } from '@/lib/rss-parser'
import { activeSources } from '@/lib/rss-sources'
import { classifyEvent } from '@/lib/ai'
import { generateAlertsForAllUsers } from '@/lib/alerts'
import { generateWatchlistAlerts } from '@/lib/watchlist-alerts'
import { cronLog } from '@/lib/cron-logger'

export const runtime     = 'nodejs'
export const maxDuration = 300

function isAuthorised(req: NextRequest): boolean {
  const auth   = req.headers.get('authorization') ?? ''
  const secret = process.env.CRON_SECRET ?? ''
  return secret.length > 0 && auth === `Bearer ${secret}`
}

function elapsed(start: number): string {
  return `${((Date.now() - start) / 1000).toFixed(1)}s`
}

export async function GET(req: NextRequest) {
  if (!isAuthorised(req)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  // ── Start log entry ─────────────────────────────────────────────────────────
  const log_handle = await cronLog.start('ingest', 'intelligence', req as unknown as Request)

  const T0       = Date.now()
  const supabase = createServiceClient()
  const log:    string[] = []
  const errors: string[] = []

  // Counters — tracked throughout so meta is always accurate even on early exit
  let articlesFound  = 0
  let newArticles    = 0
  let classified     = 0
  let insertFailed   = 0
  let backlogDone    = 0
  let alertsCreated  = 0
  let watchlistAlerts = 0

  try {
    // ── Step 1: Fetch RSS feeds ─────────────────────────────────────────────
    log.push(`[${elapsed(T0)}] Fetching ${activeSources.length} RSS feeds...`)
    const articles = await fetchAllFeeds(activeSources)
    articlesFound = articles.length
    log.push(`[${elapsed(T0)}] Fetched ${articles.length} articles`)

    // ── Step 2: Deduplicate against DB ──────────────────────────────────────
    log.push(`[${elapsed(T0)}] Deduplicating...`)
    const incomingUrls = articles.map(a => a.url)
    const { data: existingRows } = await supabase
      .from('events')
      .select('source_url')
      .in('source_url', incomingUrls)
      .not('source_url', 'is', null) as { data: { source_url: string }[] | null }

    const existingUrls = new Set((existingRows ?? []).map(r => r.source_url))
    const fresh        = articles.filter(a => !existingUrls.has(a.url))
    log.push(`[${elapsed(T0)}] ${fresh.length} new after URL dedup`)

    // ── Step 2b: Fuzzy dedup ────────────────────────────────────────────────
    const dedupedArticles = fuzzyDeduplicateHeadlines(fresh, 0.85)
    newArticles = dedupedArticles.length
    log.push(`[${elapsed(T0)}] ${dedupedArticles.length} after fuzzy dedup`)

    // Skip classify if nothing new — still check backlog and alerts
    if (dedupedArticles.length === 0) {
      log.push(`[${elapsed(T0)}] No new articles — skipping classify step`)
    }

    // ── Step 3 & 4: Insert + classify ───────────────────────────────────────
    const MAX_PER_RUN = 20
    const toInsert    = dedupedArticles.slice(0, MAX_PER_RUN)

    if (toInsert.length > 0) {
      log.push(`[${elapsed(T0)}] Starting insert+classify for ${toInsert.length} articles`)

      for (const article of toInsert) {
        const t = Date.now()
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
          log.push(`[${elapsed(T0)}] Classified event ${classified} (took ${elapsed(t)})`)
        } catch (aiErr) {
          errors.push(`Claude failed for event ${inserted.id}: ${String(aiErr)}`)
        }
      }

      log.push(`[${elapsed(T0)}] Done insert+classify: ${classified} classified, ${insertFailed} failed`)
    }

    // ── Step 5: Backlog ──────────────────────────────────────────────────────
    log.push(`[${elapsed(T0)}] Checking backlog...`)
    try {
      const { data: backlog } = await supabase
        .from('events')
        .select('id, headline, ai_summary')
        .eq('ai_processed', false)
        .order('created_at', { ascending: true })
        .limit(5) as { data: { id: string; headline: string; ai_summary: string | null }[] | null }

      if (backlog?.length) {
        log.push(`[${elapsed(T0)}] Processing ${backlog.length} backlog events`)
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
            backlogDone++
          } catch (err) {
            errors.push(`Backlog failed for ${event.id}: ${String(err)}`)
          }
        }
        log.push(`[${elapsed(T0)}] Backlog: ${backlogDone} classified`)
      } else {
        log.push(`[${elapsed(T0)}] No backlog`)
      }
    } catch (err) {
      errors.push(`Backlog fetch failed: ${String(err)}`)
    }

    // ── Step 6: Alerts ───────────────────────────────────────────────────────
    log.push(`[${elapsed(T0)}] Generating alerts...`)
    try {
      alertsCreated   = await generateAlertsForAllUsers(supabase)
      watchlistAlerts = await generateWatchlistAlerts(supabase)
      log.push(`[${elapsed(T0)}] Created ${alertsCreated} alerts, ${watchlistAlerts} watchlist alerts`)
    } catch (err) {
      errors.push(`Alert generation failed: ${String(err)}`)
    }

    const totalElapsed = elapsed(T0)
    log.push(`[${totalElapsed}] DONE — total elapsed: ${totalElapsed}`)

    // ── Finalise log ──────────────────────────────────────────────────────────
    const ok = errors.length === 0

    if (!ok) {
      await log_handle.fail(
        new Error(`${errors.length} error(s): ${errors.slice(0, 3).join('; ')}`),
        {
          records_in:  articlesFound,
          records_out: classified + backlogDone,
          meta: {
            articles_found:   articlesFound,
            articles_new:     newArticles,
            classified,
            insert_failed:    insertFailed,
            backlog_done:     backlogDone,
            alerts_created:   alertsCreated,
            watchlist_alerts: watchlistAlerts,
            error_count:      errors.length,
            errors,
            elapsed_s:        totalElapsed,
          },
        }
      )
    } else {
      await log_handle.success({
        records_in:  articlesFound,
        records_out: classified + backlogDone,
        meta: {
          articles_found:   articlesFound,
          articles_new:     newArticles,
          classified,
          insert_failed:    insertFailed,
          backlog_done:     backlogDone,
          alerts_created:   alertsCreated,
          watchlist_alerts: watchlistAlerts,
          sources:          activeSources.length,
          elapsed_s:        totalElapsed,
        },
      })
    }

    return NextResponse.json({
      status: ok ? 'ok' : 'partial',
      log,
      errors,
      ts: new Date().toISOString(),
    })

  } catch (err: any) {
    // Unexpected outer failure (RSS fetch crash, DB connection lost, etc.)
    const totalElapsed = elapsed(T0)
    console.error('[cron/ingest] fatal:', err)

    await log_handle.fail(err, {
      records_in:  articlesFound,
      records_out: classified + backlogDone,
      meta: {
        error_stage:    'outer',
        articles_found: articlesFound,
        classified,
        elapsed_s:      totalElapsed,
        log,
      },
    })

    return NextResponse.json(
      { status: 'error', error: err.message ?? String(err), log },
      { status: 500 }
    )
  }
}

// ─── Fuzzy dedup ──────────────────────────────────────────────────────────────

function fuzzyDeduplicateHeadlines<T extends { headline: string; publishedAt: string }>(
  articles: T[], threshold: number
): T[] {
  const sorted = [...articles].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  )
  const accepted:     T[]      = []
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
