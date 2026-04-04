// src/app/api/cron/market-intelligence/route.ts
//
// Refreshes the market_intelligence table — one row per aspect.
// All 5 aspects run in PARALLEL via Promise.allSettled.
// DB-only aspects (sector_momentum, recent_events) have no LLM calls.
// Web-search aspects use a single combined LLM call (not two separate ones).
// Schedule: 0 11 * * * (after ingest→macro→themes pipeline completes)

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const anthropic = new Anthropic();

function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface AspectRow {
  aspect:    string;
  summary:   string;
  data:      Record<string, any>;
  score:     number;
  sentiment: "bullish" | "bearish" | "neutral";
  sources:   string[];
  cron_name: string;
}

// ─── Single combined LLM call with web search ─────────────────────────────────
// Replaces two separate calls (search + extraction) with one.

async function searchAndExtract(query: string, extractPrompt: string, max_tokens = 800): Promise<{ raw: string; data: any }> {
  try {
    // Step 1: web search
    const searchMsg = await anthropic.messages.create({
      model:      "claude-sonnet-4-20250514",
      max_tokens: 1000,
      tools:      [{ type: "web_search_20250305", name: "web_search" } as any],
      messages:   [{ role: "user", content: query }],
    });
    const raw = searchMsg.content
      .filter((b: any) => b.type === "text")
      .map((b: any)   => b.text)
      .join("\n")
      .slice(0, 2000);

    // Step 2: extract structured data
    const extractMsg = await anthropic.messages.create({
      model:      "claude-sonnet-4-20250514",
      max_tokens,
      messages:   [{ role: "user", content: `${extractPrompt}\n\nSOURCE TEXT:\n${raw}` }],
    });
    const text  = extractMsg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    const clean = text.replace(/```json|```/g, "").trim();
    return { raw, data: JSON.parse(clean) };
  } catch (e) {
    console.error("searchAndExtract error:", e);
    return { raw: "", data: {} };
  }
}

// ─── Aspect: macro_indicators ─────────────────────────────────────────────────

async function buildMacroIndicators(): Promise<AspectRow> {
  const { raw, data } = await searchAndExtract(
    "Current US macro data: CPI inflation, GDP growth rate, unemployment rate, Fed funds rate, 10-year Treasury yield. Latest numbers only.",
    `Extract these US macro indicators and return ONLY valid JSON:
{
  "cpi_yoy": "X.X% (Mon Year)",
  "gdp_growth": "X.X% (QX 20XX)",
  "unemployment": "X.X% (Mon Year)",
  "fed_rate": "X.XX%-X.XX%",
  "yield_10y": "X.XX%",
  "fed_stance": "hawkish|neutral|dovish",
  "summary": "2 sentence narrative on macro environment and implication for US equities"
}
Use null for unavailable values.`,
    600
  );

  const score = data.fed_stance === "dovish" ? 3 : data.fed_stance === "hawkish" ? -3 : 0;
  return {
    aspect:    "macro_indicators",
    summary:   data.summary ?? raw.slice(0, 300),
    data,
    score,
    sentiment: score >= 2 ? "bullish" : score <= -2 ? "bearish" : "neutral",
    sources:   ["web_search"],
    cron_name: "market-intelligence",
  };
}

// ─── Aspect: geopolitical ─────────────────────────────────────────────────────

async function buildGeopolitical(supabase: any): Promise<AspectRow> {
  // Pull recent geopolitical events from DB first
  const { data: events } = await supabase
    .from("events")
    .select("headline, ai_summary, event_type, impact_score, sectors, published_at")
    .eq("ai_processed", true)
    .in("event_type", ["geopolitical", "policy", "trade", "conflict", "sanction"])
    .order("impact_score", { ascending: false })
    .limit(10);

  const dbContext = (events ?? []).slice(0, 8).map((e: any) => {
    const date = new Date(e.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `[${date}] ${e.headline}`;
  }).join("\n");

  const { raw, data } = await searchAndExtract(
    "Current geopolitical risks for US stock markets: Iran conflict, Middle East tensions, US-China trade tariffs, Russia-Ukraine. Which sectors are most affected?",
    `Synthesise geopolitical risks for US equity investors. Known events from our DB:
${dbContext}

Return ONLY valid JSON:
{
  "summary": "3 sentence narrative on active geopolitical risks and their market impact by sector",
  "active_risks": ["Iran conflict", "US-China tariffs"],
  "exposed_sectors": { "risk": ["Energy"], "opportunity": ["Defense"] },
  "risk_level": "elevated|moderate|contained",
  "score": -4
}
score: -10 (extreme risk) to +10 (benign).`,
    500
  );

  const score = typeof data.score === "number" ? Math.max(-10, Math.min(10, data.score)) : -2;
  return {
    aspect:    "geopolitical",
    summary:   data.summary ?? raw.slice(0, 300),
    data,
    score,
    sentiment: score >= 0 ? "neutral" : "bearish",
    sources:   ["events_table", "web_search"],
    cron_name: "market-intelligence",
  };
}

// ─── Aspect: sector_momentum — pure DB, no LLM ───────────────────────────────

async function buildSectorMomentum(supabase: any): Promise<AspectRow> {
  const { data: signals } = await supabase
    .from("asset_signals")
    .select("ticker, signal, fundamental_score, technical_score, assets!inner(sector, asset_type)")
    .in("signal", ["buy", "watch", "hold", "avoid"])
    .eq("assets.asset_type", "stock")
    .not("assets.sector", "is", null);

  const sectorMap: Record<string, { buy: number; avoid: number; f: number; t: number; n: number }> = {};
  for (const s of (signals ?? [])) {
    const sector = (s as any).assets?.sector ?? "Unknown";
    if (!sectorMap[sector]) sectorMap[sector] = { buy: 0, avoid: 0, f: 0, t: 0, n: 0 };
    const r = sectorMap[sector];
    if (s.signal === "buy")   r.buy++;
    if (s.signal === "avoid") r.avoid++;
    r.f += s.fundamental_score ?? 0;
    r.t += s.technical_score   ?? 0;
    r.n++;
  }

  const ranked = Object.entries(sectorMap)
    .map(([sector, s]) => ({
      sector,
      buy_pct:   Math.round(s.buy   / s.n * 100),
      avoid_pct: Math.round(s.avoid / s.n * 100),
      f_avg:     Math.round(s.f / s.n),
      t_avg:     Math.round(s.t / s.n),
      count:     s.n,
    }))
    .sort((a, b) => b.buy_pct - a.buy_pct);

  const leading = ranked.slice(0, 3).map(s => s.sector);
  const lagging = ranked.slice(-3).map(s => s.sector);
  const overall = ranked.reduce((acc, r) => acc + (r.buy_pct - r.avoid_pct), 0) / Math.max(ranked.length, 1);

  return {
    aspect:    "sector_momentum",
    summary:   `Leading sectors: ${leading.join(", ")}. Lagging: ${lagging.join(", ")}. Based on ${signals?.length ?? 0} signal records.`,
    data:      { sectors: ranked, leading, lagging },
    score:     Math.max(-10, Math.min(10, Math.round(overall / 10))),
    sentiment: overall > 5 ? "bullish" : overall < -5 ? "bearish" : "neutral",
    sources:   ["asset_signals"],
    cron_name: "market-intelligence",
  };
}

// ─── Aspect: market_sentiment ─────────────────────────────────────────────────

async function buildMarketSentiment(): Promise<AspectRow> {
  const { raw, data } = await searchAndExtract(
    "US stock market sentiment now: S&P 500 trend, VIX level, risk-on or risk-off, earnings outlook.",
    `Summarise US market sentiment. Return ONLY valid JSON:
{
  "summary": "2 sentence narrative on current market sentiment",
  "market_trend": "bullish|bearish|sideways",
  "risk_appetite": "risk-on|risk-off|mixed",
  "vix_level": "low|moderate|elevated|extreme",
  "key_risks": ["risk1", "risk2"],
  "score": 2
}
score -10 to +10.`,
    400
  );

  const score = typeof data.score === "number" ? Math.max(-10, Math.min(10, data.score)) : 0;
  return {
    aspect:    "market_sentiment",
    summary:   data.summary ?? raw.slice(0, 300),
    data,
    score,
    sentiment: score >= 3 ? "bullish" : score <= -3 ? "bearish" : "neutral",
    sources:   ["web_search"],
    cron_name: "market-intelligence",
  };
}

// ─── Aspect: recent_events — pure DB, no LLM ─────────────────────────────────

async function buildRecentEvents(supabase: any): Promise<AspectRow> {
  const { data: events } = await supabase
    .from("events")
    .select("headline, ai_summary, event_type, impact_score, sentiment_score, sectors, published_at")
    .eq("ai_processed", true)
    .order("impact_score", { ascending: false })
    .order("published_at",  { ascending: false })
    .limit(25);

  const rows = events ?? [];
  const avgSentiment = rows.length
    ? rows.reduce((s: number, e: any) => s + (e.sentiment_score ?? 0), 0) / rows.length
    : 0;

  const byType: Record<string, any[]> = {};
  for (const e of rows) {
    const t = e.event_type ?? "general";
    if (!byType[t]) byType[t] = [];
    byType[t].push(e);
  }

  const topEventsText = rows.slice(0, 10).map((e: any) => {
    const date = new Date(e.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `[${date}] [${e.event_type ?? "general"}] impact:${(e.impact_score ?? 0).toFixed(1)} — ${e.headline}${e.ai_summary ? `\n  → ${e.ai_summary}` : ""}`;
  }).join("\n\n");

  return {
    aspect:    "recent_events",
    summary:   `${rows.length} events tracked. Avg sentiment: ${avgSentiment.toFixed(1)}. Types: ${Object.keys(byType).join(", ")}.`,
    data:      { by_type: byType, top_events_text: topEventsText, total: rows.length, avg_sentiment: avgSentiment },
    score:     Math.max(-10, Math.min(10, Math.round(avgSentiment * 3))),
    sentiment: avgSentiment > 1 ? "bullish" : avgSentiment < -1 ? "bearish" : "neutral",
    sources:   ["events_table"],
    cron_name: "market-intelligence",
  };
}

// ─── GET / POST handler ───────────────────────────────────────────────────────

export async function GET(req: NextRequest) { return handler(req); }
export async function POST(req: NextRequest) { return handler(req); }

async function handler(req: NextRequest) {
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";
  const validSecret  = process.env.CRON_SECRET
    ? req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`
    : false;

  if (!isVercelCron && !validSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const started  = Date.now();

  // ── Run all aspects in parallel ───────────────────────────────────────────
  const aspects = [
    { name: "macro_indicators", fn: () => buildMacroIndicators()          },
    { name: "geopolitical",     fn: () => buildGeopolitical(supabase)     },
    { name: "sector_momentum",  fn: () => buildSectorMomentum(supabase)   },
    { name: "market_sentiment", fn: () => buildMarketSentiment()          },
    { name: "recent_events",    fn: () => buildRecentEvents(supabase)     },
  ];

  const settled = await Promise.allSettled(aspects.map(a => a.fn()));

  const results: string[] = [];
  const errors:  string[] = [];

  // Upsert results — also in parallel
  await Promise.allSettled(
    settled.map(async (result, i) => {
      const { name } = aspects[i];
      if (result.status === "rejected") {
        errors.push(`${name}: ${result.reason?.message ?? "failed"}`);
        console.error(`[market-intelligence] ${name} failed:`, result.reason);
        return;
      }
      const row = result.value;
      const { error } = await supabase
        .from("market_intelligence")
        .upsert({ ...row, refreshed_at: new Date().toISOString() }, { onConflict: "aspect" });
      if (error) {
        errors.push(`${name} upsert: ${error.message}`);
      } else {
        results.push(`${name}: ok`);
      }
    })
  );

  const elapsed = Math.round((Date.now() - started) / 1000);
  console.log(`[market-intelligence] done in ${elapsed}s — ${results.length} ok, ${errors.length} errors`);

  return NextResponse.json({
    ok:          errors.length === 0,
    results,
    errors,
    elapsed_s:   elapsed,
    refreshed_at: new Date().toISOString(),
  });
}
