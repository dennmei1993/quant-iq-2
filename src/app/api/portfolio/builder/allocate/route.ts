// src/app/api/portfolio/builder/allocate/route.ts
//
// POST — for each selected theme, recommend tickers with BUY/WATCH signal and weight
// GET  ?portfolio_id=&themes=&strategy= — return assembled prompt for dev preview
//
// Output is a RECOMMENDATION — user decides which tickers to add via the
// RecommendationScreen. Nothing is written to holdings here.
//
// Data sources (in priority order):
//   1. theme_tickers — pre-mapped tickers for each theme
//   2. asset_signals — live fundamental + technical scores
//   3. market_intelligence — regime, sector momentum, geopolitical context
//   4. portfolio preferences — universe, sector_exclude, risk, horizon

import { NextRequest, NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/supabase";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { callLlm } from "@/lib/llm-caller";
import { logLlmStep } from "@/lib/builder-llm-logger";

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

// ─── Universe ticker whitelist ────────────────────────────────────────────────
// When a universe is set, only these tickers should appear in BUY recommendations

const UNIVERSE_TICKERS: Record<string, string[]> = {
  mag7:        ["AAPL", "MSFT", "GOOGL", "GOOG", "AMZN", "NVDA", "META", "TSLA"],
  nasdaq100:   [], // too many to list — use sector hint instead
  dow30:       ["AAPL", "MSFT", "AMZN", "UNH", "GS", "HD", "CAT", "SHW", "MCD", "V", "AMGN", "HON", "CRM", "TRV", "JPM", "AXP", "BA", "IBM", "MMM", "WMT", "JNJ", "MRK", "CVX", "KO", "PG", "NKE", "DIS", "VZ", "CSCO", "DOW"],
  dividend_aristocrats: [], // too many — LLM knows these
  sp500:       [], // too many — no restriction needed
  russell2000: [], // small cap — no restriction needed
};

function getUniverseTickerConstraint(universe: string[], sectorExclude: string[]): string {
  const lines: string[] = [];

  // Hard ticker whitelist for small named universes
  const hardLists = universe
    .filter(u => UNIVERSE_TICKERS[u]?.length > 0)
    .flatMap(u => UNIVERSE_TICKERS[u]);

  if (hardLists.length > 0) {
    const unique = [...new Set(hardLists)];
    lines.push("══ UNIVERSE — HARD TICKER CONSTRAINT ══");
    lines.push(`Only these tickers may appear as BUY recommendations: ${unique.join(", ")}`);
    lines.push("WATCH tickers may be from adjacent themes but must be noted as outside universe.");
    lines.push("If a theme has no eligible tickers from this list, mark all its tickers as WATCH.");
    lines.push("════════════════════════════════════════");
  } else if (universe.length > 0) {
    // Soft constraint — named universe but no explicit list
    lines.push("══ UNIVERSE CONSTRAINT ══");
    lines.push(`User invests in: ${universe.join(", ")}. Prefer tickers from this universe.`);
    lines.push("Tickers outside this universe should be WATCH only, not BUY.");
    lines.push("════════════════════════════════════");
  }

  if (sectorExclude.length > 0) {
    lines.push("══ EXCLUDED SECTORS — HARD STOP ══");
    lines.push(`Never recommend tickers from: ${sectorExclude.join(", ")}`);
    lines.push("Remove any such tickers from both BUY and WATCH.");
    lines.push("══════════════════════════════════");
  }

  return lines.join("\n");
}

// ─── Shared prompt assembly ────────────────────────────────────────────────────

async function assemblePrompt(
  userClient:    any,
  serviceClient: any,
  p:             any,
  strategy:      any,
  themes:        any[],
  held:          Set<string>,
  themeTickers:  any[],
  signalMap:     Map<string, any>,
  assetMap:      Map<string, any>,
): Promise<string> {

  const investable    = (p.total_capital ?? 0) * (1 - (strategy.cash_reserve_pct ?? 0) / 100);
  const universe      = p.universe       ?? [];
  const sectorExclude = p.sector_exclude ?? [];

  // Load market intelligence via service client
  const { data: intelRows } = await serviceClient
    .from("market_intelligence")
    .select("aspect, summary, data, score, sentiment, refreshed_at")
    .order("refreshed_at", { ascending: false });

  const intel       = new Map<string, any>((intelRows ?? []).map((r: any) => [r.aspect, r]));
  const regimeIntel = intel.get("regime");
  const sectorIntel = intel.get("sector_momentum");
  const geoIntel    = intel.get("geopolitical");

  const lines: string[] = [];

  lines.push("You are a portfolio construction advisor generating ticker recommendations.");
  lines.push("For each investment theme, select the best tickers and assign BUY or WATCH signals.");
  lines.push("This output is a RECOMMENDATION — the user will review and decide what to act on.");
  lines.push("");

  // ── Portfolio context ─────────────────────────────────────────────────────
  lines.push("=== PORTFOLIO CONTEXT ===");
  lines.push(`Style:             ${strategy.style}`);
  lines.push(`Risk appetite:     ${p.risk_appetite} | Horizon: ${p.investment_horizon}`);
  lines.push(`Investable:        $${Math.round(investable).toLocaleString()} (after ${strategy.cash_reserve_pct ?? 0}% cash reserve)`);
  lines.push(`Max single weight: ${strategy.max_single_weight}% of total investable`);
  lines.push(`Target holdings:   ${p.target_holdings ?? 15}`);
  if (held.size > 0) lines.push(`Already held (exclude from BUY): ${[...held].join(", ")}`);
  lines.push("");

  // ── Universe / sector constraints ─────────────────────────────────────────
  const universeConstraint = getUniverseTickerConstraint(universe, sectorExclude);
  if (universeConstraint) {
    lines.push(universeConstraint);
    // Add resolution note when regime and universe conflict
    if (universe.includes("mag7") && regimeIntel?.data?.avoid_sectors?.includes("Technology")) {
      lines.push("NOTE: Regime avoids Technology but Mag 7 universe forces it.");
      lines.push("Within Mag 7, prefer stable cash-flow names (MSFT, GOOGL, AMZN) over high-beta names (TSLA, META).");
      lines.push("Assign MSFT/GOOGL/AMZN higher BUY weights; consider TSLA/META as WATCH unless technically confirmed.");
      lines.push("");
    }
    lines.push("");
  }

  // ── Strategy context ──────────────────────────────────────────────────────
  lines.push("=== STRATEGY ===");
  lines.push(`Style:         ${strategy.style} | Summary: ${strategy.summary ?? "—"}`);
  lines.push(`Sector tilts:  ${strategy.sector_tilts?.join(", ") || "none"}`);
  lines.push(`Avoid sectors: ${strategy.avoid_sectors?.join(", ") || "none"}`);
  lines.push(`Rationale:     ${strategy.rationale ?? "—"}`);
  lines.push("");

  // ── Market regime ─────────────────────────────────────────────────────────
  if (regimeIntel?.data) {
    const r = regimeIntel.data;
    lines.push("=== MARKET REGIME ===");
    lines.push(`${r.label}`);
    lines.push(`Risk bias: ${r.risk_bias} | Cycle: ${r.cycle_phase} | Inflation: ${r.inflation_regime}`);
    lines.push(`Favoured sectors: ${r.favoured_sectors?.join(", ") ?? "—"}`);
    lines.push(`Avoid sectors:    ${r.avoid_sectors?.join(", ") ?? "—"}`);
    lines.push(`Rationale: ${r.rationale}`);
    lines.push("");
  }

  // ── Sector momentum ───────────────────────────────────────────────────────
  if (sectorIntel?.data) {
    const d = sectorIntel.data;
    lines.push("=== SECTOR MOMENTUM ===");
    // Only list as "leading" if BUY% > 0 to avoid misleading LLM
    const trulyLeading = (d.sectors ?? []).filter((s: any) => s.buy_pct > 0).map((s: any) => s.sector);
    const trulyLagging = (d.sectors ?? []).filter((s: any) => s.avoid_pct > 0).map((s: any) => s.sector);
    if (trulyLeading.length) lines.push(`Leading (BUY% > 0): ${trulyLeading.join(", ")}`);
    if (trulyLagging.length) lines.push(`Lagging (AVOID% > 0): ${trulyLagging.join(", ")}`);
    if (d.sectors?.length) {
      for (const s of d.sectors.slice(0, 6)) {
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
    if (d.active_risks?.length) lines.push(`Active risks: ${d.active_risks.slice(0, 3).join(" · ")}`);
    if (d.exposed_sectors?.opportunity?.length) lines.push(`Opportunities: ${d.exposed_sectors.opportunity.join(", ")}`);
    if (d.raw_events?.length) {
      for (const e of d.raw_events.slice(0, 3)) {
        const date = new Date(e.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        lines.push(`  [${date}] ${e.headline}`);
      }
    }
    lines.push("");
  }

  // ── Themes and their tickers ──────────────────────────────────────────────
  lines.push("=== THEMES AND AVAILABLE TICKERS ===");
  lines.push("For each theme, the tickers below are pre-mapped from the database.");
  lines.push("Select 2-4 tickers per theme. Assign BUY or WATCH based on signal quality.");
  lines.push("");

  for (const theme of themes) {
    const themeAlloc     = theme.suggested_allocation ?? 0;
    const themeCapital   = Math.round(investable * themeAlloc / 100);
    const tickers        = themeTickers
      .filter(tt => tt.theme_id === theme.id && !held.has(tt.ticker))
      .slice(0, 12);

    lines.push(`── ${theme.name} ──`);
    lines.push(`Allocation: ${themeAlloc}% = $${themeCapital.toLocaleString()}`);
    lines.push(`Theme fit: ${theme.fit_reason ?? theme.brief ?? "—"}`);

    if (tickers.length === 0) {
      lines.push("  (no pre-mapped tickers — use your knowledge of this theme's key stocks)");
    } else {
      lines.push("  Ticker | Name | Sector | DB Signal | F-score | T-score | Price | Theme rationale");
      for (const tt of tickers) {
        const sig   = signalMap.get(tt.ticker);
        const asset = assetMap.get(tt.ticker);
        const inUniverse = universe.length === 0 ||
          !UNIVERSE_TICKERS[universe[0]]?.length ||
          UNIVERSE_TICKERS[universe[0]]?.includes(tt.ticker);
        const universeTag = inUniverse ? "" : " [outside universe]";
        lines.push(
          `  ${tt.ticker}${universeTag} | ${asset?.name ?? "—"} | ${asset?.sector ?? "—"}` +
          ` | ${sig?.signal?.toUpperCase() ?? "NONE"}` +
          ` | F:${sig?.fundamental_score ?? "—"} T:${sig?.technical_score ?? "—"}` +
          ` | $${sig?.price_usd ?? "—"}` +
          ` | ${(tt.rationale ?? "").slice(0, 80)}`
        );
      }
    }
    lines.push("");
  }

  // ── Signal guide ─────────────────────────────────────────────────────────
  lines.push("=== SIGNAL GUIDE ===");
  lines.push("BUY:   Strong conviction — ticker fits style, sector aligned with regime/momentum, solid F+T scores.");
  lines.push("       Weight must respect max single position of " + strategy.max_single_weight + "% of total investable.");
  lines.push("WATCH: Good fundamentals but technical not confirmed, or secondary priority, or outside universe.");
  lines.push("       Weight = 0 (not deployed, just monitored).");
  lines.push("");
  lines.push("BUY weights within each theme must sum to 100 (representing % of that theme's capital).");
  lines.push("Tickers tagged [outside universe] should be WATCH only — never BUY.");
  lines.push("Tickers already held must not appear.");
  lines.push("");

  // ── Output format ─────────────────────────────────────────────────────────
  lines.push("=== OUTPUT ===");
  lines.push("Respond with ONLY the raw JSON object — no markdown, no fences, no text before or after:");
  lines.push("{");
  lines.push('  "tickers": [');
  lines.push('    {');
  lines.push('      "ticker": "NVDA",');
  lines.push('      "name": "NVIDIA Corp",');
  lines.push('      "theme_id": "exact-theme-uuid",');
  lines.push('      "theme_name": "AI Infrastructure & Semiconductors",');
  lines.push('      "signal": "BUY",');
  lines.push('      "weight": 60,');
  lines.push('      "rationale": "1-2 sentences citing a specific score or event from this prompt"');
  lines.push('    }');
  lines.push('  ]');
  lines.push("}");

  return lines.join("\n");
}

// ─── GET — prompt preview ─────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const portfolioId = req.nextUrl.searchParams.get("portfolio_id");
    const themesRaw   = req.nextUrl.searchParams.get("themes");
    const strategyRaw = req.nextUrl.searchParams.get("strategy");

    if (!portfolioId) return NextResponse.json({ error: "portfolio_id required" }, { status: 400 });

    const { data: raw } = await supabase
      .from("portfolios").select("*")
      .eq("id", portfolioId).eq("user_id", user.id).single();
    if (!raw) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });

    const themes   = themesRaw   ? JSON.parse(themesRaw)   : [];
    const strategy = strategyRaw ? JSON.parse(strategyRaw) : {
      style: "balanced", cash_reserve_pct: raw.cash_pct ?? 0,
      sector_tilts: [], avoid_sectors: [],
      max_single_weight: Math.round(100 / (raw.target_holdings ?? 15) * 1.5),
    };

    const serviceClient = createServiceClient();
    const themeIds      = themes.map((t: any) => t.id);

    const [{ data: existing }, { data: themeTickers }, { data: signals }, { data: assets }] =
      await Promise.all([
        supabase.from("holdings").select("ticker").eq("portfolio_id", portfolioId),
        serviceClient.from("theme_tickers")
          .select("ticker, theme_id, weight, conviction_pct, rationale")
          .in("theme_id", themeIds.length > 0 ? themeIds : ["_none_"])
          .order("weight", { ascending: false }),
        serviceClient.from("asset_signals")
          .select("ticker, signal, fundamental_score, technical_score, price_usd, rationale")
          .order("fundamental_score", { ascending: false }).limit(200),
        serviceClient.from("assets")
          .select("ticker, name, sector, asset_type").eq("is_active", true),
      ]);

    const held      = new Set((existing ?? []).map((h: any) => h.ticker));
    const signalMap = new Map((signals ?? []).map((s: any) => [s.ticker, s]));
    const assetMap  = new Map((assets  ?? []).map((a: any) => [a.ticker, a]));

    const prompt = await assemblePrompt(supabase, serviceClient, raw, strategy, themes, held, themeTickers ?? [], signalMap, assetMap);
    return NextResponse.json({ prompt });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}

// ─── POST — generate allocation recommendations ───────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const {
      portfolio_id,
      strategy,
      themes,
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
    const themeIds      = (themes as any[]).map(t => t.id);

    const [{ data: existing }, { data: themeTickers }, { data: signals }, { data: assets }] =
      await Promise.all([
        supabase.from("holdings").select("ticker").eq("portfolio_id", portfolio_id),
        serviceClient.from("theme_tickers")
          .select("ticker, theme_id, weight, conviction_pct, rationale")
          .in("theme_id", themeIds)
          .order("weight", { ascending: false }),
        serviceClient.from("asset_signals")
          .select("ticker, signal, fundamental_score, technical_score, price_usd, rationale")
          .order("fundamental_score", { ascending: false }).limit(200),
        serviceClient.from("assets")
          .select("ticker, name, sector, asset_type").eq("is_active", true),
      ]);

    const held      = new Set((existing ?? []).map(h => h.ticker));
    const signalMap = new Map((signals  ?? []).map(s => [s.ticker, s]));
    const assetMap  = new Map((assets   ?? []).map(a => [a.ticker, a]));

    const assembledPrompt = await assemblePrompt(
      supabase, serviceClient, p, strategy, themes,
      held, themeTickers ?? [], signalMap, assetMap
    );
    const prompt = prompt_override ?? assembledPrompt;

    const llmStart  = Date.now();
    const llmResult = await callLlm({ provider, model_id, prompt, max_tokens: 2000 });
    await logLlmStep({ supabase, run_id, step: "allocation", prompt, response: llmResult, started_at: llmStart });

    const result = extractJson(llmResult.text);

    // Enrich with live data — DB values are authoritative for name, sector, scores
    const enriched = (result.tickers as any[]).map(t => ({
      ...t,
      price:             signalMap.get(t.ticker)?.price_usd         ?? null,
      name:              assetMap.get(t.ticker)?.name               ?? t.name ?? t.ticker,
      fundamental_score: signalMap.get(t.ticker)?.fundamental_score ?? null,
      technical_score:   signalMap.get(t.ticker)?.technical_score   ?? null,
      db_signal:         signalMap.get(t.ticker)?.signal            ?? null,
      db_rationale:      signalMap.get(t.ticker)?.rationale         ?? null,
    }));

    return NextResponse.json({
      tickers: enriched,
      prompt:  assembledPrompt,
    });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}
