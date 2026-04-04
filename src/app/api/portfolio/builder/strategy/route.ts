// src/app/api/portfolio/builder/strategy/route.ts
//
// POST — generate a strategy profile from portfolio preferences + macro context

import { NextRequest, NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/supabase";
import Anthropic from "@anthropic-ai/sdk";
import { logLlmStep } from "@/lib/builder-llm-logger";

const anthropic = new Anthropic();

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const { portfolio_id, run_id = null } = await req.json();

    const { data: raw } = await supabase
      .from("portfolios").select("*")
      .eq("id", portfolio_id).eq("user_id", user.id).single();

    if (!raw) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });

    const p = raw as any;

    const { data: macro } = await supabase
      .from("macro_scores")
      .select("aspect, score, direction, commentary")
      .order("scored_at", { ascending: false }).limit(6);

    const prompt = `You are an investment strategy advisor for a self-directed retail investor.

PORTFOLIO PREFERENCES:
- Risk appetite: ${p.risk_appetite}
- Investment horizon: ${p.investment_horizon}
- Benchmark: ${p.benchmark}
- Total capital: $${(p.total_capital ?? 0).toLocaleString()}
- Min cash reserve: ${p.cash_pct ?? 0}%
- Target holdings: ${p.target_holdings ?? 15}
- Preferred assets: ${(p.preferred_assets ?? []).join(", ") || "all"}

CURRENT MACRO ENVIRONMENT:
${(macro ?? []).map(m => `- ${m.aspect}: ${m.score > 0 ? "+" : ""}${m.score}/10 (${m.direction}) — ${m.commentary}`).join("\n")}

Based on the above, recommend a strategy profile for this portfolio.

Choose the most appropriate style:
- "growth": high-conviction momentum, accepts volatility, tech/growth sectors
- "balanced": mix of growth and stability, diversified across sectors
- "defensive": low-beta, stable earnings, capital preservation focus
- "income": dividend-focused, yield generation, REITs/bonds/ETFs
- "speculative": high risk/reward, crypto, small-cap, concentrated themes

Also recommend:
- cash_reserve_pct: how much cash to keep (0-30), may be higher than preference if macro is risky
- sector_tilts: 1-3 sectors to overweight given macro
- avoid_sectors: 0-2 sectors to underweight/avoid
- max_single_weight: max % for any single position (5-20)

Respond ONLY with valid JSON, no markdown:
{
  "style": "growth",
  "cash_reserve_pct": 10,
  "sector_tilts": ["Technology", "Healthcare"],
  "avoid_sectors": ["Energy"],
  "max_single_weight": 10,
  "summary": "One-line headline for this strategy",
  "rationale": "2-3 sentences explaining why this strategy fits the preferences and macro environment"
}`;

    const llmStart = Date.now();
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514", max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    });

    await logLlmStep({ supabase, run_id, step: "strategy", prompt, message: msg, started_at: llmStart });
    const text  = msg.content.filter(b => b.type === "text").map(b => (b as any).text).join("");
    const clean = text.replace(/```json|```/g, "").trim();
    const strategy = JSON.parse(clean);

    return NextResponse.json({ strategy });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}