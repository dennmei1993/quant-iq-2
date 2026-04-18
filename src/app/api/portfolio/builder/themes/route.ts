// src/app/api/portfolio/builder/themes/route.ts
//
// POST — recommend themes from DB that fit the portfolio strategy
// GET  ?portfolio_id=&strategy=  — return assembled prompt for dev preview (no LLM call)
//
// Data-driven: Claude selects from themes already in the DB, ranked by fit
// against the strategy + market intelligence snapshot.
// LLM provides narrative (fit_reason, conviction adjustment) — not free-form theme invention.

import { NextRequest, NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/supabase";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { callLlm } from "@/lib/llm-caller";
import { logLlmStep } from "@/lib/builder-llm-logger";

// Service client for global tables (market_intelligence has RLS blocking user client)
function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
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

// ─── Style → theme constraint rules ──────────────────────────────────────────

const STYLE_THEME_RULES: Record<string, { favour: string; avoid: string }> = {
  growth:      { favour: "momentum, technology, AI, innovation, high-growth sectors",            avoid: "bond, utility, REIT, dividend-income, or capital-preservation themes" },
  balanced:    { favour: "a mix of growth and stable themes — no extreme concentration",          avoid: "purely speculative crypto/small-cap OR purely defensive income themes" },
  defensive:   { favour: "consumer staples, utilities, healthcare, infrastructure, low-beta",     avoid: "crypto, small-cap, speculative, high-volatility, or unprofitable-growth themes" },
  income:      { favour: "dividend-paying, REIT, infrastructure, yield-generating themes",        avoid: "pure growth/momentum themes with no yield component" },
  speculative: { favour: "high-conviction bets, crypto, small-cap, emerging tech, concentrated", avoid: "conservative, income, or capital-preservation themes" },
};

// ─── Universe → sector scope hint ────────────────────────────────────────────

const UNIVERSE_SECTORS: Record<string, string[]> = {
  mag7:                 ["Technology", "Consumer Discretionary"],
  nasdaq100:            ["Technology", "Consumer Discretionary", "Healthcare", "Communications"],
  dividend_aristocrats: ["Consumer Staples", "Industrials", "Healthcare", "Financials"],
  berkshire:            ["Financials", "Technology", "Consumer Staples", "Energy"],
  asx200:               ["Financials", "Materials", "Energy", "Healthcare"],
};

// Ticker/brand keywords that confirm a theme is within a universe
// Must be specific enough to avoid false positives
const UNIVERSE_THEME_KEYWORDS: Record<string, string[]> = {
  // Mag 7: only match themes explicitly naming these companies or their core businesses
  mag7:                 ["nvda", "nvidia", "msft", "microsoft", "googl", "google", "amzn", "amazon", "meta", "aapl", "apple", "tsla", "tesla", "saas", "cloud & enterprise", "consumer internet", "digital advertising", "autonomous & electric", "ai infrastructure"],
  // Nasdaq 100: broader tech but still named companies or clearly tech-focused themes
  nasdaq100:            ["nvda", "nvidia", "msft", "microsoft", "googl", "google", "amzn", "amazon", "meta", "aapl", "apple", "tsla", "tesla", "crwd", "panw", "semiconductor", "biotech", "saas", "cloud", "cybersecurity", "software"],
  // Dividend aristocrats: named dividend-focused themes only
  dividend_aristocrats: ["dividend compounders", "consumer staples", "dividend", "compounder", "jnj", "ko", "pep", "pg"],
  // Berkshire: explicitly Berkshire-adjacent companies
  berkshire:            ["berkshire", "brk", "bac", "axp", "ko", "cvx", "oxy", "aapl", "apple", "insurance & capital"],
  // ASX 200: Australian market names
  asx200:               ["asx", "australian", "bhp", "rio", "cba", "anz", "nab", "westpac", "macquarie"],
  // ETF categories — match by theme description
  broad_etf:            [],
  sector_etf:           [],
  dividend_etf:         ["dividend compounders", "dividend etf", "covered calls", "high yield", "income"],
  commodity_etf:        ["gold & inflation", "commodities & materials", "traditional energy", "oil"],
  global_etf:           ["emerging markets", "japanese equities", "international"],
  thematic_etf:         ["ai infrastructure", "cybersecurity", "autonomous & electric", "clean energy", "data centre"],
  crypto_etf:           ["crypto", "bitcoin", "coin", "mstr", "mara"],
};

function getUniverseSectorHint(universe: string[]): string {
  if (universe.length === 0) return "";
  const restricted = universe.filter(u => UNIVERSE_SECTORS[u]?.length > 0);
  if (restricted.length === 0) return "";
  const sectors = [...new Set(restricted.flatMap(u => UNIVERSE_SECTORS[u]))];
  return `Universe scope implies these sectors: ${sectors.join(", ")}. Prefer themes within this scope.`;
}

function scoreThemeForUniverse(theme: any, universe: string[]): number {
  if (universe.length === 0) return 0;
  const text = `${theme.name} ${theme.brief ?? ""}`.toLowerCase();
  let score = 0;
  for (const u of universe) {
    const keywords = UNIVERSE_THEME_KEYWORDS[u] ?? [];
    for (const kw of keywords) {
      // Use word-boundary matching to avoid substring false positives
      // e.g. "meta" should not match inside "materials"
      // Multi-word phrases use simple includes; single words use \b boundary
      const isPhrase = kw.includes(" ") || kw.includes("&");
      if (isPhrase) {
        if (text.includes(kw)) score++;
      } else {
        // Word boundary: preceded and followed by non-alphanumeric or string edge
        const re = new RegExp(`(?<![a-z0-9])${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`);
        if (re.test(text)) score++;
      }
    }
  }
  return score;
}

// ─── Shared prompt assembly ────────────────────────────────────────────────────

async function assemblePrompt(
  userClient:    any,
  serviceClient: any,
  p:             any,
  strategy:      any,
  themes:        any[],
): Promise<string> {

  // Load market intelligence via service client (bypasses RLS)
  const { data: intelRows, error: intelErr } = await serviceClient
    .from("market_intelligence")
    .select("aspect, summary, data, score, sentiment, refreshed_at")
    .order("refreshed_at", { ascending: false });

  if (intelErr) console.error("[themes] market_intelligence read error:", intelErr.message);

  const intel       = new Map<string, any>((intelRows ?? []).map((r: any) => [r.aspect, r]));
  const regimeIntel = intel.get("regime");
  const geoIntel    = intel.get("geopolitical");
  const sectorIntel = intel.get("sector_momentum");
  const eventsIntel = intel.get("recent_events");
  const macroIntel  = intel.get("macro_indicators");

  const latestRow   = [...intel.values()].sort(
    (a, b) => new Date(b.refreshed_at).getTime() - new Date(a.refreshed_at).getTime()
  )[0];
  const refreshedAt = latestRow?.refreshed_at
    ? new Date(latestRow.refreshed_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "unknown";

  const styleRules      = STYLE_THEME_RULES[strategy.style ?? "balanced"] ?? STYLE_THEME_RULES["balanced"];
  const investable      = Math.round((p.total_capital ?? 0) * (1 - (strategy.cash_reserve_pct ?? 0) / 100));
  const universe        = p.universe       ?? [];
  const sectorExclude   = p.sector_exclude ?? [];
  const universeSectorHint = getUniverseSectorHint(universe);

  const lines: string[] = [];

  lines.push("You are an investment strategy advisor selecting investment themes from a database.");
  lines.push("Your role is to rank and select themes that best match the portfolio strategy,");
  lines.push("market regime, and client constraints — then explain WHY each theme fits.");
  lines.push("");

  // ── Client profile ───────────────────────────────────────────────────────
  lines.push("=== CLIENT PORTFOLIO ===");
  lines.push(`Risk appetite:     ${p.risk_appetite}`);
  lines.push(`Investment horizon:${p.investment_horizon}`);
  lines.push(`Total capital:     $${(p.total_capital ?? 0).toLocaleString()}`);
  lines.push(`Investable:        $${investable.toLocaleString()} (after ${strategy.cash_reserve_pct ?? 0}% cash reserve)`);
  lines.push(`Target holdings:   ${p.target_holdings ?? 15}`);
  lines.push(`Preferred assets:  ${(p.preferred_assets ?? []).join(", ") || "all"}`);
  if (universe.length > 0)      lines.push(`Universe:          ${universe.join(", ")}`);
  if (sectorExclude.length > 0) lines.push(`Excluded sectors:  ${sectorExclude.join(", ")} — NEVER recommend themes in these sectors`);
  if (universeSectorHint)        lines.push(`Universe scope:    ${universeSectorHint}`);
  lines.push("");

  // ── Strategy ─────────────────────────────────────────────────────────────
  lines.push("=== STRATEGY (from previous step) ===");
  lines.push(`Style:             ${strategy.style}`);
  lines.push(`Summary:           ${strategy.summary ?? "—"}`);
  lines.push(`Sector tilts:      ${strategy.sector_tilts?.join(", ") || "none"}`);
  lines.push(`Avoid sectors:     ${strategy.avoid_sectors?.join(", ") || "none"}`);
  lines.push(`Max single weight: ${strategy.max_single_weight}%`);
  lines.push(`Rationale:         ${strategy.rationale ?? "—"}`);
  if (strategy.macro_context) lines.push(`Macro context:     ${strategy.macro_context}`);
  lines.push("");

  // ── Style constraints ─────────────────────────────────────────────────────
  lines.push("=== STYLE CONSTRAINTS — NON-NEGOTIABLE ===");
  lines.push(`Strategy style: "${strategy.style}"`);
  lines.push(`FAVOUR themes that are: ${styleRules.favour}`);
  lines.push(`AVOID themes that are:  ${styleRules.avoid}`);
  if (strategy.sector_tilts?.length)  lines.push(`Sector tilts (${strategy.sector_tilts.join(", ")}) MUST be reflected — prefer themes in these sectors.`);
  if (strategy.avoid_sectors?.length) lines.push(`Avoid sectors (${strategy.avoid_sectors.join(", ")}) MUST NOT appear in selected themes.`);
  if (sectorExclude.length > 0)       lines.push(`Client excluded sectors (${sectorExclude.join(", ")}) are a HARD STOP — no exceptions regardless of regime.`);
  lines.push("");

  // ── Market regime ─────────────────────────────────────────────────────────
  if (regimeIntel?.data) {
    const r = regimeIntel.data;
    lines.push(`=== MARKET REGIME (refreshed: ${refreshedAt}) ===`);
    lines.push(`Label:            ${r.label}`);
    lines.push(`Cycle phase:      ${r.cycle_phase} | Growth: ${r.growth_trajectory} | Inflation: ${r.inflation_regime}`);
    lines.push(`Risk bias:        ${r.risk_bias} | Monetary: ${r.monetary_stance}`);
    lines.push(`Favoured sectors: ${r.favoured_sectors?.join(", ") ?? "—"}`);
    lines.push(`Avoid sectors:    ${r.avoid_sectors?.join(", ") ?? "—"}`);
    lines.push(`Confidence:       ${r.confidence}%`);
    lines.push(`Rationale:        ${r.rationale}`);
    lines.push("");
  }

  // ── Sector momentum ───────────────────────────────────────────────────────
  if (sectorIntel?.data) {
    const d = sectorIntel.data;
    lines.push("=== SECTOR MOMENTUM (from signal database) ===");
    if (d.leading?.length) lines.push(`Leading (high BUY signal): ${d.leading.join(", ")}`);
    if (d.lagging?.length) lines.push(`Lagging (high AVOID signal): ${d.lagging.join(", ")}`);
    if (d.sectors?.length) {
      lines.push("Breakdown:");
      for (const s of d.sectors.slice(0, 8)) {
        lines.push(`  ${s.sector}: BUY ${s.buy_pct}% | AVOID ${s.avoid_pct}% | F:${s.f_avg} T:${s.t_avg}`);
      }
    }
    lines.push("");
  }

  // ── Geopolitical ──────────────────────────────────────────────────────────
  if (geoIntel?.data) {
    const d = geoIntel.data;
    lines.push("=== GEOPOLITICAL CONTEXT ===");
    lines.push(`Risk level: ${d.risk_level ?? "moderate"} | Score: ${geoIntel.score}/10`);
    if (d.active_risks?.length)                 lines.push(`Active risks: ${d.active_risks.join(" · ")}`);
    if (d.exposed_sectors?.risk?.length)        lines.push(`Sectors at risk: ${d.exposed_sectors.risk.join(", ")}`);
    if (d.exposed_sectors?.opportunity?.length) lines.push(`Sector opportunities: ${d.exposed_sectors.opportunity.join(", ")}`);
    lines.push(geoIntel.summary);
    if (d.raw_events?.length) {
      lines.push("Key events:");
      for (const e of d.raw_events.slice(0, 4)) {
        const date = new Date(e.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        lines.push(`  [${date}] impact:${(e.impact_score ?? 0).toFixed(1)} — ${e.headline}`);
      }
    }
    lines.push("");
  }

  // ── Macro snapshot ────────────────────────────────────────────────────────
  if (macroIntel?.data) {
    const d = macroIntel.data;
    lines.push("=== MACRO SNAPSHOT ===");
    if (d.fed_funds_rate     != null) lines.push(`  Fed funds: ${d.fed_funds_rate}%`);
    if (d.gdp_growth         != null) lines.push(`  GDP growth: ${d.gdp_growth}% ann.`);
    if (d.consumer_sentiment != null) lines.push(`  Consumer sentiment: ${d.consumer_sentiment} (avg ~86)`);
    lines.push(`  Key risk: ${d.key_risk ?? "—"}`);
    lines.push(`  Summary: ${macroIntel.summary.slice(0, 250)}`);
    lines.push("");
  }

  // ── Recent events ─────────────────────────────────────────────────────────
  if (eventsIntel?.data?.top_events_text) {
    lines.push("=== RECENT HIGH-IMPACT EVENTS ===");
    lines.push(eventsIntel.data.top_events_text.slice(0, 800));
    lines.push("");
  }

  // ── Available themes ──────────────────────────────────────────────────────
  // Sort themes by universe relevance when universe is set
  const sortedThemes = universe.length > 0
    ? [...themes].sort((a, b) => scoreThemeForUniverse(b, universe) - scoreThemeForUniverse(a, universe))
    : themes;

  // Detect universe mismatch
  const hasUniverseRelevantThemes = universe.length === 0 ||
    sortedThemes.some(t => scoreThemeForUniverse(t, universe) > 0);

  lines.push("=== AVAILABLE THEMES FROM DATABASE ===");
  lines.push("These are the ONLY themes you may recommend. Do NOT invent new themes.");
  lines.push("Use theme IDs exactly as shown — do not modify or truncate them.");

  if (universe.length > 0) {
    if (hasUniverseRelevantThemes) {
      lines.push(`Themes most relevant to universe (${universe.join(", ")}) are listed first.`);
    } else {
      lines.push(`⚠ UNIVERSE MISMATCH: No themes directly match the user's universe (${universe.join(", ")}).`);
      lines.push("Select the most defensive/low-risk themes available and note in fit_reason");
      lines.push("that these are the closest available options given the constrained universe.");
      lines.push("Do NOT recommend themes whose primary tickers are outside the user's investable universe.");
    }
  }
  lines.push("");
  for (const t of sortedThemes) {
    const relevanceScore = universe.length > 0 ? scoreThemeForUniverse(t, universe) : -1;
    const tag = relevanceScore > 0 ? " ★" : relevanceScore === 0 && universe.length > 0 ? " (outside universe scope)" : "";
    lines.push(`  ID:${t.id} | ${t.name} [${t.theme_type}] conviction:${t.conviction}% momentum:${t.momentum ?? "stable"}${tag} | ${t.brief ?? ""}`);
  }
  lines.push("");

  // ── Task ─────────────────────────────────────────────────────────────────
  lines.push("=== YOUR TASK ===");
  lines.push("Select 3-6 themes from the database above that best fit the strategy and market context.");
  lines.push("");
  lines.push("Rules:");
  lines.push("1. Only use IDs from the database list — any unknown ID will be discarded.");
  lines.push("2. fit_reason MUST cite a specific data point from this prompt:");
  lines.push("   GOOD: 'Energy leads sector momentum at 67% BUY signal, supported by Hormuz blockade driving oil prices'");
  lines.push("   BAD:  'This theme aligns well with current market conditions'");
  lines.push("3. conviction: your adjusted % based on current regime fit (may differ from DB value)");
  lines.push(`4. suggested_allocation: % of investable capital. All themes must sum to ~100%.`);
  lines.push(`5. Investable: $${investable.toLocaleString()} — weight higher-conviction, regime-aligned themes more.`);
  if (sectorExclude.length > 0) {
    lines.push(`6. HARD STOP: Do not select any theme that operates in ${sectorExclude.join(", ")}.`);
  }
  lines.push("");
  lines.push("Respond with ONLY the raw JSON object — no markdown, no fences, no text before or after:");
  lines.push("{");
  lines.push('  "themes": [');
  lines.push('    {');
  lines.push('      "id": "exact-uuid-from-database-above",');
  lines.push('      "name": "Exact name from database — do not alter",');
  lines.push('      "brief": "Brief from database",');
  lines.push('      "conviction": 82,');
  lines.push('      "momentum": "rising",');
  lines.push('      "fit_reason": "1-2 sentences citing a specific named event or score from this prompt",');
  lines.push('      "suggested_allocation": 30');
  lines.push('    }');
  lines.push('  ]');
  lines.push("}");

  return lines.join("\n");
}

// ─── GET — return assembled prompt for dev preview ────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const portfolioId = req.nextUrl.searchParams.get("portfolio_id");
    const strategyRaw = req.nextUrl.searchParams.get("strategy");

    if (!portfolioId) return NextResponse.json({ error: "portfolio_id required" }, { status: 400 });

    const { data: raw } = await supabase
      .from("portfolios").select("*")
      .eq("id", portfolioId).eq("user_id", user.id).single();
    if (!raw) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });

    const strategy = strategyRaw ? JSON.parse(strategyRaw) : {
      style:             raw.risk_appetite === "conservative" ? "defensive" : raw.risk_appetite === "aggressive" ? "growth" : "balanced",
      cash_reserve_pct:  raw.cash_pct ?? 0,
      sector_tilts:      [],
      avoid_sectors:     [],
      max_single_weight: Math.round(100 / (raw.target_holdings ?? 15) * 1.5),
      summary:           "(strategy not yet generated — using portfolio defaults)",
      rationale:         "(strategy not yet generated)",
    };

    const serviceClient = createServiceClient();
    const { data: themes } = await serviceClient
      .from("themes")
      .select("id, name, brief, conviction, momentum, theme_type, timeframe")
      .eq("is_active", true)
      .order("conviction", { ascending: false })
      .limit(25);

    const prompt = await assemblePrompt(supabase, serviceClient, raw, strategy, themes ?? []);
    return NextResponse.json({ prompt });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}

// ─── POST — generate theme recommendations ────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const {
      portfolio_id,
      strategy,
      run_id        = null,
      provider      = "claude",
      model_id,
      prompt_override,
    } = await req.json();

    const { data: raw } = await supabase
      .from("portfolios").select("*")
      .eq("id", portfolio_id).eq("user_id", user.id).single();
    if (!raw) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
    const p = raw as any;

    const serviceClient = createServiceClient();

    const { data: themes } = await serviceClient
      .from("themes")
      .select("id, name, brief, conviction, momentum, theme_type, timeframe")
      .eq("is_active", true)
      .order("conviction", { ascending: false })
      .limit(25);

    if (!themes?.length) return NextResponse.json({ themes: [] });

    const assembledPrompt = await assemblePrompt(supabase, serviceClient, p, strategy, themes);
    const prompt          = prompt_override ?? assembledPrompt;

    const llmStart  = Date.now();
    const llmResult = await callLlm({ provider, model_id, prompt, max_tokens: 1500 });
    await logLlmStep({ supabase, run_id, step: "themes", prompt, response: llmResult, started_at: llmStart });

    const result = extractJson(llmResult.text);

    // DB fields are authoritative — LLM only contributes fit_reason, conviction, allocation
    const themeMap = new Map(themes.map(t => [t.id, t]));
    const merged = (result.themes as any[])
      .filter(t => themeMap.has(t.id))  // discard hallucinated IDs
      .map(t => ({
        ...themeMap.get(t.id),
        fit_reason:           t.fit_reason,
        suggested_allocation: t.suggested_allocation,
        conviction:           t.conviction,
        selected:             true,
      }));

    return NextResponse.json({
      themes: merged,
      prompt: assembledPrompt,
    });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}