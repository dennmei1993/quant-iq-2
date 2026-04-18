// src/app/api/portfolio/builder/strategy/route.ts
//
// POST — generate a strategy profile.
//
// mode=data: Claude reads portfolio preferences + DB macro scores + market_intelligence snapshot
// mode=llm:  Model reads portfolio preferences + market_intelligence snapshot (no live fetching)
//
// Dev tool support:
//   GET  ?portfolio_id=&mode=   — returns the assembled prompt WITHOUT calling the LLM
//   POST { prompt_override }    — uses the supplied prompt instead of assembling one

import { NextRequest, NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/supabase";
import { callLlm } from "@/lib/llm-caller";
import { logLlmStep } from "@/lib/builder-llm-logger";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service client — bypasses RLS for global system tables
// (market_intelligence, macro_scores, market_regime have no user_id)
function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface MarketIntelligence {
  aspect:       string;
  summary:      string;
  data:         any;
  score:        number | null;
  sentiment:    string | null;
  refreshed_at: string;
}

interface IntelCtx {
  macro_intel?:     MarketIntelligence;
  geo_intel?:       MarketIntelligence;
  sector_intel?:    MarketIntelligence;
  sentiment_intel?: MarketIntelligence;
  events_intel?:    MarketIntelligence;
  regime_intel?:    MarketIntelligence;
  refreshedAt:      string;
}

// ─── Robust JSON extractor ────────────────────────────────────────────────────

function extractJson(raw: string): any {
  const text  = raw.replace(/```[a-z]*\s*/gi, "").replace(/```/g, "").trim();
  const start = text.indexOf("{");
  const end   = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`No JSON object found in LLM response. Raw (first 300): ${raw.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (e: any) {
    throw new Error(`JSON parse failed: ${e.message}. Extracted: ${text.slice(start, start + 300)}`);
  }
}

// ─── GET — return assembled prompt for dev preview (no LLM call) ──────────────

export async function GET(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const portfolioId = req.nextUrl.searchParams.get("portfolio_id");
    const mode        = (req.nextUrl.searchParams.get("mode") ?? "data") as "data" | "llm";

    if (!portfolioId) return NextResponse.json({ error: "portfolio_id required" }, { status: 400 });

    const { data: raw } = await supabase
      .from("portfolios").select("*")
      .eq("id", portfolioId).eq("user_id", user.id).single();
    if (!raw) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });

    const { prompt } = await assemblePrompt(supabase, createServiceClient(), raw, mode);
    return NextResponse.json({ prompt, mode });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}

// ─── POST — generate strategy (optionally with overridden prompt) ─────────────

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const {
      portfolio_id,
      mode            = "data",
      run_id          = null,
      provider        = "claude",
      model_id,
      prompt_override,   // dev tool: use this prompt instead of assembling one
    } = await req.json();

    const { data: raw } = await supabase
      .from("portfolios").select("*")
      .eq("id", portfolio_id).eq("user_id", user.id).single();
    if (!raw) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });

    // Assemble prompt (or use override if provided)
    const { prompt: assembledPrompt, macro, refreshedAt, intelligenceAspects } =
      await assemblePrompt(supabase, createServiceClient(), raw, mode);

    const prompt = prompt_override ?? assembledPrompt;

    const llmStart  = Date.now();
    const llmResult = await callLlm({ provider, model_id, prompt, max_tokens: 1200 });
    await logLlmStep({ supabase, run_id, step: "strategy", prompt, response: llmResult, started_at: llmStart });

    const strategy = extractJson(llmResult.text);

    return NextResponse.json({
      strategy,
      macro,
      prompt: assembledPrompt,   // always return the original assembled prompt for the dev tool
      intelligence_refreshed_at: refreshedAt,
      intelligence_aspects:      intelligenceAspects,
    });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}


// ─── Universe descriptions ────────────────────────────────────────────────────

const UNIVERSE_LABELS: Record<string, { label: string; tickers?: string }> = {
  mag7:         { label: "Mag 7 only",                tickers: "AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA" },
  us_large_cap: { label: "US Large Cap (S&P 500)",    tickers: "S&P 500 constituents" },
  broad_etf:    { label: "Broad market ETFs",         tickers: "SPY, QQQ, VTI, IWM, DIA and similar" },
  sector_etf:   { label: "Sector ETFs",               tickers: "XLE, XLK, XLF, XLV, XLI and similar sector ETFs" },
  dividend:     { label: "Dividend / income stocks",  tickers: "High-yield dividend payers, REITs, dividend ETFs" },
  small_mid:    { label: "Small/Mid Cap",             tickers: "Russell 2000, S&P 400 constituents" },
  global_etf:   { label: "Global / international ETFs", tickers: "VEA, VWO, EFA, IEFA and similar" },
  thematic:     { label: "Thematic ETFs",             tickers: "ARK funds, clean energy, AI, cybersecurity ETFs" },
};

function buildUniverseConstraint(universe: string[], sector_exclude: string[]): string {
  const lines: string[] = [];

  if (universe.length > 0) {
    lines.push("══ UNIVERSE CONSTRAINT — HARD LIMIT ══");
    lines.push("The user ONLY invests in the following universe(s). ALL recommendations MUST be within this set.");
    lines.push("Do NOT recommend any ticker or sector outside this universe regardless of signals.");
    lines.push("");
    for (const u of universe) {
      const meta = UNIVERSE_LABELS[u];
      if (meta) {
        lines.push(`  • ${meta.label}`);
        if (meta.tickers) lines.push(`    Eligible: ${meta.tickers}`);
      } else {
        lines.push(`  • ${u}`);
      }
    }
    lines.push("");

    // Derive sector implications from universe
    if (universe.includes("mag7")) {
      lines.push("  Universe implication: Mag 7 spans Technology + Consumer Discretionary only.");
      lines.push("  sector_tilts and avoid_sectors MUST reflect this — do not recommend Energy, Healthcare, etc.");
    }
    if (universe.includes("broad_etf") || universe.includes("sector_etf")) {
      lines.push("  Universe implication: ETF-only portfolio — recommend allocation shifts between ETF categories");
      lines.push("  rather than individual stock picks.");
    }
    lines.push("══════════════════════════════════════");
    lines.push("");
  }

  if (sector_exclude.length > 0) {
    lines.push("══ EXCLUDED SECTORS — HARD LIMIT ══");
    lines.push(`The user permanently excludes these sectors: ${sector_exclude.join(", ")}`);
    lines.push("Do NOT include these in sector_tilts. If the regime favours them, acknowledge but do not recommend.");
    lines.push("══════════════════════════════════════");
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Shared prompt assembly ────────────────────────────────────────────────────

async function assemblePrompt(userClient: any, serviceClient: any, p: any, mode: "data" | "llm") {
  // Load market intelligence snapshot
  const { data: intelligenceRows, error: intelErr } = await serviceClient
    .from("market_intelligence")
    .select("aspect, summary, data, score, sentiment, refreshed_at")
    .order("refreshed_at", { ascending: false });
  if (intelErr) console.error("[strategy] market_intelligence read error:", intelErr.message);

  const intelligence = new Map<string, MarketIntelligence>(
    (intelligenceRows ?? []).map((r: any) => [r.aspect, r])
  );

  const macro_intel     = intelligence.get("macro_indicators");
  const geo_intel       = intelligence.get("geopolitical");
  const sector_intel    = intelligence.get("sector_momentum");
  const sentiment_intel = intelligence.get("market_sentiment");
  const events_intel    = intelligence.get("recent_events");
  const regime_intel    = intelligence.get("regime");

  // Use the most recently refreshed row for the timestamp
  const latestRow = [...intelligence.values()].sort(
    (a, b) => new Date(b.refreshed_at).getTime() - new Date(a.refreshed_at).getTime()
  )[0];
  const refreshedAt = latestRow?.refreshed_at
    ? new Date(latestRow.refreshed_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "unknown";

  const ctx: IntelCtx = { macro_intel, geo_intel, sector_intel, sentiment_intel, events_intel, regime_intel, refreshedAt };

  // Load raw macro scores — not injected into prompt (intel section has them already)
  // but returned in API response so the UI strategy step can display them
  const { data: macroRows } = await serviceClient
    .from("macro_scores")
    .select("aspect, score, direction, commentary")
    .order("scored_at", { ascending: false }).limit(6);
  const macro = macroRows ?? [];

  const prompt = mode === "llm"
    ? buildLlmPrompt(p, ctx)
    : buildDataPrompt(p, ctx);

  return {
    prompt,
    macro,
    refreshedAt,
    intelligenceAspects: [...intelligence.keys()],
  };
}

// ─── Market intelligence section (shared by both prompts) ─────────────────────

function buildIntelSection(ctx: IntelCtx): string {
  const lines: string[] = [
    `=== MARKET INTELLIGENCE SNAPSHOT (refreshed: ${ctx.refreshedAt}) ===`,
    "This is pre-computed data from live sources. Treat it as current ground truth.",
    "You MUST reference specific facts from this snapshot in your rationale and macro_context.",
    "",
  ];

  // Regime — primary constraint
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

  // Macro indicators — field mapping matches actual market_intelligence.data structure
  if (ctx.macro_intel) {
    const d = ctx.macro_intel.data ?? {};

    // Extract CPI from econ_indicators array (not at top level)
    const econArr = d.econ_indicators ?? [];
    const cpiRow  = econArr.find((e: any) => e.indicator === "cpi_yoy");
    const cpiYoy  = cpiRow?.value ?? null;

    lines.push("── MACRO INDICATORS ──");
    lines.push("Authoritative economic data (FRED/BLS):");
    if (d.fed_funds_rate     != null) lines.push(`  Fed funds rate:       ${d.fed_funds_rate}%`);
    if (d.treasury_10y       != null) lines.push(`  10Y Treasury yield:   ${d.treasury_10y}%`);
    if (d.treasury_2y        != null) lines.push(`  2Y Treasury yield:    ${d.treasury_2y}%`);
    if (d.yield_spread       != null) lines.push(`  Yield curve (10Y-2Y): ${d.yield_spread}%${d.yield_spread < 0 ? " ⚠ INVERTED" : ""}`);
    if (d.gdp_growth         != null) lines.push(`  Real GDP growth:      ${d.gdp_growth}% annualised`);
    if (cpiYoy               != null) lines.push(`  CPI inflation:        ${cpiYoy}% YoY`);
    if (d.pce_yoy            != null) lines.push(`  PCE inflation:        ${d.pce_yoy}% YoY`);
    if (d.unemployment       != null) lines.push(`  Unemployment rate:    ${d.unemployment}%`);
    if (d.nonfarm_payrolls   != null) lines.push(`  Nonfarm payrolls:     +${d.nonfarm_payrolls}k MoM`);
    if (d.consumer_sentiment != null) lines.push(`  Consumer sentiment:   ${d.consumer_sentiment} (historical avg ~86 — ${d.consumer_sentiment < 70 ? "very weak" : d.consumer_sentiment < 80 ? "weak" : "moderate"})`);
    lines.push(`  Fed stance: ${d.fed_stance ?? "unknown"} | Inflation regime: ${d.inflation_regime ?? "unknown"} | Cycle: ${d.cycle_phase ?? "unknown"}`);
    lines.push(`  Key risk: ${d.key_risk ?? "not assessed"}`);
    lines.push(`  Macro sentiment avg: ${d.avg_score ?? ctx.macro_intel.score}/10`);
    if (d.scores?.length) {
      lines.push("News-derived sentiment scores:");
      for (const s of d.scores) {
        lines.push(`  ${s.aspect}: ${s.score > 0 ? "+" : ""}${s.score}/10 (${s.direction}) — ${s.commentary}`);
      }
    }
    lines.push(`Summary: ${ctx.macro_intel.summary}`);
    lines.push("");
  }

  // Geopolitical
  if (ctx.geo_intel) {
    const d = ctx.geo_intel.data ?? {};
    lines.push("── GEOPOLITICAL ENVIRONMENT ──");
    lines.push(`Risk level: ${d.risk_level ?? "moderate"} | Score: ${ctx.geo_intel.score}/10`);
    if (d.active_risks?.length) {
      lines.push("Active risks:");
      for (const r of d.active_risks) lines.push(`  • ${r}`);
    }
    if (d.exposed_sectors?.risk?.length)        lines.push(`Sectors at risk: ${d.exposed_sectors.risk.join(", ")}`);
    if (d.exposed_sectors?.opportunity?.length) lines.push(`Sector opportunities: ${d.exposed_sectors.opportunity.join(", ")}`);
    lines.push(ctx.geo_intel.summary);
    if (d.raw_events?.length) {
      lines.push("Top geopolitical events:");
      for (const e of d.raw_events.slice(0, 5)) {
        const date = new Date(e.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        lines.push(`  [${date}] impact:${(e.impact_score ?? 0).toFixed(1)} — ${e.headline}`);
      }
    }
    lines.push("");
  }

  // Sector momentum
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

  // Market sentiment
  if (ctx.sentiment_intel) {
    const d = ctx.sentiment_intel.data ?? {};
    lines.push("── MARKET SENTIMENT ──");
    lines.push(`Trend: ${d.market_trend ?? "unknown"} | Risk appetite: ${d.risk_appetite ?? "mixed"} | Volatility: ${d.vix_level ?? "moderate"}`);
    lines.push(`Score: ${d.score ?? ctx.sentiment_intel.score}/10`);
    lines.push(ctx.sentiment_intel.summary);
    lines.push("");
  }

  // Recent events
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

  // Style resolution: regime narrows the range, client preference picks within it
  const styleRanges: Record<string, string[]> = {
    aggressive:   ["growth", "speculative", "balanced"],
    moderate:     ["balanced", "growth", "defensive"],
    conservative: ["defensive", "income", "balanced"],
  };
  const regimeStyle     = ctx.regime_intel?.data?.style_bias ?? null;
  const allowedStyles   = styleRanges[riskAppetite] ?? ["balanced"];
  const resolvedStyle   = regimeStyle && allowedStyles.includes(regimeStyle)
    ? regimeStyle
    : allowedStyles[0];
  const styleGuidance   = regimeStyle
    ? `Regime recommends "${regimeStyle}". Client allows: ${allowedStyles.join(", ")}. RESOLVED style: "${resolvedStyle}" — use this unless you have strong justification to deviate.`
    : `Client risk allows: ${allowedStyles.join(", ")}.`;

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
    `STYLE:        ${styleGuidance}`,
    "",
    buildUniverseConstraint(p.universe ?? [], p.sector_exclude ?? []),
    `HORIZON:      ${horizonRules[horizon] ?? ""}`,
    `CASH:         cash_reserve_pct MUST be at least ${minCashPct}%.`,
    `ASSETS:       ${(p.preferred_assets ?? []).length > 0 ? `Client ONLY invests in: ${preferredAssets}.` : "All asset classes permitted."}`,
    `CONCENTRATION:Target ${targetHoldings} holdings — max_single_weight must not exceed ${maxPositionCap}%.`,
    `BENCHMARK:    ${benchmark}`,
    `CAPITAL:      $${totalCapital}`,
    "",
    buildIntelSection(ctx),
    "=== YOUR TASK ===",
    "",
    "Based on the market intelligence snapshot above, recommend an investment strategy.",
    "The snapshot contains real current data — use it as your primary source.",
    "Your recommendation MUST:",
    "1. Use the RESOLVED style above unless regime confidence < 50% — then justify any deviation",
    "2. Name specific risks from the snapshot — e.g. 'U.S.-Iran conflict', not 'geopolitical uncertainty'",
    "3. Reference specific macro scores — e.g. 'labour score -3/10', 'Fed funds 4.33%', not 'current conditions'",
    "4. Set sector_tilts consistent with favoured_sectors from the regime AND leading sectors from momentum data",
    "5. Set avoid_sectors consistent with regime avoid_sectors AND lagging sectors from momentum data",
    "6. Set cash_reserve_pct using regime cash_bias: low=5%, moderate=10%, elevated=15%, high=20%+",
    "FORBIDDEN: Do not write 'without access to specific data' or 'based on general patterns'.",
    "REQUIRED: Your rationale must cite at least 2 named indicators/events from the snapshot.",
    "",
    "Respond with ONLY the raw JSON object — no markdown, no fences, no text before or after:",
    "{",
    `  "style": "${resolvedStyle}",`,
    '  "cash_reserve_pct": 12,',
    '  "sector_tilts": ["Technology", "Healthcare"],',
    '  "avoid_sectors": ["Energy"],',
    '  "max_single_weight": 8,',
    '  "summary": "One headline sentence for this strategy",',
    '  "rationale": "3-4 sentences referencing specific data: Fed rate, active geopolitical risks, leading sectors",',
    '  "macro_context": "2-3 sentences on the macro/geopolitical factors that most influenced sector tilts and style"',
    "}",
  ].join("\n");
}

// ─── Data prompt ──────────────────────────────────────────────────────────────

function buildDataPrompt(p: any, ctx: IntelCtx): string {
  const riskAppetite    = p.risk_appetite      ?? "moderate";
  const horizon         = p.investment_horizon ?? "long";
  const minCashPct      = p.cash_pct            ?? 0;
  const targetHoldings  = p.target_holdings     ?? 15;
  const preferredAssets = (p.preferred_assets ?? []).join(", ") || "all";
  const benchmark       = p.benchmark           ?? "SPY";
  const maxPositionCap  = Math.round(100 / targetHoldings * 1.5);

  // Same style resolution as LLM mode
  const styleRanges: Record<string, string[]> = {
    aggressive:   ["growth", "speculative", "balanced"],
    moderate:     ["balanced", "growth", "defensive"],
    conservative: ["defensive", "income", "balanced"],
  };
  const regimeStyle   = ctx.regime_intel?.data?.style_bias ?? null;
  const allowedStyles = styleRanges[riskAppetite] ?? ["balanced"];
  const resolvedStyle = regimeStyle && allowedStyles.includes(regimeStyle)
    ? regimeStyle
    : allowedStyles[0];

  const horizonRules: Record<string, string> = {
    short:  "SHORT (<1yr): near-term catalysts only.",
    medium: "MEDIUM (1-3yr): balance momentum with fundamentals.",
    long:   "LONG (3+yr): compounders and structural themes.",
  };

  return [
    "You are an investment strategy advisor for a self-directed retail investor.",
    "",
    "=== CLIENT PROFILE ===",
    `Risk appetite:    ${riskAppetite} | Horizon: ${horizon} (${horizonRules[horizon] ?? ""})`,
    `Capital:          $${(p.total_capital ?? 0).toLocaleString()} | Benchmark: ${benchmark}`,
    `Min cash reserve: ${minCashPct}% | Target holdings: ${targetHoldings} | Max single: ${maxPositionCap}%`,
    `Preferred assets: ${preferredAssets}`,
    "",
    "=== STYLE GUIDANCE ===",
    regimeStyle
      ? `Regime recommends "${regimeStyle}". Client allows: ${allowedStyles.join(", ")}. RESOLVED: "${resolvedStyle}".`
      : `Client allows: ${allowedStyles.join(", ")}.`,
    "",
    buildUniverseConstraint(p.universe ?? [], p.sector_exclude ?? []),

    buildIntelSection(ctx),
    "=== YOUR TASK ===",
    "Based on the data above, recommend a strategy. Use the RESOLVED style.",
    `cash_reserve_pct must be at least ${minCashPct}%. Use regime cash_bias: low=5%, moderate=10%, elevated=15%, high=20%+.`,
    "sector_tilts: align with regime favoured_sectors + leading momentum sectors (1-3 sectors).",
    "avoid_sectors: align with regime avoid_sectors + lagging momentum sectors (0-2 sectors).",
    "Cite specific scores and events in rationale — no generic statements.",
    "FORBIDDEN: Do not write 'without access to specific data'.",
    "",
    "Respond with ONLY the raw JSON object — no markdown, no fences, no text before or after:",
    "{",
    `  "style": "${resolvedStyle}",`,
    '  "cash_reserve_pct": 10,',
    '  "sector_tilts": ["Technology", "Healthcare"],',
    '  "avoid_sectors": ["Energy"],',
    '  "max_single_weight": 10,',
    '  "summary": "One-line headline citing a specific macro or geopolitical factor",',
    '  "rationale": "2-3 sentences citing specific macro scores and named events from the snapshot",',
    '  "macro_context": "2-3 sentences on the macro/geopolitical factors that most influenced the strategy"',
    "}",
  ].join("\n");
}
