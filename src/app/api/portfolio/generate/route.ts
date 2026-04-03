// src/app/api/portfolio/generate/route.ts
//
// POST /api/portfolio/generate
// Uses Claude to generate a portfolio of tickers based on the portfolio's
// preferences, current macro scores, active themes, and available assets.
// Respects the cash_pct floor when allocating capital weights.

import { NextRequest, NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/supabase";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

interface GeneratedHolding {
  ticker:    string;
  weight:    number;   // % of investable capital (after cash floor)
  rationale: string;
}

interface GenerateResponse {
  holdings:  GeneratedHolding[];
  rationale: string;   // overall portfolio rationale
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
    const { data: portfolio, error: pErr } = await supabase
      .from("portfolios")
      .select("*")
      .eq("id", portfolio_id)
      .eq("user_id", user.id)
      .single();

    if (pErr || !portfolio) {
      return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
    }

    // ── Load context data in parallel ─────────────────────────────────────────
    const [
      { data: assets },
      { data: signals },
      { data: themes },
      { data: macroScores },
      { data: existingHoldings },
    ] = await Promise.all([
      // Assets filtered by preferred_asset_types if set
      supabase
        .from("assets")
        .select("ticker, name, sector, asset_type, pe_ratio, analyst_rating, market_cap_tier")
        .eq("is_active", true)
        .order("bootstrap_priority", { ascending: true })
        .limit(200),

      // Signals for scoring
      supabase
        .from("asset_signals")
        .select("ticker, signal, fundamental_score, technical_score, rationale")
        .in("signal", ["buy", "watch"])
        .order("fundamental_score", { ascending: false })
        .limit(80),

      // Active themes
      supabase
        .from("themes")
        .select("name, brief, conviction, momentum, theme_type")
        .eq("is_active", true)
        .order("conviction", { ascending: false })
        .limit(10),

      // Current macro environment
      supabase
        .from("macro_scores")
        .select("aspect, score, direction, commentary")
        .order("scored_at", { ascending: false })
        .limit(6),

      // Existing holdings to avoid duplicates
      supabase
        .from("holdings")
        .select("ticker")
        .eq("portfolio_id", portfolio_id),
    ]);

    const existingTickers = new Set(
      (existingHoldings ?? []).map(h => h.ticker).filter(t => t !== "CASH")
    );

    // Filter signals to assets not already held
    const candidateSignals = (signals ?? []).filter(
      s => !existingTickers.has(s.ticker)
    );

    // Filter assets by preferred types if set
    const preferredTypes: string[] = portfolio.preferred_assets ?? [];
    const candidateAssets = (assets ?? []).filter(a =>
      preferredTypes.length === 0 || preferredTypes.includes(a.asset_type)
    );

    // Compute investable capital after cash floor
    const cashFloorPct    = portfolio.cash_pct ?? 0;           // e.g. 10
    const totalCapital    = portfolio.total_capital ?? 0;
    const cashFloorAmount = totalCapital * (cashFloorPct / 100);
    const investable      = totalCapital - cashFloorAmount;
    const targetCount     = portfolio.target_holdings ?? 15;

    // ── Build prompt ──────────────────────────────────────────────────────────
    const prompt = `You are a portfolio construction assistant for a self-directed retail investor.

PORTFOLIO PREFERENCES:
- Risk appetite: ${portfolio.risk_appetite}
- Investment horizon: ${portfolio.investment_horizon}
- Benchmark: ${portfolio.benchmark}
- Target holdings: ${targetCount}
- Total capital: $${totalCapital.toLocaleString()}
- Minimum cash reserve: ${cashFloorPct}% ($${cashFloorAmount.toLocaleString()})
- Investable capital: $${investable.toLocaleString()} (${100 - cashFloorPct}% of total)
- Preferred asset types: ${preferredTypes.length > 0 ? preferredTypes.join(", ") : "all types"}

CURRENT MACRO ENVIRONMENT:
${(macroScores ?? []).map(m => `- ${m.aspect}: ${m.score > 0 ? "+" : ""}${m.score}/10 (${m.direction}) — ${m.commentary}`).join("\n")}

ACTIVE INVESTMENT THEMES:
${(themes ?? []).map(t => `- ${t.name} [conviction: ${t.conviction}%] — ${t.brief ?? ""}`).join("\n") || "None available"}

TOP CANDIDATE SIGNALS (BUY/WATCH, not already in portfolio):
${candidateSignals.slice(0, 40).map(s =>
  `- ${s.ticker}: ${s.signal.toUpperCase()} | F:${s.fundamental_score ?? "?"} T:${s.technical_score ?? "?"} | ${s.rationale?.slice(0, 80) ?? ""}`
).join("\n")}

AVAILABLE ASSET UNIVERSE (filtered by preferences):
${candidateAssets.slice(0, 60).map(a =>
  `- ${a.ticker} (${a.asset_type}, ${a.sector ?? "—"}, ${a.market_cap_tier ?? "—"}, analyst: ${a.analyst_rating ?? "—"})`
).join("\n")}

EXISTING HOLDINGS (exclude these):
${existingTickers.size > 0 ? [...existingTickers].join(", ") : "None"}

INSTRUCTIONS:
Select ${targetCount} tickers for this portfolio. Prioritise:
1. BUY/WATCH signal tickers aligned with active themes and macro environment
2. Diversification across sectors and asset types consistent with preferences
3. Risk appetite: ${portfolio.risk_appetite === "aggressive" ? "lean toward high-growth, momentum plays" : portfolio.risk_appetite === "conservative" ? "lean toward dividend-paying, low-beta, defensive stocks" : "balanced mix of growth and stability"}
4. Horizon: ${portfolio.investment_horizon === "short" ? "prefer near-term catalysts and momentum" : portfolio.investment_horizon === "long" ? "prefer quality fundamentals and compounding" : "balance near-term and long-term"}

Weights must sum to 100 (representing % of investable capital of $${investable.toLocaleString()}).
Do NOT include CASH as a ticker — cash reserve is handled separately.

Respond ONLY with valid JSON in this exact shape, no markdown, no preamble:
{
  "holdings": [
    { "ticker": "AAPL", "weight": 8.5, "rationale": "one sentence max" }
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

    // Validate tickers exist in our universe
    const validTickers = new Set((assets ?? []).map(a => a.ticker));
    const validated    = parsed.holdings.filter(h => validTickers.has(h.ticker));

    // ── Insert holdings ───────────────────────────────────────────────────────
    if (validated.length > 0) {
      const rows = validated.map(h => ({
        portfolio_id: portfolio_id,
        ticker:       h.ticker,
        quantity:     null,                        // no quantity — weight-based
        avg_cost:     null,
        notes:        h.rationale,
        asset_type:   candidateAssets.find(a => a.ticker === h.ticker)?.asset_type ?? null,
        name:         candidateAssets.find(a => a.ticker === h.ticker)?.name ?? null,
      }));

      const { error: insertErr } = await supabase.from("holdings").insert(rows);
      if (insertErr) throw insertErr;
    }

    return NextResponse.json({
      holdings:  validated,
      rationale: parsed.rationale,
      warnings:  parsed.warnings ?? [],
      cash_floor_pct:    cashFloorPct,
      cash_floor_amount: cashFloorAmount,
      investable_capital: investable,
    });

  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}
