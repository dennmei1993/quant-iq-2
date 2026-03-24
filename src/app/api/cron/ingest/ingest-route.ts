// src/app/api/cron/ingest/route.ts
// Vercel Cron — runs 4x daily (see vercel.json)
// Sources: 10 RSS feeds with per-feed fallback URLs
// Fallback: GNews API if RSS yield < 10 articles
// Pipeline: fetch → deduplicate → insert → Claude classify → ignore filter
//
// Test locally (PowerShell):
//   Invoke-WebRequest -Uri "http://localhost:3000/api/cron/ingest" `
//     -Headers @{Authorization="Bearer $env:CRON_SECRET"} `
//     -Method GET -UseBasicParsing | Select-Object -Expand Content

import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase"
import { classifyEvent } from "@/lib/ai"
import Parser from "rss-parser"

export const runtime     = "nodejs"
export const maxDuration = 300

// ── Types ─────────────────────────────────────────────────────────────────────

type Article = {
  title:       string
  description: string
  url:         string
  publishedAt: string
  sourceName:  string
}

// ── RSS feeds ─────────────────────────────────────────────────────────────────
// Multiple URLs per feed are tried in order — first success wins.

const RSS_FEEDS: Array<{ name: string; urls: string[] }> = [
  {
    name: "Reuters Business",
    urls: [
      "https://feeds.reuters.com/reuters/businessNews",
      "https://www.reutersagency.com/feed/?best-topics=business-finance&post_type=best",
    ],
  },
  {
    name: "Reuters Markets",
    urls: ["https://feeds.reuters.com/reuters/companyNews"],
  },
  {
    name: "MarketWatch",
    urls: [
      "https://feeds.marketwatch.com/marketwatch/topstories",
      "https://feeds.marketwatch.com/marketwatch/marketpulse",
    ],
  },
  {
    name: "Bloomberg",
    urls: [
      "https://feeds.bloomberg.com/markets/news.rss",
      "https://feeds.bloomberg.com/technology/news.rss",
    ],
  },
  {
    name: "CNBC",
    urls: [
      "https://www.cnbc.com/id/100003114/device/rss/rss.html",
      "https://www.cnbc.com/id/10000664/device/rss/rss.html",
    ],
  },
  {
    name: "Federal Reserve",
    urls: ["https://www.federalreserve.gov/feeds/press_all.xml"],
  },
  {
    name: "Financial Times",
    urls: [
      "https://www.ft.com/rss/home",
      "https://www.ft.com/rss/home/uk",
    ],
  },
  {
    name: "Yahoo Finance",
    urls: ["https://finance.yahoo.com/news/rssindex"],
  },
  {
    name: "Investing.com",
    urls: [
      "https://www.investing.com/rss/news.rss",
      "https://www.investing.com/rss/news_301.rss",
    ],
  },
  {
    name: "Seeking Alpha",
    urls: ["https://seekingalpha.com/feed.xml"],
  },
]

const RSS_MIN_THRESHOLD = 10

// GNews fallback — only used when RSS yield is below threshold
// Sign up free at gnews.io and add GNEWS_API_KEY to Vercel env vars
const GNEWS_QUERIES = [
  "Federal Reserve interest rates inflation",
  "stock market S&P 500 earnings",
  "oil gold commodities OPEC",
]

// ── RSS fetcher ────────────────────────────────────────────────────────────────

async function fetchFromRss(
  since: Date,
  feedStats: Record<string, number>
): Promise<Article[]> {
  const parser = new Parser({
    timeout: 10000,
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; QuantIQ/1.0; +https://www.betteroption.com.au)",
      "Accept":     "application/rss+xml, application/xml, text/xml, */*",
    },
  })

  const articles: Article[] = []

  for (const feed of RSS_FEEDS) {
    let succeeded = false

    for (const url of feed.urls) {
      try {
        const result = await parser.parseURL(url)
        let count = 0

        for (const item of result.items ?? []) {
          if (!item.title || !item.link) continue

          const pubDate = item.pubDate   ? new Date(item.pubDate)
                        : item.isoDate  ? new Date(item.isoDate)
                        : new Date()

          if (pubDate < since) continue

          articles.push({
            title:       item.title.trim(),
            description: (item.contentSnippet ?? item.content ?? item.summary ?? "").slice(0, 500),
            url:         item.link,
            publishedAt: pubDate.toISOString(),
            sourceName:  feed.name,
          })
          count++
        }

        feedStats[feed.name] = count
        succeeded = true
        console.log(`[rss] ${feed.name}: ${count} articles`)
        break

      } catch (err) {
        console.warn(`[rss] ${feed.name} failed (${url}): ${(err as Error).message}`)
      }
    }

    if (!succeeded) {
      feedStats[feed.name] = 0
      console.warn(`[rss] ${feed.name}: all URLs failed — skipped`)
    }
  }

  return articles
}

// ── GNews fallback ─────────────────────────────────────────────────────────────

async function fetchFromGNews(since: Date): Promise<Article[]> {
  const key = process.env.GNEWS_API_KEY
  if (!key) {
    console.warn("[gnews] GNEWS_API_KEY not set — skipping fallback")
    return []
  }

  const articles: Article[] = []
  const fromDate = since.toISOString().split("T")[0]

  for (const q of GNEWS_QUERIES) {
    try {
      const res = await fetch(
        `https://gnews.io/api/v4/search?q=${encodeURIComponent(q)}&lang=en&max=10&from=${fromDate}&apikey=${key}`,
        { signal: AbortSignal.timeout(10000) }
      )
      if (!res.ok) { console.warn(`[gnews] HTTP ${res.status} for: ${q}`); continue }

      const data = await res.json()
      for (const item of data.articles ?? []) {
        if (!item.title || !item.url) continue
        articles.push({
          title:       item.title,
          description: item.description ?? "",
          url:         item.url,
          publishedAt: item.publishedAt ?? new Date().toISOString(),
          sourceName:  item.source?.name ?? "GNews",
        })
      }
      console.log(`[gnews] "${q}": ${data.articles?.length ?? 0} articles`)
    } catch (err) {
      console.warn(`[gnews] failed for "${q}": ${(err as Error).message}`)
    }
  }

  return articles
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const isVercelCron = req.headers.get("x-vercel-cron") === "1"
  const isManualRun  = req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`

  if (!isVercelCron && !isManualRun) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const db    = createServiceClient()
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const stats = {
    fetched: 0, new: 0, classified: 0,
    ignored: 0, errors: 0,
    source:  "rss",
    feeds:   {} as Record<string, number>,
  }

  // ── 1. Fetch articles ─────────────────────────────────────────────────────
  let articles = await fetchFromRss(since, stats.feeds)

  if (articles.length < RSS_MIN_THRESHOLD) {
    console.warn(`[ingest] RSS yield low (${articles.length}) — trying GNews fallback`)
    const fallback = await fetchFromGNews(since)
    articles = [...articles, ...fallback]
    stats.source = fallback.length > 0 ? "rss+gnews" : "rss"
  }

  stats.fetched = articles.length
  console.log(`[ingest] fetched ${articles.length} total articles`)

  // ── 2. Deduplicate locally (strip query params for better matching) ────────
  const seen   = new Set<string>()
  const unique = articles.filter(a => {
    const key = a.url.split("?")[0]
    if (!a.url || !a.title || seen.has(key)) return false
    seen.add(key)
    return true
  })

  // ── 3. Remove URLs already in DB (batched to avoid query limits) ──────────
  const allUrls      = unique.map(a => a.url)
  const existingUrls = new Set<string>()

  for (let i = 0; i < allUrls.length; i += 100) {
    const { data } = await db
      .from("events")
      .select("source_url")
      .in("source_url", allUrls.slice(i, i + 100))
    ;(data ?? []).forEach((r: { source_url: string | null }) => {
      if (r.source_url) existingUrls.add(r.source_url)
    })
  }

  const fresh = unique.filter(a => !existingUrls.has(a.url))
  stats.new   = fresh.length
  console.log(`[ingest] ${fresh.length} new articles to process`)

  // ── 4. Insert + classify with Claude ─────────────────────────────────────
  for (const article of fresh) {
    try {
      // Insert unclassified row
      const { data: row, error: insertError } = await db
        .from("events")
        .insert({
          headline:     article.title,
          source:       "newsapi",
          source_url:   article.url,
          published_at: article.publishedAt,
          ai_processed: false,
        })
        .select("id")
        .single()

      if (insertError) {
        if (!insertError.message.includes("duplicate")) {
          console.error("[insert error]", insertError.message)
        }
        stats.errors++
        continue
      }

      if (!row) continue

      // 1s delay between Claude calls to stay inside rate limits
      await new Promise(r => setTimeout(r, 1000))
      const c = await classifyEvent(article.title, article.description)

      // Delete rows Claude flagged as not market-relevant
      if (c.impact_level === "ignore") {
        await db.from("events").delete().eq("id", row.id)
        stats.ignored++
        continue
      }

      // Update with classification results
      await db.from("events").update({
        event_type:      c.event_type,
        sectors:         c.sectors,
        sentiment_score: c.sentiment_score,
        impact_level:    c.impact_level,
        tickers:         c.tickers,
        ai_summary:      c.ai_summary,
        ai_processed:    true,
      }).eq("id", row.id)

      stats.classified++

    } catch (err) {
      console.error("[classify error]", (err as Error).message)
      stats.errors++
    }
  }

  console.log("[cron/ingest]", stats)
  return NextResponse.json({ ok: true, ...stats })
}
