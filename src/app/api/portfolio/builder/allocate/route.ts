// src/app/api/portfolio/builder/allocate/route.ts
//
// POST — for each selected theme, recommend ticker allocations with BUY/WATCH signal

import { NextRequest, NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/supabase";
import Anthropic from "@anthropic-ai/sdk";
import { logLlmStep } from "@/lib/builder-llm-logger";

const anthropic = new Anthropic();

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const { portfolio_id, strategy, themes, run_id = null } = await req.json();

    const { data: raw } = await supabase
      .from("portfolios").select("*")
      .eq("id", portfolio_id).eq("user_id", user.id).single();
    if (!raw) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
    const p = raw as any;

    // Existing holdings — exclude from suggestions
    const { data: existing } = await supabase
      .from("holdings").select("ticker").eq("portfolio_id", portfolio_id);
    const held = new Set((existing ?? []).map(h => h.ticker));

    // Load theme tickers + signals for selected themes
    const themeIds = (themes as any[]).map(t => t.id);

    const [{ data: themeTickers }, { data: signals }, { data: assets }] = await Promise.all([
      supabase.from("theme_tickers")
        .select("ticker, theme_id, weight, conviction_pct, rationale")
        .in("theme_id", themeIds)
        .order("weight", { ascending: false }),

      supabase.from("asset_signals")
        .select("ticker, signal, fundamental_score, technical_score, price_usd, rationale")
        .order("fundamental_score", { ascending: false })
        .limit(150),

      supabase.from("assets")
        .select("ticker, name, sector, asset_type")
        .eq("is_active", true),
    ]);

    const signalMap  = new Map((signals ?? []).map(s => [s.ticker, s]));
    const assetMap   = new Map((assets  ?? []).map(a => [a.ticker, a]));
    const themeMap   = new Map((themes  as any[]).map(t => [t.id, t]));

    const investable = (p.total_capital ?? 0) * (1 - (strategy.cash_reserve_pct ?? 0) / 100);

    const prompt = `You are a portfolio construction advisor. For each investment theme, select the best tickers and allocate weights.

PORTFOLIO CONTEXT:
- Style: ${strategy.style}
- Investable capital: $${Math.round(investable).toLocaleString()}
- Max single position: ${strategy.max_single_weight}%
- Risk: ${p.risk_appetite} | Horizon: ${p.investment_horizon}
- Already held (exclude): ${held.size > 0 ? [...held].join(", ") : "none"}

SELECTED THEMES AND THEIR TICKERS:
${(themes as any[]).map(theme => {
  const tickers = (themeTickers ?? [])
    .filter(tt => tt.theme_id === theme.id && !held.has(tt.ticker))
    .slice(0, 12);
  return `
Theme: ${theme.name} (${theme.suggested_allocation}% allocation = $${Math.round(investable * theme.suggested_allocation / 100).toLocaleString()})
Tickers:
${tickers.map(tt => {
  const sig   = signalMap.get(tt.ticker);
  const asset = assetMap.get(tt.ticker);
  return `  - ${tt.ticker} (${asset?.name ?? ""}, ${asset?.sector ?? ""}) signal:${sig?.signal?.toUpperCase() ?? "NONE"} F:${sig?.fundamental_score ?? "?"} T:${sig?.technical_score ?? "?"} price:$${sig?.price_usd ?? "?"} | ${tt.rationale?.slice(0, 60) ?? ""}`;
}).join("\n")}`;
}).join("\n\n")}

INSTRUCTIONS:
For each theme, select 2-4 tickers. Assign each a signal (BUY or WATCH) and a weight % of the THEME's total allocation (not overall portfolio). BUY weights per theme must sum to 100. WATCH tickers get weight 0.
- BUY: strong signal, fundamental+technical both confident, fits style
- WATCH: good fundamentals but technical not confirmed, or secondary priority
- Respect max single position of ${strategy.max_single_weight}% of total investable
- Do not include tickers already held

Respond ONLY with valid JSON, no markdown:
{
  "tickers": [
    {
      "ticker": "NVDA",
      "name": "NVIDIA Corp",
      "theme_id": "uuid",
      "theme_name": "AI Infrastructure",
      "signal": "BUY",
      "weight": 60,
      "rationale": "one sentence"
    }
  ]
}`;

    const llmStart = Date.now();
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514", max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });

    await logLlmStep({ supabase, run_id, step: "allocation", prompt, message: msg, started_at: llmStart });
    const text   = msg.content.filter(b => b.type === "text").map(b => (b as any).text).join("");
    const clean  = text.replace(/```json|```/g, "").trim();
    const result = JSON.parse(clean);

    // Enrich with live prices
    const enriched = (result.tickers as any[]).map(t => {
      const sig = signalMap.get(t.ticker);
      return {
        ...t,
        price:             sig?.price_usd         ?? null,
        name:              assetMap.get(t.ticker)?.name ?? t.name ?? t.ticker,
        fundamental_score: sig?.fundamental_score ?? null,
        technical_score:   sig?.technical_score   ?? null,
        db_signal:         sig?.signal            ?? null,   // signal from our DB scorer
        db_rationale:      sig?.rationale         ?? null,   // rationale from our DB scorer
      };
    });

    return NextResponse.json({ tickers: enriched });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}
