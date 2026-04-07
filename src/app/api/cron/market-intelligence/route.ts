// src/app/api/cron/market-intelligence/route.ts
//
// Refreshes the market_intelligence table — one row per aspect.
// All 5 aspects run in PARALLEL via Promise.allSettled.
//
// NO web search — uses DB data + Claude training knowledge only.
// This keeps each aspect under 10s. Total runtime ~15-20s.
//
// Schedule: 0 11 * * * (after ingest→macro→themes pipeline)

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

// ─── Shared Claude call ───────────────────────────────────────────────────────

async function askClaude(prompt: string, max_tokens = 500): Promise<any> {
  const msg = await anthropic.messages.create({
    model:    "claude-haiku-4-5-20251001",   // fastest + cheapest for structured extraction
    max_tokens,
    messages: [{ role: "user", content: prompt }],
  });
  const text  = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

// ─── Aspect: macro_indicators ─────────────────────────────────────────────────
// Reads from our macro_scores table + asks Claude for macro narrative

async function buildMacroIndicators(supabase: any): Promise<AspectRow> {
  // Fetch both macro sentiment scores AND authoritative economic indicators
  const [scoresRes, econRes] = await Promise.all([
    supabase
      .from("macro_scores")
      .select("aspect, score, direction, commentary")
      .order("scored_at", { ascending: false })
      .limit(6),
    supabase
      .from("economic_indicators")
      .select("indicator, value, previous, change, period, unit, direction, commentary")
      .order("refreshed_at", { ascending: false }),
  ]);

  const scores = scoresRes.data ?? [];
  const econ   = econRes.data   ?? [];

  const avgScore = scores.length
    ? scores.reduce((s: number, m: any) => s + m.score, 0) / scores.length
    : 0;

  // Build structured economic data summary
  interface EconIndicator {
    indicator: string;
    value:     number | null;
    previous:  number | null;
    change:    number | null;
    period:    string | null;
    unit:      string;
    direction: string;
    commentary: string;
  }
  const econMap = new Map<string, EconIndicator>(
    (Array.isArray(econ) ? econ as EconIndicator[] : []).map(e => [e.indicator, e])
  );
  const fedRate    = econMap.get("fed_funds_rate");
  const t10y       = econMap.get("treasury_10y");
  const t2y        = econMap.get("treasury_2y");
  const spread     = econMap.get("yield_spread_10y2y");
  const gdp        = econMap.get("gdp_growth_real");
  const pce        = econMap.get("pce_yoy");
  const unemp      = econMap.get("unemployment_rate");
  const payrolls   = econMap.get("nonfarm_payrolls");
  const sentiment  = econMap.get("consumer_sentiment");
  const cpi        = econMap.get("cpi_yoy");

  const macroScoreText = scores
    .map((m: any) => `${m.aspect}: ${m.score > 0 ? "+" : ""}${m.score}/10 (${m.direction}) — ${m.commentary ?? ""}`)
    .join("\n");

  const econText = [
    fedRate   ? `Fed funds rate: ${fedRate.value}% (${fedRate.direction})` : null,
    t10y      ? `10Y Treasury: ${t10y.value}% (${t10y.direction})` : null,
    t2y       ? `2Y Treasury: ${t2y.value}%` : null,
    spread?.value != null ? `Yield curve (10Y-2Y): ${spread.value}% ${spread.value < 0 ? "INVERTED" : ""}` : null,
    gdp       ? `Real GDP growth: ${gdp.value}% annualised (${gdp.direction})` : null,
    pce       ? `PCE inflation: ${pce.value}% YoY (${pce.direction})` : null,
    cpi       ? `CPI index: ${cpi.value} in ${cpi.period}` : null,
    unemp     ? `Unemployment: ${unemp.value}% (${unemp.direction})` : null,
    payrolls?.value != null ? `Nonfarm payrolls: ${payrolls.value > 0 ? "+" : ""}${payrolls.value}k (${payrolls.period})` : null,
    sentiment ? `Consumer sentiment: ${sentiment.value} (${sentiment.direction})` : null,
  ].filter(Boolean).join("\n");

  let data: any = { scores, econ_indicators: econ, avg_score: avgScore };
  try {
    data = await askClaude(
      `You are a macro analyst. Synthesise these authoritative economic data points and sentiment scores into a brief investment narrative.

AUTHORITATIVE ECONOMIC DATA:
${econText || "Economic data not yet available — using sentiment scores only."}

INTERNAL MACRO SENTIMENT SCORES (from news analysis):
${macroScoreText || "No scores available yet."}

Return ONLY valid JSON:
{
  "summary": "2-3 sentence narrative combining the hard economic data and sentiment signals, with specific numbers",
  "fed_stance": "hawkish|neutral|dovish",
  "inflation_regime": "deflationary|stable|elevated|higher-for-longer|stagflation",
  "cycle_phase": "early|mid|late|recession",
  "key_risk": "the single biggest macro risk in one specific phrase with numbers",
  "avg_score": ${avgScore.toFixed(1)}
}`,
      500
    );
    data.scores          = scores;
    data.econ_indicators = econ;
    // Attach key economic values directly for easy access by strategy prompt
    if (fedRate)   data.fed_funds_rate    = fedRate.value;
    if (t10y)      data.treasury_10y      = t10y.value;
    if (t2y)       data.treasury_2y       = t2y.value;
    if (spread)    data.yield_spread      = spread.value;
    if (gdp)       data.gdp_growth        = gdp.value;
    if (pce)       data.pce_yoy           = pce.value;
    if (unemp)     data.unemployment      = unemp.value;
    if (payrolls)  data.nonfarm_payrolls  = payrolls.value;
    if (sentiment) data.consumer_sentiment = sentiment.value;
  } catch {
    data = { summary: econText.slice(0, 400) || macroScoreText.slice(0, 300), scores, econ_indicators: econ, avg_score: avgScore };
  }

  const score = Math.max(-10, Math.min(10, Math.round(avgScore)));
  return {
    aspect:    "macro_indicators",
    summary:   data.summary ?? econText.slice(0, 400),
    data,
    score,
    sentiment: score >= 2 ? "bullish" : score <= -2 ? "bearish" : "neutral",
    sources:   ["macro_scores", "economic_indicators"],
    cron_name: "market-intelligence",
  };
}

// ─── Aspect: geopolitical ─────────────────────────────────────────────────────
// Reads recent geopolitical events from DB + Claude summarises

async function buildGeopolitical(supabase: any): Promise<AspectRow> {
  const { data: events } = await supabase
    .from("events")
    .select("headline, ai_summary, event_type, impact_score, sentiment_score, sectors, published_at")
    .eq("ai_processed", true)
    .in("event_type", ["geopolitical", "policy", "trade", "conflict", "sanction", "macro"])
    .order("impact_score", { ascending: false })
    .order("published_at",  { ascending: false })
    .limit(15);

  const rows = events ?? [];
  const eventText = rows.slice(0, 10).map((e: any) => {
    const date = new Date(e.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `[${date}] impact:${(e.impact_score ?? 0).toFixed(1)} — ${e.headline}${e.ai_summary ? ` → ${e.ai_summary}` : ""}`;
  }).join("\n");

  let data: any = {};
  try {
    data = await askClaude(
      `You are a geopolitical risk analyst for equity investors. Analyse these recent events:

${eventText || "No recent geopolitical events classified."}

Return ONLY valid JSON:
{
  "summary": "3 sentence narrative on active geopolitical risks and their impact on US equity sectors",
  "active_risks": ["list up to 3 named risks, e.g. Iran conflict, US-China tariffs"],
  "exposed_sectors": { "risk": ["Energy"], "opportunity": ["Defense"] },
  "risk_level": "elevated|moderate|contained",
  "score": -3
}
score: -10 (extreme risk) to 0 (neutral).`,
      500
    );
  } catch {
    data = { risk_level: "moderate", active_risks: [], summary: eventText.slice(0, 200) };
  }

  const score = typeof data.score === "number" ? Math.max(-10, Math.min(0, data.score)) : -2;
  return {
    aspect:    "geopolitical",
    summary:   data.summary ?? "",
    data:      { ...data, raw_events: rows.slice(0, 10) },
    score,
    sentiment: score >= 0 ? "neutral" : score >= -4 ? "bearish" : "bearish",
    sources:   ["events_table"],
    cron_name: "market-intelligence",
  };
}

// ─── Aspect: sector_momentum — pure DB aggregation, no LLM ───────────────────

async function buildSectorMomentum(supabase: any): Promise<AspectRow> {
  const { data: signals } = await supabase
    .from("asset_signals")
    .select("ticker, signal, fundamental_score, technical_score, assets!inner(sector, asset_type)")
    .in("signal", ["buy", "watch", "hold", "avoid"])
    .eq("assets.asset_type", "stock")
    .not("assets.sector", "is", null);

  const sectorMap: Record<string, { buy: number; avoid: number; f: number; t: number; n: number }> = {};
  for (const s of (Array.isArray(signals) ? signals : [])) {
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
    summary:   `Leading: ${leading.join(", ")}. Lagging: ${lagging.join(", ")}. Based on ${signals?.length ?? 0} signals.`,
    data:      { sectors: ranked, leading, lagging },
    score:     Math.max(-10, Math.min(10, Math.round(overall / 10))),
    sentiment: overall > 5 ? "bullish" : overall < -5 ? "bearish" : "neutral",
    sources:   ["asset_signals"],
    cron_name: "market-intelligence",
  };
}

// ─── Aspect: market_sentiment ─────────────────────────────────────────────────
// Aggregates from our events + signals, Claude interprets

async function buildMarketSentiment(supabase: any): Promise<AspectRow> {
  const { data: recentEvents } = await supabase
    .from("events")
    .select("sentiment_score, impact_score, event_type")
    .eq("ai_processed", true)
    .order("published_at", { ascending: false })
    .limit(30);

  const rows = recentEvents ?? [];
  const avgSentiment = rows.length
    ? rows.reduce((s: number, e: any) => s + (e.sentiment_score ?? 0), 0) / rows.length
    : 0;
  const avgImpact = rows.length
    ? rows.reduce((s: number, e: any) => s + (e.impact_score ?? 0), 0) / rows.length
    : 0;

  let data: any = {};
  try {
    data = await askClaude(
      `You are a market sentiment analyst. Based on these aggregate metrics from recent news events:

- Average sentiment score: ${avgSentiment.toFixed(2)} (scale: -1 bearish to +1 bullish)
- Average impact score: ${avgImpact.toFixed(1)} (scale: 0-10)
- Number of events analysed: ${rows.length}
- Event type breakdown: ${JSON.stringify(
        rows.reduce((acc: any, e: any) => {
          acc[e.event_type ?? "general"] = (acc[e.event_type ?? "general"] ?? 0) + 1;
          return acc;
        }, {})
      )}

Interpret the current market sentiment for US equity investors.

Return ONLY valid JSON:
{
  "summary": "2 sentence narrative on current market sentiment and what it means for investors",
  "market_trend": "bullish|bearish|sideways",
  "risk_appetite": "risk-on|risk-off|mixed",
  "vix_level": "low|moderate|elevated|extreme",
  "score": 2
}
score -10 to +10.`,
      400
    );
  } catch {
    data = { market_trend: "sideways", risk_appetite: "mixed", summary: `Avg sentiment: ${avgSentiment.toFixed(2)}` };
  }

  const score = typeof data.score === "number" ? Math.max(-10, Math.min(10, data.score)) : Math.round(avgSentiment * 5);
  return {
    aspect:    "market_sentiment",
    summary:   data.summary ?? "",
    data:      { ...data, avg_sentiment: avgSentiment, avg_impact: avgImpact, event_count: rows.length },
    score,
    sentiment: score >= 3 ? "bullish" : score <= -3 ? "bearish" : "neutral",
    sources:   ["events_table"],
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
  for (const e of (Array.isArray(rows) ? rows : [])) {
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
    summary:   `${rows.length} events. Avg sentiment: ${avgSentiment.toFixed(1)}. Types: ${Object.keys(byType).join(", ")}.`,
    data:      { by_type: byType, top_events_text: topEventsText, total: rows.length, avg_sentiment: avgSentiment },
    score:     Math.max(-10, Math.min(10, Math.round(avgSentiment * 3))),
    sentiment: avgSentiment > 0.5 ? "bullish" : avgSentiment < -0.5 ? "bearish" : "neutral",
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

  // All 5 aspects in parallel
  // Read current regime classification (set by regime cron)
  const { data: regimeRows } = await supabase
    .from("market_regime")
    .select("*")
    .limit(2);
  const regimeRow = regimeRows?.[0] ?? null;

  const aspects = [
    { name: "macro_indicators", fn: () => buildMacroIndicators(supabase) },
    { name: "geopolitical",     fn: () => buildGeopolitical(supabase)    },
    { name: "sector_momentum",  fn: () => buildSectorMomentum(supabase)  },
    { name: "market_sentiment", fn: () => buildMarketSentiment(supabase) },
    { name: "recent_events",    fn: () => buildRecentEvents(supabase)    },
  ];

  const settled = await Promise.allSettled(aspects.map(a => a.fn()));

  const results: string[] = [];
  const errors:  string[] = [];

  await Promise.allSettled(
    settled.map(async (result, i) => {
      const { name } = aspects[i];
      if (result.status === "rejected") {
        errors.push(`${name}: ${result.reason?.message ?? "failed"}`);
        console.error(`[market-intelligence] ${name}:`, result.reason);
        return;
      }
      const { error } = await supabase
        .from("market_intelligence")
        .upsert(
          { ...result.value, refreshed_at: new Date().toISOString() },
          { onConflict: "aspect" }
        );
      if (error) errors.push(`${name} upsert: ${error.message}`);
      else       results.push(`${name}: ok`);
    })
  );

  const elapsed = Math.round((Date.now() - started) / 1000);
  console.log(`[market-intelligence] ${elapsed}s — ${results.length} ok, ${errors.length} errors`);

  return NextResponse.json({ ok: errors.length === 0, results, errors, elapsed_s: elapsed });
}
