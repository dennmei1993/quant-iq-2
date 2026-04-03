// src/app/api/portfolio/generate/route.ts
//
// POST /api/portfolio/generate
//
// Uses Claude to generate a portfolio based on preferences, macro scores,
// active themes, and available asset signals.
//
// BUY tickers  → inserted into holdings with quantity + avg_cost from live price
// WATCH tickers → inserted into user_watchlist
// AVOID tickers → inserted into user_watchlist (for awareness)
//
// Respects cash_pct as a minimum cash reserve floor when allocating weights.

import { NextRequest, NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/supabase";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

interface GeneratedHolding {
  ticker:    string;
  signal:    "BUY" | "WATCH" | "AVOID";
  weight:    number;   // % of investable capital — only meaningful for BUY
  rationale: string;
}

interface GenerateResponse {
  holdings:  GeneratedHolding[];
  rationale: string;
  warnings:  string[];
}

// ----------------------------------------------------------------------------
// POST
// ----------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const { portfolio_id } = await req.json();

    if (!portfolio_id) {
      return NextResponse.json({ error: "portfolio_id is required" }, { status: 400 });
    }

    // ── Load portfolio ────────────────────────────────────────────────────────
    // Cast through unknown: generated supabase.ts predates migration_portfolios_preferences.sql.
    // Remove cast once migration is run and types are regenerated.
    const { data: portfolioRaw, error: pErr } = await supabase
      .from("portfolios")
      .select("*")
      .eq("id", portfolio_id)
      .eq("user_id", user.id)
      .single();

    if (pErr || !portfolioRaw) {
      return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
    }

    const portfolio = portfolioRaw as unknown as {
      id:                 string;
      user_id:            string;
      name:               string;
      risk_appetite:      string;
      benchmark:          string;
      target_holdings:    number;
      preferred_assets:   string[];
      cash_pct:           number;
      investment_horizon: string;
      total_capital:      number;
    };

    // ── Load context data in parallel ─────────────────────────────────────────
    const [
      { data: assets },
      { data: signals },
      { data: themes },
      { data: macroScores },
      { data: existingHoldings },
      { data: existingWatchlist },
    ] = await Promise.all([
      supabase
        .from("assets")
        .select("ticker, name, sector, asset_type, pe_ratio, analyst_rating, market_cap_tier")
        .eq("is_active", true)
        .order("bootstrap_priority", { ascending: true })
        .limit(200),

      // Fetch BUY/WATCH/AVOID signals — we need price_usd for quantity calc
      supabase
        .from("asset_signals")
        .select("ticker, signal, fundamental_score, technical_score, price_usd, rationale")
        .in("signal", ["buy", "watch", "avoid"])
        .order("fundamental_score", { ascending: false })
        .limit(100),

      supabase
        .from("themes")
        .select("name, brief, conviction, momentum, theme_type")
        .eq("is_active", true)
        .order("conviction", { ascending: false })
        .limit(10),

      supabase
        .from("macro_scores")
        .select("aspect, score, direction, commentary")
        .order("scored_at", { ascending: false })
        .limit(6),

      supabase
        .from("holdings")
        .select("ticker")
        .eq("portfolio_id", portfolio_id),

      supabase
        .from("user_watchlist")
        .select("ticker")
        .eq("user_id", user.id),
    ]);

    // Build lookup sets for deduplication
    const existingHoldingTickers  = new Set(
      (existingHoldings ?? []).map(h => h.ticker).filter(t => t !== "CASH")
    );
    const existingWatchlistTickers = new Set(
      (existingWatchlist ?? []).map(w => w.ticker)
    );

    // Build price map from signals for quantity calculation
    const priceMap = new Map<string, number>(
      (signals ?? [])
        .filter(s => s.price_usd != null)
        .map(s => [s.ticker, s.price_usd as number])
    );

    // Filter candidate signals — exclude already held
    const candidateSignals = (signals ?? []).filter(
      s => !existingHoldingTickers.has(s.ticker)
    );

    // Filter assets by preferred types
    const preferredTypes: string[] = portfolio.preferred_assets ?? [];
    const candidateAssets = (assets ?? []).filter(a =>
      preferredTypes.length === 0 || preferredTypes.includes(a.asset_type)
    );

    // Capital calculations
    const cashFloorPct    = portfolio.cash_pct ?? 0;
    const totalCapital    = portfolio.total_capital ?? 0;
    const cashFloorAmount = totalCapital * (cashFloorPct / 100);
    const investable      = totalCapital - cashFloorAmount;
    const targetBuys      = portfolio.target_holdings ?? 15;

    // ── Build prompt ──────────────────────────────────────────────────────────
    const prompt = `You are a portfolio construction assistant for a self-directed retail investor.

PORTFOLIO PREFERENCES:
- Risk appetite: ${portfolio.risk_appetite}
- Investment horizon: ${portfolio.investment_horizon}
- Benchmark: ${portfolio.benchmark}
- Target holdings (BUY): ${targetBuys}
- Total capital: $${totalCapital.toLocaleString()}
- Minimum cash reserve: ${cashFloorPct}% ($${cashFloorAmount.toLocaleString()})
- Investable capital: $${investable.toLocaleString()} (${100 - cashFloorPct}% of total)
- Preferred asset types: ${preferredTypes.length > 0 ? preferredTypes.join(", ") : "all types"}

CURRENT MACRO ENVIRONMENT:
${(macroScores ?? []).map(m =>
  `- ${m.aspect}: ${m.score > 0 ? "+" : ""}${m.score}/10 (${m.direction}) — ${m.commentary}`
).join("\n")}

ACTIVE INVESTMENT THEMES:
${(themes ?? []).map(t =>
  `- ${t.name} [conviction: ${t.conviction}%] — ${t.brief ?? ""}`
).join("\n") || "None available"}

SIGNAL UNIVERSE (excluding already held tickers):
BUY signals:
${candidateSignals.filter(s => s.signal === "buy").slice(0, 30).map(s =>
  `- ${s.ticker}: F:${s.fundamental_score ?? "?"} T:${s.technical_score ?? "?"} price:$${s.price_usd ?? "?"} | ${s.rationale?.slice(0, 80) ?? ""}`
).join("\n") || "None"}

WATCH signals:
${candidateSignals.filter(s => s.signal === "watch").slice(0, 20).map(s =>
  `- ${s.ticker}: F:${s.fundamental_score ?? "?"} T:${s.technical_score ?? "?"} price:$${s.price_usd ?? "?"}`
).join("\n") || "None"}

AVOID signals:
${candidateSignals.filter(s => s.signal === "avoid").slice(0, 10).map(s =>
  `- ${s.ticker}: F:${s.fundamental_score ?? "?"} T:${s.technical_score ?? "?"}`
).join("\n") || "None"}

AVAILABLE ASSET UNIVERSE (filtered by preferences):
${candidateAssets.slice(0, 60).map(a =>
  `- ${a.ticker} (${a.asset_type}, ${a.sector ?? "—"}, ${a.market_cap_tier ?? "—"}, analyst: ${a.analyst_rating ?? "—"})`
).join("\n")}

ALREADY IN HOLDINGS (exclude from all selections):
${existingHoldingTickers.size > 0 ? [...existingHoldingTickers].join(", ") : "None"}

INSTRUCTIONS:
1. Select exactly ${targetBuys} BUY tickers for the portfolio.
   - These are high-conviction positions to invest in now.
   - Weights must sum to 100 (% of investable capital of $${investable.toLocaleString()}).
   - Prioritise BUY signal tickers aligned with active themes and macro environment.
   - Diversify across sectors and asset types per preferences.
   - Risk: ${portfolio.risk_appetite === "aggressive" ? "lean toward growth and momentum" : portfolio.risk_appetite === "conservative" ? "prefer dividend-paying, low-beta, defensive" : "balanced growth and stability"}
   - Horizon: ${portfolio.investment_horizon === "short" ? "near-term catalysts and momentum" : portfolio.investment_horizon === "long" ? "quality fundamentals and compounding" : "balance near and long-term"}

2. Select 3-5 WATCH tickers to monitor.
   - These are good fundamentals but not yet ready to buy (technical not confirmed).
   - No weight needed — just select and provide a rationale.

3. Select 2-3 AVOID tickers as awareness signals.
   - These are positions to be aware of and avoid for now.
   - No weight needed.

4. Do NOT include CASH as a ticker.
5. Do NOT include tickers already in holdings.

Respond ONLY with valid JSON, no markdown, no preamble:
{
  "holdings": [
    { "ticker": "AAPL", "signal": "BUY",   "weight": 8.5, "rationale": "one sentence" },
    { "ticker": "TSLA", "signal": "WATCH", "weight": 0,   "rationale": "one sentence" },
    { "ticker": "XYZ",  "signal": "AVOID", "weight": 0,   "rationale": "one sentence" }
  ],
  "rationale": "2-3 sentence overall portfolio rationale",
  "warnings": ["any concern about concentration, missing diversification, etc."]
}`;

    // ── Call Claude ───────────────────────────────────────────────────────────
    const message = await anthropic.messages.create({
      model:      "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages:   [{ role: "user", content: prompt }],
    });

    const rawText = message.content
      .filter(b => b.type === "text")
      .map(b => (b as { type: "text"; text: string }).text)
      .join("");

    let parsed: GenerateResponse;
    try {
      const clean = rawText.replace(/```json|```/g, "").trim();
      parsed = JSON.parse(clean);
    } catch {
      console.error("Failed to parse Claude response:", rawText);
      return NextResponse.json(
        { error: "AI returned an unexpected format. Please try again." },
        { status: 500 }
      );
    }

    const validTickers = new Set((assets ?? []).map(a => a.ticker));

    // Partition by signal
    const buyHoldings   = parsed.holdings.filter(h => h.signal === "BUY"   && validTickers.has(h.ticker));
    const watchTickers  = parsed.holdings.filter(h => h.signal === "WATCH" && validTickers.has(h.ticker));
    const avoidTickers  = parsed.holdings.filter(h => h.signal === "AVOID" && validTickers.has(h.ticker));

    // ── Insert BUY tickers into holdings ─────────────────────────────────────
    // quantity = floor((weight/100 × investable) / price), avg_cost = live price
    let insertedHoldings = 0;
    if (buyHoldings.length > 0) {
      const assetMeta = new Map(
        (candidateAssets ?? []).map(a => [a.ticker, a])
      );

      const holdingRows = buyHoldings.map(h => {
        const price    = priceMap.get(h.ticker) ?? null;
        const capital  = (h.weight / 100) * investable;
        const quantity = price && price > 0
          ? Math.floor(capital / price)
          : null;

        return {
          portfolio_id: portfolio_id,
          ticker:       h.ticker,
          avg_cost:     price,           // latest price as cost basis
          quantity:     quantity,        // whole shares/units
          name:         assetMeta.get(h.ticker)?.name       ?? null,
          asset_type:   assetMeta.get(h.ticker)?.asset_type ?? null,
          notes:        h.rationale,
        };
      });

      const { error: holdingsErr } = await supabase
        .from("holdings")
        .insert(holdingRows);

      if (holdingsErr) throw holdingsErr;
      insertedHoldings = holdingRows.length;
    }

    // ── Insert WATCH + AVOID into watchlist ───────────────────────────────────
    // Deduplicate against existing watchlist entries
    const watchlistCandidates = [...watchTickers, ...avoidTickers].filter(
      h => !existingWatchlistTickers.has(h.ticker) &&
           !existingHoldingTickers.has(h.ticker)
    );

    let insertedWatchlist = 0;
    if (watchlistCandidates.length > 0) {
      const watchlistRows = watchlistCandidates.map(h => ({
        user_id:  user.id,
        ticker:   h.ticker,
        added_at: new Date().toISOString(),
      }));

      const { error: watchErr } = await supabase
        .from("user_watchlist")
        .insert(watchlistRows);

      if (watchErr) throw watchErr;
      insertedWatchlist = watchlistRows.length;
    }

    // ── Build summary for client ──────────────────────────────────────────────
    const buySummary = buyHoldings.map(h => {
      const price    = priceMap.get(h.ticker) ?? null;
      const capital  = (h.weight / 100) * investable;
      const quantity = price && price > 0 ? Math.floor(capital / price) : null;
      return {
        ticker:    h.ticker,
        signal:    "BUY" as const,
        weight:    h.weight,
        capital:   Math.round(capital),
        price:     price,
        quantity:  quantity,
        rationale: h.rationale,
      };
    });

    const watchSummary = watchTickers.map(h => ({
      ticker:    h.ticker,
      signal:    "WATCH" as const,
      rationale: h.rationale,
      price:     priceMap.get(h.ticker) ?? null,
    }));

    const avoidSummary = avoidTickers.map(h => ({
      ticker:    h.ticker,
      signal:    "AVOID" as const,
      rationale: h.rationale,
      price:     priceMap.get(h.ticker) ?? null,
    }));

    return NextResponse.json({
      rationale:          parsed.rationale,
      warnings:           parsed.warnings ?? [],
      buy:                buySummary,
      watch:              watchSummary,
      avoid:              avoidSummary,
      inserted_holdings:  insertedHoldings,
      inserted_watchlist: insertedWatchlist,
      cash_floor_pct:     cashFloorPct,
      cash_floor_amount:  cashFloorAmount,
      investable_capital: investable,
    });

  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}
