// app/api/cron/ingest/route.ts
// Vercel Cron — runs 08:00 UTC daily  (vercel.json: "0 8 * * *")
// 1. Fetch articles from NewsAPI across 5 financial topic queries
// 2. Deduplicate by URL against existing DB records
// 3. Insert raw event rows (ai_processed: false)
// 4. Classify each with Claude — 1 s delay between calls
// 5. Update rows with classification results
//
// Test locally:
//   curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/ingest

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { classifyEvent } from "@/lib/ai";

export const runtime    = "nodejs";
export const maxDuration = 300; // 5 min — requires Vercel Pro

const QUERIES = [
  "Federal Reserve interest rates inflation CPI",
  "S&P 500 earnings revenue stock market rally selloff",
  "GDP unemployment jobs report economic data",
  "oil gold commodities futures prices OPEC",
  "semiconductor AI chips technology stocks investment",
];

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createServiceClient();
  const stats = { fetched: 0, new: 0, classified: 0, errors: 0 };
  //const fromDate = "2026-02-28"
  const fromDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().replace("Z", "");

  // ── 1. Fetch ──────────────────────────────────────────────────────────────
  const allArticles: Array<{
    title: string; description?: string; url: string;
    publishedAt: string; source: { name: string };
  }> = [];

  for (const q of QUERIES) {
    try {
      const res = await fetch(
        `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&from=${fromDate}&sortBy=publishedAt&pageSize=20&language=en&apiKey=${process.env.NEWSAPI_KEY}`
      );
      if (!res.ok) continue;
      const data = await res.json();
      allArticles.push(...(data.articles ?? []));
    } catch { stats.errors++; }
  }
  stats.fetched = allArticles.length;

  // ── 2. Deduplicate locally ────────────────────────────────────────────────
  const seen = new Set<string>();
  const unique = allArticles.filter(a => {
    if (!a.url || !a.title || seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  });

  // ── 3. Remove URLs already in DB ─────────────────────────────────────────
  const urls = unique.map(a => a.url);
  const { data: existing } = await db
    .from("events")
    .select("source_url")
    .in("source_url", urls);

  const existingSet = new Set((existing ?? []).map(e => e.source_url));
  const fresh = unique.filter(a => !existingSet.has(a.url));
  stats.new = fresh.length;

  // ── 4 & 5. Insert + classify ──────────────────────────────────────────────
  for (const article of fresh) {
    try {
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
        .single();

        if (insertError) {
          console.error("[insert error]", insertError.message, insertError.details);
          stats.errors++;
          continue;
        }

      if (!row) continue;

      // 1 s spacing to stay well inside Anthropic rate limits
      await new Promise(r => setTimeout(r, 1000));
      const c = await classifyEvent(article.title, article.description);

      // Skip events Claude determined are not market-relevant
      if (c.impact_level === 'ignore') {
        await db.from("events").delete().eq("id", row.id);
        continue;
      }

      await db.from("events").update({
        event_type:      c.event_type,
        sectors:         c.sectors,
        sentiment_score: c.sentiment_score,
        impact_level:    c.impact_level,
        tickers:         c.tickers,
        ai_summary:      c.ai_summary,
        ai_processed:    true,
      }).eq("id", row.id);

      stats.classified++;
    } catch { stats.errors++; }
  }

  console.log("[cron/ingest]", stats);
  return NextResponse.json({ ok: true, ...stats });
}
