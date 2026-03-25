// src/app/api/cron/ingest/ingest-route.ts  (legacy route — fixes applied)
// Key changes:
//   1. source: "rss" instead of "newsapi" (satisfies constraint)
//   2. events insert/update/delete wrapped with (db.from("events") as any)
//   3. c.impact_score === "ignore" → (c.impact_score ?? 1) < 2  (numeric check)

// ── Insert unclassified row ───────────────────────────────────────────────────
const insertResult = await (db.from("events") as any)
  .insert({
    headline:     article.title,
    source:       "rss",              // ← was "newsapi", must be valid enum value
    source_url:   article.url,
    published_at: article.publishedAt,
    ai_processed: false,
  })
  .select("id")
  .single()

const row         = (insertResult as any).data as { id: string } | null
const insertError = (insertResult as any).error

// ── Drop very low impact events (score 1 = noise) ────────────────────────────
// Was: if (c.impact_level === "ignore")
if ((c.impact_score ?? 1) < 2) {
  await (db.from("events") as any).delete().eq("id", row.id)
  stats.ignored++
  continue
}

// ── Update with classification ────────────────────────────────────────────────
await (db.from("events") as any).update({
  event_type:      c.event_type,
  sectors:         c.sectors,
  sentiment_score: c.sentiment_score,
  impact_score:    c.impact_score,    // ← was impact_level
  tickers:         c.tickers,
  ai_summary:      c.ai_summary,
  ai_processed:    true,
}).eq("id", row.id)
