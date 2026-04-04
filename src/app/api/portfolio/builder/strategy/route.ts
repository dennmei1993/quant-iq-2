// src/app/api/portfolio/builder/strategy/route.ts
//
// POST — generate a strategy profile.
//
// mode=data: Claude reads portfolio preferences + DB macro scores + market_intelligence snapshot
// mode=llm:  Model reads portfolio preferences + market_intelligence snapshot (no live fetching)
//
// Market intelligence is pre-computed by /api/cron/market-intelligence and stored in the
// market_intelligence table — one row per aspect, refreshed daily. This keeps LLM calls fast.

import { NextRequest, NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/supabase";
import { callLlm } from "@/lib/llm-caller";
import { logLlmStep } from "@/lib/builder-llm-logger";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

// ─── Types ────────────────────────────────────────────────────────────────────

interface MarketIntelligence {
  aspect:      string;
  summary:     string;
  data:        any;
  score:       number | null;
  sentiment:   string | null;
  refreshed_at: string;
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const {
      portfolio_id,
      mode     = "data",
      run_id   = null,
      provider = "claude",
      model_id,
    } = await req.json();

    const { data: raw } = await supabase
      .from("portfolios").select("*")
      .eq("id", portfolio_id).eq("user_id", user.id).single();

    if (!raw) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
    const p = raw as any;

    // ── Load market intelligence snapshot (pre-computed by cron) ──────────────
    const { data: intelligenceRows } = await supabase
      .from("market_intelligence")
      .select("aspect, summary, data, score, sentiment, refreshed_at")
      .order("refreshed_at", { ascending: false });

    const intelligence = new Map<string, MarketIntelligence>(
      (intelligenceRows ?? []).map((r: any) => [r.aspect, r])
    );

    const macro_intel     = intelligence.get("macro_indicators");
    const geo_intel       = intelligence.get("geopolitical");
    const sector_intel    = intelligence.get("sector_momentum");
    const sentiment_intel = intelligence.get("market_sentiment");
    const events_intel    = intelligence.get("recent_events");

    const refreshedAt = macro_intel?.refreshed_at
      ? new Date(macro_intel.refreshed_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : "unknown";

    // ── Data mode: also load raw macro_scores from DB ─────────────────────────
    let macro: any[] = [];
    if (mode === "data") {
      const { data } = await supabase
        .from("macro_scores")
        .select("aspect, score, direction, commentary")
        .order("scored_at", { ascending: false }).limit(6);
      macro = data ?? [];
    }

    // ── Build prompt ──────────────────────────────────────────────────────────
    const prompt = mode === "llm"
      ? buildLlmPrompt(p, { macro_intel, geo_intel, sector_intel, sentiment_intel, events_intel, refreshedAt })
      : buildDataPrompt(p, macro, { macro_intel, geo_intel, sector_intel, sentiment_intel, events_intel, refreshedAt });

    const llmStart  = Date.now();
    const llmResult = await callLlm({ provider, model_id, prompt, max_tokens: 1200 });
    await logLlmStep({ supabase, run_id, step: "strategy", prompt, response: llmResult, started_at: llmStart });

    const clean    = llmResult.text.replace(/```json|```/g, "").trim();
    const strategy = JSON.parse(clean);

    return NextResponse.json({
      strategy,
      macro,
      intelligence_refreshed_at: refreshedAt,
      intelligence_aspects: [...intelligence.keys()],
    });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}

// ─── Context builder ──────────────────────────────────────────────────────────

interface IntelCtx {
  macro_intel?:     MarketIntelligence;
  geo_intel?:       MarketIntelligence;
  sector_intel?:    MarketIntelligence;
  sentiment_intel?: MarketIntelligence;
  events_intel?:    MarketIntelligence;
  refreshedAt:      string;
}

function buildIntelSection(ctx: IntelCtx): string {
  const lines: string[] = [
    `=== MARKET INTELLIGENCE SNAPSHOT (refreshed: ${ctx.refreshedAt}) ===`,
    "This data is pre-computed from live sources — treat it as current ground truth.",
    "",
  ];

  if (ctx.macro_intel) {
    const d = ctx.macro_intel.data ?? {};
    lines.push("── MACRO INDICATORS ──");
    if (d.cpi_yoy)      lines.push(`CPI Inflation:   ${d.cpi_yoy}`);
    if (d.gdp_growth)   lines.push(`GDP Growth:      ${d.gdp_growth}`);
    if (d.unemployment) lines.push(`Unemployment:    ${d.unemployment}`);
    if (d.fed_rate)     lines.push(`Fed Funds Rate:  ${d.fed_rate}`);
    if (d.yield_10y)    lines.push(`10Y Treasury:    ${d.yield_10y}`);
    if (d.fed_stance)   lines.push(`Fed Stance:      ${d.fed_stance}`);
    lines.push(`Macro summary: ${ctx.macro_intel.summary}`);
    lines.push("");
  }

  if (ctx.geo_intel) {
    lines.push("── GEOPOLITICAL ENVIRONMENT ──");
    lines.push(`Risk level: ${ctx.geo_intel.data?.risk_level ?? "moderate"} | Score: ${ctx.geo_intel.score ?? 0}/10`);
    const risks = ctx.geo_intel.data?.active_risks ?? [];
    if (risks.length) lines.push(`Active risks: ${risks.join(", ")}`);
    lines.push(ctx.geo_intel.summary);
    lines.push("");
  }

  if (ctx.sector_intel) {
    const d = ctx.sector_intel.data ?? {};
    lines.push("── SECTOR MOMENTUM ──");
    if (d.leading?.length)  lines.push(`Leading sectors:  ${d.leading.join(", ")}`);
    if (d.lagging?.length)  lines.push(`Lagging sectors:  ${d.lagging.join(", ")}`);
    lines.push(ctx.sector_intel.summary);
    lines.push("");
  }

  if (ctx.sentiment_intel) {
    const d = ctx.sentiment_intel.data ?? {};
    lines.push("── MARKET SENTIMENT ──");
    if (d.market_trend)   lines.push(`Trend:          ${d.market_trend}`);
    if (d.risk_appetite)  lines.push(`Risk appetite:  ${d.risk_appetite}`);
    if (d.vix_level)      lines.push(`Volatility:     ${d.vix_level}`);
    lines.push(ctx.sentiment_intel.summary);
    lines.push("");
  }

  if (ctx.events_intel?.data?.top_events_text) {
    lines.push("── RECENT HIGH-IMPACT EVENTS ──");
    lines.push(ctx.events_intel.data.top_events_text);
    lines.push("");
  }

  return lines.join("\n");
}

// ─── LLM prompt ───────────────────────────────────────────────────────────────

function buildLlmPrompt(p: any, ctx: IntelCtx): string {
  const riskAppetite    = p.risk_appetite      ?? "moderate";
  const horizon         = p.investment_horizon ?? "long";
  const totalCapital    = (p.total_capital ?? 0).toLocaleString();
  const minCashPct      = p.cash_pct            ?? 0;
  const targetHoldings  = p.target_holdings     ?? 15;
  const preferredAssets = (p.preferred_assets ?? []).join(", ") || "all asset classes";
  const benchmark       = p.benchmark           ?? "SPY";
  const maxPositionCap  = Math.round(100 / targetHoldings * 1.5);

  const riskRules: Record<string, string> = {
    aggressive:   "You MUST recommend a growth or speculative style. Do NOT recommend defensive or income.",
    moderate:     "You MUST recommend a balanced or growth style. Avoid speculative or pure defensive.",
    conservative: "You MUST recommend a defensive or income style. Do NOT recommend growth or speculative.",
  };
  const horizonRules: Record<string, string> = {
    short:  "SHORT horizon (<1yr): prioritise near-term catalysts. Avoid multi-year thesis positions.",
    medium: "MEDIUM horizon (1-3yr): balance near-term momentum with quality fundamentals.",
    long:   "LONG horizon (3+yr): prioritise quality compounders and structural themes.",
  };

  return [
    "You are a professional investment adviser providing US market strategy advice.",
    "",
    "=== CLIENT CONSTRAINTS — NON-NEGOTIABLE ===",
    "",
    `RISK:         ${riskRules[riskAppetite] ?? "Recommend a balanced style."}`,
    `HORIZON:      ${horizonRules[horizon] ?? ""}`,
    `CASH:         cash_reserve_pct MUST be at least ${minCashPct}%.`,
    `ASSETS:       ${(p.preferred_assets ?? []).length > 0 ? `Client ONLY invests in: ${preferredAssets}.` : "All asset classes permitted."}`,
    `CONCENTRATION:Target ${targetHoldings} holdings — max_single_weight must not exceed ${maxPositionCap}%.`,
    `BENCHMARK:    ${benchmark}`,
    "",
    "=== CLIENT PROFILE ===",
    "",
    `Risk appetite: ${riskAppetite} | Horizon: ${horizon} | Capital: $${totalCapital}`,
    `Cash floor: ${minCashPct}% | Target holdings: ${targetHoldings} | Benchmark: ${benchmark}`,
    `Preferred assets: ${preferredAssets}`,
    "",
    buildIntelSection(ctx),
    "=== YOUR TASK ===",
    "",
    "Based on the market intelligence snapshot above, recommend an investment strategy.",
    "The snapshot contains real current data — use it as your primary source.",
    "Your recommendation MUST:",
    "1. Respect ALL client constraints above",
    "2. Explicitly reference specific data points from the snapshot (e.g. Fed rate, active conflicts)",
    "3. Set sector_tilts consistent with sector momentum and geopolitical data",
    "4. Reflect current sentiment and volatility in the cash_reserve_pct recommendation",
    "",
    "Respond ONLY with valid JSON, no markdown:",
    "{",
    '  "style": "balanced",',
    '  "cash_reserve_pct": 12,',
    '  "sector_tilts": ["Technology", "Healthcare"],',
    '  "avoid_sectors": ["Energy"],',
    '  "max_single_weight": 8,',
    '  "summary": "One headline sentence for this strategy",',
    '  "rationale": "3-4 sentences referencing specific data from the snapshot: name the Fed rate, active geopolitical risks, and leading sectors",',
    '  "macro_context": "2-3 sentences on the macro/geopolitical factors from the snapshot that most influenced sector tilts and style"',
    "}",
  ].join("\n");
}

// ─── Data prompt ──────────────────────────────────────────────────────────────

function buildDataPrompt(p: any, macro: any[], ctx: IntelCtx): string {
  return [
    "You are an investment strategy advisor for a self-directed retail investor.",
    "",
    "PORTFOLIO PREFERENCES:",
    `- Risk appetite: ${p.risk_appetite}`,
    `- Investment horizon: ${p.investment_horizon}`,
    `- Benchmark: ${p.benchmark}`,
    `- Total capital: $${(p.total_capital ?? 0).toLocaleString()}`,
    `- Min cash reserve: ${p.cash_pct ?? 0}%`,
    `- Target holdings: ${p.target_holdings ?? 15}`,
    `- Preferred assets: ${(p.preferred_assets ?? []).join(", ") || "all"}`,
    "",
    "MACRO SCORES (our internal scoring system, -10 to +10):",
    ...(macro.map(m => `- ${m.aspect}: ${m.score > 0 ? "+" : ""}${m.score}/10 (${m.direction}) — ${m.commentary}`)),
    "",
    buildIntelSection(ctx),
    "Based on all the above data, recommend a strategy profile.",
    "",
    "Choose style: growth | balanced | defensive | income | speculative",
    "Recommend: cash_reserve_pct (respect min floor), sector_tilts (1-3), avoid_sectors (0-2), max_single_weight",
    "",
    "Respond ONLY with valid JSON, no markdown:",
    "{",
    '  "style": "growth",',
    '  "cash_reserve_pct": 10,',
    '  "sector_tilts": ["Technology", "Healthcare"],',
    '  "avoid_sectors": ["Energy"],',
    '  "max_single_weight": 10,',
    '  "summary": "One-line headline",',
    '  "rationale": "2-3 sentences explaining the recommendation referencing macro scores and market intelligence",',
    '  "macro_context": null',
    "}",
  ].join("\n");
}
