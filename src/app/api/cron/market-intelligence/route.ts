// src/app/api/cron/market-intelligence/route.ts
//
// Dedicated cron to refresh the market_intelligence table.
// One row per aspect — each aspect is independently updated.
// Schedule: daily after the main ingest cron (e.g. 7am UTC).
//
// Aspects refreshed:
//   macro_indicators  — CPI, GDP, unemployment, Fed rate, yield curve
//   geopolitical      — active conflicts, trade tensions (events table + web search)
//   sector_momentum   — sector rotation signals (asset_signals aggregation)
//   market_sentiment  — VIX proxy, earnings trends, credit conditions
//   recent_events     — summarised top events from events table

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";

const anthropic = new Anthropic();

// ─── Types ────────────────────────────────────────────────────────────────────

interface AspectRow {
  aspect:      string;
  summary:     string;
  data:        Record<string, any>;
  score:       number;
  sentiment:   "bullish" | "bearish" | "neutral";
  sources:     string[];
  cron_name:   string;
}

// ─── Web search helper ────────────────────────────────────────────────────────

async function webSearch(query: string, maxTokens = 1500): Promise<string> {
  try {
    const msg = await anthropic.messages.create({
      model:      "claude-sonnet-4-20250514",
      max_tokens: maxTokens,
      tools: [{ type: "web_search_20250305", name: "web_search" } as any],
      messages: [{ role: "user", content: query }],
    });
    return msg.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .slice(0, 3000);
  } catch {
    return "";
  }
}

// ─── Aspect builders ─────────────────────────────────────────────────────────

async function buildMacroIndicators(supabase: any): Promise<AspectRow> {
  // Fetch latest macro data from web search
  const raw = await webSearch(
    "Latest US macroeconomic data: current CPI inflation rate, latest GDP growth, " +
    "unemployment rate, Federal Reserve interest rate decision, 10-year Treasury yield. " +
    "Provide specific numbers and dates. Focus on most recent releases only."
  );

  // Ask Claude to extract structured data from the search results
  const extractMsg = await anthropic.messages.create({
    model:      "claude-sonnet-4-20250514",
    max_tokens: 800,
    messages: [{
      role:    "user",
      content: `Extract structured macroeconomic data from this text and return ONLY valid JSON:

${raw}

JSON format:
{
  "cpi_yoy": "X.X% (Month Year)",
  "gdp_growth": "X.X% (QX 20XX)",
  "unemployment": "X.X% (Month Year)",
  "fed_rate": "X.XX%-X.XX% (as of date)",
  "yield_10y": "X.XX% (as of date)",
  "fed_next_meeting": "Month Year",
  "fed_stance": "hawkish | neutral | dovish",
  "summary": "2-3 sentence narrative of the macro environment and its implications for US equities"
}
If a value is unavailable, use null.`,
    }],
  });

  let data: Record<string, any> = {};
  try {
    const text  = extractMsg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    data        = JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    data = { raw_summary: raw.slice(0, 500) };
  }

  // Score macro environment: high rates + high inflation = bearish; low + stable = bullish
  const fedStance = (data.fed_stance ?? "neutral").toLowerCase();
  const score     = fedStance === "dovish" ? 3 : fedStance === "hawkish" ? -3 : 0;

  return {
    aspect:    "macro_indicators",
    summary:   data.summary ?? raw.slice(0, 600),
    data,
    score,
    sentiment: score >= 2 ? "bullish" : score <= -2 ? "bearish" : "neutral",
    sources:   ["Federal Reserve", "BLS", "BEA", "US Treasury"],
    cron_name: "market-intelligence",
  };
}

async function buildGeopolitical(supabase: any): Promise<AspectRow> {
  // Get recent high-impact geopolitical events from our DB
  const { data: events } = await supabase
    .from("events")
    .select("headline, ai_summary, event_type, impact_score, sentiment_score, sectors, published_at, source_name")
    .eq("ai_processed", true)
    .in("event_type", ["geopolitical", "policy", "trade", "conflict", "sanction"])
    .order("impact_score", { ascending: false })
    .order("published_at",  { ascending: false })
    .limit(15);

  // Supplement with web search for very recent developments
  const webRaw = await webSearch(
    "Current geopolitical risks affecting US stock markets: " +
    "Middle East conflicts (Iran, Israel, Gaza), Russia-Ukraine war latest, " +
    "US-China trade tensions, tariffs, sanctions. What sectors are most at risk? " +
    "Focus on events from the past 30 days."
  );

  // Summarise into a prompt-ready narrative
  const dbContext = (events ?? []).map((e: any) => {
    const date = new Date(e.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `[${date}] ${e.headline}${e.ai_summary ? ` — ${e.ai_summary}` : ""}`;
  }).join("\n");

  const summaryMsg = await anthropic.messages.create({
    model:      "claude-sonnet-4-20250514",
    max_tokens: 600,
    messages: [{
      role:    "user",
      content: `Synthesise these geopolitical developments into a concise investment-relevant summary.

DB EVENTS:
${dbContext || "None classified"}

WEB SEARCH CONTEXT:
${webRaw}

Write a 3-4 sentence narrative covering:
1. The most market-significant active conflicts or tensions by name
2. Which US market sectors are most exposed (positively or negatively)
3. Overall assessment: is geopolitical risk elevated, moderate, or contained?

Then return a JSON object:
{
  "summary": "your 3-4 sentence narrative",
  "active_risks": ["Iran conflict", "US-China tariffs"],
  "exposed_sectors": { "risk": ["Energy", "Tech"], "opportunity": ["Defense"] },
  "risk_level": "elevated | moderate | contained",
  "score": -5
}
score ranges from -10 (extreme risk) to +10 (very benign).`,
    }],
  });

  let data: Record<string, any> = {};
  try {
    const text = summaryMsg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    data       = JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    data = { risk_level: "moderate" };
  }

  const score = typeof data.score === "number" ? data.score : -2;
  return {
    aspect:    "geopolitical",
    summary:   data.summary ?? webRaw.slice(0, 600),
    data,
    score,
    sentiment: score >= 0 ? "neutral" : score >= -4 ? "bearish" : "bearish",
    sources:   ["events_table", "web_search"],
    cron_name: "market-intelligence",
  };
}

async function buildSectorMomentum(supabase: any): Promise<AspectRow> {
  // Aggregate signals by sector from asset_signals + assets
  const { data: signals } = await supabase
    .from("asset_signals")
    .select("ticker, signal, fundamental_score, technical_score, change_pct, assets!inner(sector, asset_type)")
    .in("signal", ["buy", "watch", "hold", "avoid"])
    .eq("assets.asset_type", "stock")
    .not("assets.sector", "is", null);

  // Group by sector and compute average scores
  const sectorMap: Record<string, { buy: number; watch: number; hold: number; avoid: number; fAvg: number; tAvg: number; count: number }> = {};
  for (const s of (signals ?? [])) {
    const sector = (s as any).assets?.sector ?? "Unknown";
    if (!sectorMap[sector]) sectorMap[sector] = { buy: 0, watch: 0, hold: 0, avoid: 0, fAvg: 0, tAvg: 0, count: 0 };
    const row = sectorMap[sector];
    row[s.signal as "buy" | "watch" | "hold" | "avoid"]++;
    row.fAvg  += s.fundamental_score ?? 0;
    row.tAvg  += s.technical_score   ?? 0;
    row.count++;
  }

  const sectorSummary = Object.entries(sectorMap)
    .map(([sector, stats]) => ({
      sector,
      buy_pct:   Math.round((stats.buy  / stats.count) * 100),
      avoid_pct: Math.round((stats.avoid / stats.count) * 100),
      f_avg:     Math.round(stats.fAvg / stats.count),
      t_avg:     Math.round(stats.tAvg / stats.count),
      count:     stats.count,
      momentum:  stats.buy > stats.avoid ? "positive" : stats.avoid > stats.buy ? "negative" : "neutral",
    }))
    .sort((a, b) => b.buy_pct - a.buy_pct);

  const leading  = sectorSummary.slice(0, 3).map(s => s.sector);
  const lagging  = sectorSummary.slice(-3).map(s => s.sector);

  const summary = `Sector momentum analysis across ${Object.keys(sectorMap).length} sectors. ` +
    `Leading sectors (highest BUY signal concentration): ${leading.join(", ")}. ` +
    `Lagging sectors (highest AVOID signal concentration): ${lagging.join(", ")}. ` +
    `This reflects current fundamental and technical signal distribution in our tracked universe.`;

  const overallScore = sectorSummary.reduce((s, r) => s + (r.buy_pct - r.avoid_pct), 0) / Math.max(sectorSummary.length, 1);

  return {
    aspect:    "sector_momentum",
    summary,
    data:      { sectors: sectorSummary, leading, lagging },
    score:     Math.max(-10, Math.min(10, Math.round(overallScore / 10))),
    sentiment: overallScore > 5 ? "bullish" : overallScore < -5 ? "bearish" : "neutral",
    sources:   ["asset_signals", "assets"],
    cron_name: "market-intelligence",
  };
}

async function buildMarketSentiment(): Promise<AspectRow> {
  const raw = await webSearch(
    "Current US stock market sentiment: VIX volatility index level, " +
    "S&P 500 recent performance and trend, corporate earnings outlook, " +
    "credit spreads, institutional investor positioning. " +
    "Is the market risk-on or risk-off? What are analysts saying about near-term direction?"
  );

  const summaryMsg = await anthropic.messages.create({
    model:      "claude-sonnet-4-20250514",
    max_tokens: 500,
    messages: [{
      role:    "user",
      content: `Summarise US market sentiment from this context into investment-relevant insights.

${raw}

Return ONLY JSON:
{
  "summary": "3 sentence narrative on current market sentiment and what it means for investors",
  "vix_level": "low (<15) | moderate (15-25) | elevated (25-35) | extreme (>35)",
  "market_trend": "bullish | bearish | sideways",
  "risk_appetite": "risk-on | risk-off | mixed",
  "key_risks": ["list of 2-3 near-term risks"],
  "key_tailwinds": ["list of 1-2 near-term tailwinds"],
  "score": 3
}
score -10 to +10.`,
    }],
  });

  let data: Record<string, any> = {};
  try {
    const text = summaryMsg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    data       = JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    data = { market_trend: "sideways", risk_appetite: "mixed" };
  }

  const score = typeof data.score === "number" ? data.score : 0;
  return {
    aspect:    "market_sentiment",
    summary:   data.summary ?? raw.slice(0, 500),
    data,
    score,
    sentiment: score >= 3 ? "bullish" : score <= -3 ? "bearish" : "neutral",
    sources:   ["web_search"],
    cron_name: "market-intelligence",
  };
}

async function buildRecentEvents(supabase: any): Promise<AspectRow> {
  const { data: events } = await supabase
    .from("events")
    .select("headline, ai_summary, event_type, impact_score, sentiment_score, sectors, tickers, published_at, source_name")
    .eq("ai_processed", true)
    .order("impact_score", { ascending: false })
    .order("published_at",  { ascending: false })
    .limit(30);

  const rows = events ?? [];
  const avgSentiment = rows.length > 0
    ? rows.reduce((s: number, e: any) => s + (e.sentiment_score ?? 0), 0) / rows.length
    : 0;

  // Group by event_type for structured data
  const byType: Record<string, any[]> = {};
  for (const e of rows) {
    const t = e.event_type ?? "general";
    if (!byType[t]) byType[t] = [];
    byType[t].push({
      date:      new Date(e.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      headline:  e.headline,
      summary:   e.ai_summary,
      impact:    e.impact_score,
      sectors:   e.sectors,
      sentiment: e.sentiment_score,
    });
  }

  const topEvents = rows.slice(0, 10).map((e: any) => {
    const date = new Date(e.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `[${date}] [${e.event_type ?? "general"}] impact:${(e.impact_score ?? 0).toFixed(1)} — ${e.headline}${e.ai_summary ? `\n  → ${e.ai_summary}` : ""}`;
  }).join("\n\n");

  const summary = `${rows.length} recent high-impact events tracked across ${Object.keys(byType).length} categories. ` +
    `Average sentiment score: ${avgSentiment.toFixed(1)} ` +
    `(${avgSentiment > 1 ? "net positive" : avgSentiment < -1 ? "net negative" : "mixed"}). ` +
    `Top event types: ${Object.keys(byType).slice(0, 3).join(", ")}.`;

  return {
    aspect:    "recent_events",
    summary,
    data:      { by_type: byType, top_events_text: topEvents, total: rows.length, avg_sentiment: avgSentiment },
    score:     Math.max(-10, Math.min(10, Math.round(avgSentiment * 3))),
    sentiment: avgSentiment > 1 ? "bullish" : avgSentiment < -1 ? "bearish" : "neutral",
    sources:   ["events_table"],
    cron_name: "market-intelligence",
  };
}

// ─── Cron handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase  = await createClient();
  const results: string[] = [];
  const errors:  string[] = [];

  const aspects = [
    { name: "macro_indicators", fn: () => buildMacroIndicators(supabase) },
    { name: "geopolitical",     fn: () => buildGeopolitical(supabase)     },
    { name: "sector_momentum",  fn: () => buildSectorMomentum(supabase)   },
    { name: "market_sentiment", fn: () => buildMarketSentiment()          },
    { name: "recent_events",    fn: () => buildRecentEvents(supabase)     },
  ];

  for (const { name, fn } of aspects) {
    try {
      const row = await fn();
      const { error } = await supabase
        .from("market_intelligence")
        .upsert(
          { ...row, refreshed_at: new Date().toISOString() },
          { onConflict: "aspect" }
        );
      if (error) throw error;
      results.push(`${name}: ok`);
    } catch (e: any) {
      errors.push(`${name}: ${e.message}`);
      console.error(`market-intelligence cron error [${name}]:`, e);
    }
  }

  return NextResponse.json({
    ok:      errors.length === 0,
    results,
    errors,
    refreshed_at: new Date().toISOString(),
  });
}
