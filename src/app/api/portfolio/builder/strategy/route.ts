// src/app/api/portfolio/builder/strategy/route.ts
//
// POST — generate a strategy profile.
//
// mode=data: Data-driven — Claude reads portfolio preferences + our DB macro scores
// mode=llm:  LLM-powered — model reasons independently from geopolitical/macro
//            knowledge with no DB data, pure advisory prompt

import { NextRequest, NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/supabase";
import { callLlm } from "@/lib/llm-caller";
import { logLlmStep } from "@/lib/builder-llm-logger";

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const {
      portfolio_id,
      mode       = "data",
      run_id     = null,
      provider   = "claude",
      model_id,
    } = await req.json();

    const { data: raw } = await supabase
      .from("portfolios").select("*")
      .eq("id", portfolio_id).eq("user_id", user.id).single();

    if (!raw) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });

    const p = raw as any;

    // ── Data mode: fetch our DB macro scores to ground the recommendation ──────
    let macro: any[] = [];
    if (mode === "data") {
      const { data } = await supabase
        .from("macro_scores")
        .select("aspect, score, direction, commentary")
        .order("scored_at", { ascending: false }).limit(6);
      macro = data ?? [];
    }

    // ── Build prompt based on mode ────────────────────────────────────────────
    const prompt = mode === "llm"
      ? buildLlmPrompt(p)
      : buildDataPrompt(p, macro);

    const llmStart  = Date.now();
    const llmResult = await callLlm({ provider, model_id, prompt, max_tokens: 1000 });
    await logLlmStep({ supabase, run_id, step: "strategy", prompt, response: llmResult, started_at: llmStart });

    const clean    = llmResult.text.replace(/```json|```/g, "").trim();
    const strategy = JSON.parse(clean);

    return NextResponse.json({ strategy, macro });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM prompt — pure advisory, no DB data, model uses its own knowledge
// ─────────────────────────────────────────────────────────────────────────────

function buildLlmPrompt(p: any): string {
  const riskAppetite    = p.risk_appetite      ?? "moderate";
  const horizon         = p.investment_horizon ?? "long";
  const totalCapital    = (p.total_capital ?? 0).toLocaleString();
  const minCashPct      = p.cash_pct            ?? 0;
  const targetHoldings  = p.target_holdings     ?? 15;
  const preferredAssets = (p.preferred_assets ?? []).join(", ") || "all asset classes";
  const benchmark       = p.benchmark           ?? "SPY";
  const maxPositionCap  = Math.round(100 / targetHoldings * 1.5);

  const riskRules: Record<string, string> = {
    aggressive:   "You MUST recommend a growth or speculative style. Do NOT recommend defensive or income strategies.",
    moderate:     "You MUST recommend a balanced or growth style. Avoid speculative or pure defensive strategies.",
    conservative: "You MUST recommend a defensive or income style. Do NOT recommend growth or speculative strategies.",
  };
  const horizonRules: Record<string, string> = {
    short:  "SHORT horizon (<1yr): prioritise near-term catalysts and capital preservation. Avoid multi-year thesis positions.",
    medium: "MEDIUM horizon (1-3yr): balance near-term momentum with quality fundamentals.",
    long:   "LONG horizon (3+yr): prioritise quality compounders and structural themes over short-term momentum.",
  };

  const riskConstraint    = riskRules[riskAppetite]   ?? "Recommend a balanced style.";
  const horizonConstraint = horizonRules[horizon]      ?? "";
  const cashConstraint    = minCashPct > 0
    ? `MUST be at least ${minCashPct}%. Do not recommend below this floor under any circumstances.`
    : "No hard floor — recommend an appropriate buffer for current macro uncertainty.";
  const assetConstraint   = (p.preferred_assets ?? []).length > 0
    ? `Client ONLY invests in: ${preferredAssets}. Sector tilts MUST be consistent with these types.`
    : "Client is open to all asset classes.";

  return [
    "You are a professional investment adviser with deep expertise in US equity markets, global macroeconomics, and geopolitical dynamics.",
    "",
    "=== CLIENT CONSTRAINTS — NON-NEGOTIABLE ===",
    "",
    `RISK RULE: ${riskConstraint}`,
    `HORIZON RULE: ${horizonConstraint}`,
    `CASH RULE: cash_reserve_pct ${cashConstraint}`,
    `ASSET RULE: ${assetConstraint}`,
    `CONCENTRATION RULE: Target ${targetHoldings} holdings. max_single_weight must not exceed ${maxPositionCap}%.`,
    `BENCHMARK: ${benchmark}. Express sector tilts relative to ${benchmark} composition.`,
    "",
    "=== CLIENT PROFILE ===",
    "",
    `- Risk appetite: ${riskAppetite}`,
    `- Investment horizon: ${horizon}`,
    `- Total capital: $${totalCapital}`,
    `- Minimum cash reserve: ${minCashPct}%`,
    `- Target holdings: ${targetHoldings}`,
    `- Preferred asset types: ${preferredAssets}`,
    `- Benchmark: ${benchmark}`,
    "",
    "=== YOUR TASK ===",
    "",
    "As a professional investment adviser, provide investment strategy advice for the US market.",
    "Use your knowledge of the current environment — do NOT invent data:",
    "",
    "- US Federal Reserve policy and interest rate trajectory",
    "- Global geopolitical risks (trade tensions, tariffs, regional conflicts, supply chain disruption)",
    "- Sector rotation trends and forward earnings outlook by sector",
    "- USD strength and commodity dynamics affecting US equities",
    "- Credit conditions and corporate balance sheet health",
    "",
    "Your response MUST:",
    "1. Respect ALL constraints in the NON-NEGOTIABLE section above",
    "2. Choose ONE strategy style consistent with the risk rule",
    "3. Recommend sector tilts consistent with preferred asset types",
    "4. Set cash_reserve_pct at or above the cash floor",
    "5. Set max_single_weight at or below the concentration limit",
    "6. Explain in the rationale how the recommendation satisfies the client constraints",
    "",
    "Respond ONLY with valid JSON, no markdown, no preamble:",
    "{",
    '  "style": "balanced",',
    '  "cash_reserve_pct": 12,',
    '  "sector_tilts": ["Technology", "Healthcare"],',
    '  "avoid_sectors": ["Consumer Discretionary"],',
    '  "max_single_weight": 8,',
    '  "summary": "One compelling headline sentence for this strategy",',
    '  "rationale": "3-4 sentences — must explicitly state how this satisfies the risk appetite, horizon, and cash constraints",',
    '  "macro_context": "2-3 sentences on specific geopolitical and macro factors that influenced sector tilts and style selection"',
    "}",
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Data prompt — Claude reads our DB macro scores and portfolio preferences
// ─────────────────────────────────────────────────────────────────────────────

function buildDataPrompt(p: any, macro: any[]): string {
  return `You are an investment strategy advisor for a self-directed retail investor.

PORTFOLIO PREFERENCES:
- Risk appetite: ${p.risk_appetite}
- Investment horizon: ${p.investment_horizon}
- Benchmark: ${p.benchmark}
- Total capital: $${(p.total_capital ?? 0).toLocaleString()}
- Min cash reserve: ${p.cash_pct ?? 0}%
- Target holdings: ${p.target_holdings ?? 15}
- Preferred assets: ${(p.preferred_assets ?? []).join(", ") || "all"}

CURRENT MACRO ENVIRONMENT (from our scoring system):
${macro.map(m => `- ${m.aspect}: ${m.score > 0 ? "+" : ""}${m.score}/10 (${m.direction}) — ${m.commentary}`).join("\n")}

Based on the above data, recommend a strategy profile for this portfolio.

Choose the most appropriate style:
- "growth": high-conviction momentum, accepts volatility, tech/growth sectors
- "balanced": mix of growth and stability, diversified across sectors
- "defensive": low-beta, stable earnings, capital preservation focus
- "income": dividend-focused, yield generation, REITs/bonds/ETFs
- "speculative": high risk/reward, crypto, small-cap, concentrated themes

Also recommend:
- cash_reserve_pct: how much cash to keep (0-30), may be higher if macro is risky
- sector_tilts: 1-3 sectors to overweight given macro scores
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
  "rationale": "2-3 sentences explaining why this strategy fits the preferences and macro data",
  "macro_context": null
}`;
}
