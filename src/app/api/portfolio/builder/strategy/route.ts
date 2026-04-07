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
    const regime_intel    = intelligence.get("regime");

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
      ? buildLlmPrompt(p, { macro_intel, geo_intel, sector_intel, sentiment_intel, events_intel, regime_intel, refreshedAt })
      : buildDataPrompt(p, macro, { macro_intel, geo_intel, sector_intel, sentiment_intel, events_intel, regime_intel, refreshedAt });

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
  regime_intel?:    MarketIntelligence;
  refreshedAt:      string;
}

function buildIntelSection(ctx: IntelCtx): string {
  const lines: string[] = [
    `=== MARKET INTELLIGENCE SNAPSHOT (refreshed: ${ctx.refreshedAt}) ===`,
    "This is pre-computed data from live sources. Treat it as current ground truth.",
    "You MUST reference specific facts from this snapshot in your rationale and macro_context.",
    "",
  ];

  // ── Regime — always first, acts as primary constraint ─────────────────────
  if (ctx.regime_intel?.data) {
    const r = ctx.regime_intel.data;
    lines.push("══ MARKET REGIME (primary constraint — read this first) ══");
    lines.push(`REGIME LABEL:      ${r.label}`);
    lines.push(`Cycle phase:       ${r.cycle_phase}`);
    lines.push(`Inflation regime:  ${r.inflation_regime}`);
    lines.push(`Monetary stance:   ${r.monetary_stance}`);
    lines.push(`Risk bias:         ${r.risk_bias}`);
    lines.push(`Growth trajectory: ${r.growth_trajectory}`);
    lines.push(`Style bias:        ${r.style_bias} (recommended portfolio style)`);
    lines.push(`Cash bias:         ${r.cash_bias}`);
    lines.push(`Duration bias:     ${r.duration_bias}`);
    if (r.favoured_sectors?.length) lines.push(`Favoured sectors:  ${r.favoured_sectors.join(", ")}`);
    if (r.avoid_sectors?.length)    lines.push(`Avoid sectors:     ${r.avoid_sectors.join(", ")}`);
    lines.push(`Confidence:        ${r.confidence}%`);
    lines.push(`Rationale:         ${r.rationale}`);
    lines.push("══════════════════════════════════════════════════════════");
    lines.push("");
  }

  // ── Macro indicators ──────────────────────────────────────────────────────
  if (ctx.macro_intel) {
    const d = ctx.macro_intel.data ?? {};
    lines.push("── MACRO INDICATORS ──");

    // Hard economic data from FRED/BLS (authoritative numbers)
    const econLines: string[] = [];
    if (d.fed_funds_rate    != null) econLines.push(`Fed funds rate:     ${d.fed_funds_rate}%`);
    if (d.treasury_10y      != null) econLines.push(`10Y Treasury yield: ${d.treasury_10y}%`);
    if (d.treasury_2y       != null) econLines.push(`2Y Treasury yield:  ${d.treasury_2y}%`);
    if (d.yield_spread      != null) econLines.push(`Yield curve (10Y-2Y): ${d.yield_spread}% ${d.yield_spread < 0 ? "⚠ INVERTED" : ""}`);
    if (d.gdp_growth        != null) econLines.push(`Real GDP growth:    ${d.gdp_growth}% annualised`);
    if (d.pce_yoy           != null) econLines.push(`PCE inflation:      ${d.pce_yoy}% YoY`);
    if (d.unemployment      != null) econLines.push(`Unemployment rate:  ${d.unemployment}%`);
    if (d.nonfarm_payrolls  != null) econLines.push(`Nonfarm payrolls:   ${d.nonfarm_payrolls > 0 ? "+" : ""}${d.nonfarm_payrolls}k MoM`);
    if (d.consumer_sentiment != null) econLines.push(`Consumer sentiment: ${d.consumer_sentiment}`);

    if (econLines.length) {
      lines.push("Authoritative economic data (FRED/BLS):");
      econLines.forEach(l => lines.push(`  ${l}`));
    }

    lines.push(`Fed stance: ${d.fed_stance ?? "unknown"} | Inflation regime: ${d.inflation_regime ?? "unknown"} | Cycle: ${d.cycle_phase ?? "unknown"}`);
    lines.push(`Key risk: ${d.key_risk ?? "not assessed"}`);
    lines.push(`Macro score: ${d.avg_score ?? ctx.macro_intel.score}/10`);

    // Sentiment scores from news analysis
    if (d.scores?.length) {
      lines.push("News-derived sentiment scores:");
      for (const s of d.scores) {
        lines.push(`  ${s.aspect}: ${s.score > 0 ? "+" : ""}${s.score}/10 (${s.direction}) — ${s.commentary}`);
      }
    }
    lines.push(`Summary: ${ctx.macro_intel.summary}`);
    lines.push("");
  }

  // ── Geopolitical ──────────────────────────────────────────────────────────
  if (ctx.geo_intel) {
    const d = ctx.geo_intel.data ?? {};
    lines.push("── GEOPOLITICAL ENVIRONMENT ──");
    lines.push(`Risk level: ${d.risk_level ?? "moderate"} | Score: ${ctx.geo_intel.score}/10`);
    if (d.active_risks?.length) {
      lines.push(`Active risks:`);
      for (const r of d.active_risks) lines.push(`  • ${r}`);
    }
    if (d.exposed_sectors?.risk?.length) {
      lines.push(`Sectors at risk: ${d.exposed_sectors.risk.join(", ")}`);
    }
    if (d.exposed_sectors?.opportunity?.length) {
      lines.push(`Sector opportunities: ${d.exposed_sectors.opportunity.join(", ")}`);
    }
    lines.push(ctx.geo_intel.summary);
    // Include top raw events for specificity
    if (d.raw_events?.length) {
      lines.push("Top geopolitical events:");
      for (const e of d.raw_events.slice(0, 5)) {
        const date = new Date(e.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        lines.push(`  [${date}] impact:${(e.impact_score ?? 0).toFixed(1)} — ${e.headline}`);
      }
    }
    lines.push("");
  }

  // ── Sector momentum ───────────────────────────────────────────────────────
  if (ctx.sector_intel) {
    const d = ctx.sector_intel.data ?? {};
    lines.push("── SECTOR MOMENTUM (from our signal database) ──");
    if (d.leading?.length) lines.push(`Leading (high BUY signal): ${d.leading.join(", ")}`);
    if (d.lagging?.length) lines.push(`Lagging (high AVOID signal): ${d.lagging.join(", ")}`);
    if (d.sectors?.length) {
      lines.push("Sector breakdown:");
      for (const s of d.sectors.slice(0, 6)) {
        lines.push(`  ${s.sector}: BUY ${s.buy_pct}% | AVOID ${s.avoid_pct}% | F:${s.f_avg} T:${s.t_avg}`);
      }
    }
    lines.push("");
  }

  // ── Market sentiment ──────────────────────────────────────────────────────
  if (ctx.sentiment_intel) {
    const d = ctx.sentiment_intel.data ?? {};
    lines.push("── MARKET SENTIMENT ──");
    lines.push(`Trend: ${d.market_trend ?? "unknown"} | Risk appetite: ${d.risk_appetite ?? "mixed"} | Volatility: ${d.vix_level ?? "moderate"}`);
    lines.push(`Score: ${d.score ?? ctx.sentiment_intel.score}/10`);
    lines.push(ctx.sentiment_intel.summary);
    lines.push("");
  }

  // ── Recent events ─────────────────────────────────────────────────────────
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
    "2. Name specific risks from the snapshot — e.g. 'U.S.-Iran conflict', 'Strait of Hormuz disruption', not generic 'geopolitical uncertainty'",
    "3. Reference specific macro scores — e.g. 'labour score -3/10', 'Fed stance dovish', not 'current macro conditions'",
    "4. Set sector_tilts consistent with leading sectors from the sector momentum data",
    "5. Set avoid_sectors consistent with lagging sectors AND geopolitical exposed_sectors.risk",
    "6. Justify cash_reserve_pct using geopolitical risk level and market sentiment score",
    "FORBIDDEN: Do not write 'without access to specific data' or 'based on general patterns'.",
    "REQUIRED: Your rationale must cite at least 2 named events/indicators from the snapshot above.",
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
    '  "summary": "One-line headline citing a specific macro or geopolitical factor",',
    '  "rationale": "2-3 sentences — cite specific macro scores (e.g. labour -3/10, Fed dovish) and named geopolitical events (e.g. U.S.-Iran conflict, Hormuz disruption)",',
    '  "macro_context": null',
    "}",
  ].join("\n");
}
