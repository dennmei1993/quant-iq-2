// src/app/api/portfolio/builder/allocate-llm/route.ts
//
// POST — LLM-powered ticker allocation.
// Unlike /builder/allocate which uses theme_tickers as the candidate pool,
// this route asks Claude to freely select tickers from the full asset universe
// based on strategy, themes, macro, and signals — no pre-mapped theme_tickers constraint.

import { NextRequest, NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/supabase";
import { callLlm } from "@/lib/llm-caller";
import { logLlmStep } from "@/lib/builder-llm-logger";


export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const { portfolio_id, strategy, themes, run_id = null , provider = "claude", model_id } = await req.json();

    const { data: raw } = await supabase
      .from("portfolios").select("*")
      .eq("id", portfolio_id).eq("user_id", user.id).single();
    if (!raw) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
    const p = raw as any;

    // Existing holdings — exclude
    const { data: existing } = await supabase
      .from("holdings").select("ticker").eq("portfolio_id", portfolio_id);
    const held = new Set((existing ?? []).map(h => h.ticker));

    // Full asset universe (not pre-filtered by theme_tickers)
    const preferredTypes: string[] = p.preferred_assets ?? [];
    const [{ data: assets }, { data: signals }, { data: macro }] = await Promise.all([
      supabase.from("assets")
        .select("ticker, name, sector, asset_type, pe_ratio, analyst_rating, market_cap_tier, beta")
        .eq("is_active", true)
        .order("bootstrap_priority", { ascending: true })
        .limit(200),

      supabase.from("asset_signals")
        .select("ticker, signal, fundamental_score, technical_score, price_usd, rationale")
        .in("signal", ["buy", "watch"])
        .order("fundamental_score", { ascending: false })
        .limit(100),

      supabase.from("macro_scores")
        .select("aspect, score, direction, commentary")
        .order("scored_at", { ascending: false }).limit(6),
    ]);

    const signalMap = new Map((signals ?? []).map(s => [s.ticker, s]));
    const assetMap  = new Map((assets  ?? []).map(a => [a.ticker, a]));

    // Filter by preferred asset types if set
    const universe = (assets ?? []).filter(a =>
      !held.has(a.ticker) &&
      (preferredTypes.length === 0 || preferredTypes.includes(a.asset_type))
    );

    const investable = (p.total_capital ?? 0) * (1 - (strategy.cash_reserve_pct ?? 0) / 100);

    const prompt = `You are a portfolio construction expert. Select the best tickers for each investment theme from the full asset universe below.

PORTFOLIO CONTEXT:
- Style: ${strategy.style}
- Investable: $${Math.round(investable).toLocaleString()}
- Max single position: ${strategy.max_single_weight}%
- Risk: ${p.risk_appetite} | Horizon: ${p.investment_horizon}
- Already held (exclude): ${held.size > 0 ? [...held].join(", ") : "none"}

MACRO ENVIRONMENT:
${(macro ?? []).map(m => `- ${m.aspect}: ${m.score > 0 ? "+" : ""}${m.score}/10 (${m.direction}) — ${m.commentary}`).join("\n")}

SELECTED THEMES:
${(themes as any[]).map(t => `- ${t.name} (${t.suggested_allocation}% = $${Math.round(investable * t.suggested_allocation / 100).toLocaleString()}): ${t.brief ?? t.fit_reason ?? ""}`).join("\n")}

FULL ASSET UNIVERSE WITH SIGNALS:
${universe.slice(0, 120).map(a => {
  const sig = signalMap.get(a.ticker);
  return `${a.ticker}|${a.name}|${a.asset_type}|${a.sector ?? "—"}|${a.market_cap_tier ?? "—"}|${sig?.signal?.toUpperCase() ?? "—"}|F:${sig?.fundamental_score ?? "?"}|T:${sig?.technical_score ?? "?"}|$${sig?.price_usd ?? "?"}`;
}).join("\n")}

INSTRUCTIONS:
For each theme, freely select 2-4 tickers from the asset universe above (not limited to pre-assigned theme_tickers).
Use your judgment about which assets best express each theme's investment thesis.
Assign signal (BUY or WATCH) and weight % within each theme (BUY weights per theme sum to 100, WATCH = 0).
Respect the ${strategy.max_single_weight}% max single position cap on overall investable capital.

This is an independent LLM selection — don't default to obvious picks. Consider the full universe.

Respond ONLY with valid JSON, no markdown:
{
  "tickers": [
    {
      "ticker": "MSFT",
      "name": "Microsoft Corp",
      "theme_id": "theme-id-or-null",
      "theme_name": "AI Infrastructure",
      "signal": "BUY",
      "weight": 55,
      "rationale": "one sentence — why this ticker for this theme"
    }
  ]
}`;

    const llmStart  = Date.now();
    const llmResult = await callLlm({ provider, model_id, prompt, max_tokens: 2500 });
    await logLlmStep({ supabase, run_id, step: "allocation", prompt, response: llmResult, started_at: llmStart });
    const text = llmResult.text;
    const clean  = text.replace(/```json|```/g, "").trim();
    const result = JSON.parse(clean);

    // Enrich with live prices from our signal map
    const enriched = (result.tickers as any[])
      .filter(t => !held.has(t.ticker))
      .map(t => ({
        ...t,
        price: signalMap.get(t.ticker)?.price_usd ?? null,
        name:  assetMap.get(t.ticker)?.name ?? t.name ?? t.ticker,
      }));

    return NextResponse.json({ tickers: enriched });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}
