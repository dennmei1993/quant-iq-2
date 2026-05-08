// src/app/api/portfolio/builder/themes-llm/route.ts
//
// POST — LLM-powered theme generation.
// Unlike /builder/themes which ranks existing DB themes,
// this route asks Claude to freely define investment themes
// based purely on strategy + macro context, then maps them
// back to DB themes by name/concept for downstream allocation.

import { NextRequest, NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/supabase";
import { callLlm } from "@/lib/llm-caller";
import { logLlmStep } from "@/lib/builder-llm-logger";



// Style-to-theme constraint mapping
const STYLE_THEME_RULES: Record<string, { favour: string; avoid: string }> = {
  growth:      { favour: "momentum, technology, AI, innovation, high-growth sectors",             avoid: "bond, utility, REIT, dividend-income, or capital-preservation themes" },
  balanced:    { favour: "a mix of growth and stable themes — no extreme concentration",           avoid: "purely speculative crypto/small-cap OR purely defensive income themes" },
  defensive:   { favour: "consumer staples, utilities, healthcare, infrastructure, low-beta",      avoid: "crypto, small-cap, speculative, high-volatility, or unprofitable-growth themes" },
  income:      { favour: "dividend-paying, REIT, infrastructure, yield-generating themes",         avoid: "pure growth/momentum themes with no yield component" },
  speculative: { favour: "high-conviction bets, crypto, small-cap, emerging tech, concentrated",  avoid: "conservative, income, or capital-preservation themes" },
};

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const { portfolio_id, strategy, run_id = null , provider = "claude", model_id } = await req.json();

    const { data: raw } = await supabase
      .from("portfolios").select("*")
      .eq("id", portfolio_id).eq("user_id", user.id).single();
    if (!raw) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
    const p = raw as any;

    // Read pre-computed market intelligence snapshot (updated by cron)
    // Much faster than live event fetching at request time
    const { data: intelRows } = await supabase
      .from("market_intelligence")
      .select("aspect, summary, data, score, sentiment, refreshed_at");
    const intel = new Map((intelRows ?? []).map((r: any) => [r.aspect, r]));
    const eventsIntel   = intel.get("recent_events");
    const geoIntel      = intel.get("geopolitical");
    const sectorIntel   = intel.get("sector_momentum");
    const marketContext = [
      geoIntel    ? `GEOPOLITICAL (${geoIntel.sentiment}): ${geoIntel.summary}` : "",
      sectorIntel ? `SECTOR MOMENTUM: ${sectorIntel.summary}` : "",
      eventsIntel?.data?.top_events_text ? `RECENT EVENTS:\n${eventsIntel.data.top_events_text}` : "",
    ].filter(Boolean).join("\n\n");

    // Macro context
    const { data: macro } = await supabase
      .from("macro_scores")
      .select("aspect, score, direction, commentary")
      .order("scored_at", { ascending: false }).limit(6);

    // Load DB themes so LLM can optionally reference them by name
    const { data: dbThemes } = await supabase
      .from("themes")
      .select("id, name, brief, conviction, momentum")
      .eq("is_active", true)
      .order("conviction", { ascending: false })
      .limit(20);

    const investable = Math.round(
      (p.total_capital ?? 0) * (1 - (strategy.cash_reserve_pct ?? 0) / 100)
    );


    const styleRules = STYLE_THEME_RULES[strategy.style as string] ?? STYLE_THEME_RULES["balanced"];
    const styleConstraint = `STYLE CONSTRAINT — NON-NEGOTIABLE:
Strategy style is "${strategy.style}".
- You MUST favour themes that are: ${styleRules.favour}
- You MUST avoid themes that are: ${styleRules.avoid}
- Sector tilts from strategy (${strategy.sector_tilts?.join(", ") || "none"}) should be reflected in theme selection.
- Avoid sectors from strategy (${strategy.avoid_sectors?.join(", ") || "none"}) must NOT appear as selected themes.`;

    const prompt = `You are a senior portfolio strategist. Based on the investment strategy and macro environment below, define the best investment themes for this portfolio.

STRATEGY:
- Style: ${strategy.style}
- Cash reserve: ${strategy.cash_reserve_pct}%
- Sector tilts: ${strategy.sector_tilts?.join(", ") || "none"}
- Avoid sectors: ${strategy.avoid_sectors?.join(", ") || "none"}
- Max single position: ${strategy.max_single_weight}%

${styleConstraint}
- Risk appetite: ${p.risk_appetite} | Horizon: ${p.investment_horizon}
- Investable capital: $${investable.toLocaleString()}
- Target holdings: ${p.target_holdings ?? 15}

CURRENT MACRO ENVIRONMENT:
${(macro ?? []).map(m => `- ${m.aspect}: ${m.score > 0 ? "+" : ""}${m.score}/10 (${m.direction}) — ${m.commentary}`).join("\n")}

AVAILABLE DATABASE THEMES (you may use these or define new ones):
${(dbThemes ?? []).map(t => `- ID:${t.id} | ${t.name} [conviction:${t.conviction}% momentum:${t.momentum ?? "stable"}] — ${t.brief ?? ""}`).join("\n")}

INSTRUCTIONS:
Define 3-6 investment themes that best fit this strategy and current market conditions.
You may use themes from the database (reference by ID) or define new ones if no good match exists.
CURRENT MARKET INTELLIGENCE (pre-computed from live sources):
${marketContext}

For each theme, suggest what % of investable capital to allocate.
Themes aligned with sector momentum and geopolitical tailwinds should score higher.
Themes facing headwinds from the market intelligence should score lower or be excluded.
Total allocations should sum to approximately 100%.

Think independently — don't just rank existing themes. Consider what thematic exposures would best serve this strategy given the macro backdrop.

Respond ONLY with valid JSON, no markdown:
{
  "themes": [
    {
      "id": "existing-db-id-or-null-if-new",
      "name": "AI Infrastructure",
      "brief": "Companies building the compute, networking and software layers for AI workloads",
      "conviction": 88,
      "momentum": "rising",
      "fit_reason": "Growth style + positive macro sentiment on tech capex aligns with AI infrastructure build-out",
      "suggested_allocation": 28,
      "is_llm_generated": false
    }
  ]
}`;

    const llmStart  = Date.now();
    const llmResult = await callLlm({ provider, model_id, prompt, max_tokens: 1500 });
    await logLlmStep({ supabase, run_id, step: "themes", prompt, response: llmResult, started_at: llmStart });
    const text = llmResult.text;
    const clean  = text.replace(/```json|```/g, "").trim();
    const result = JSON.parse(clean);

    // Enrich with DB data where ID is present
    const dbThemeMap = new Map((dbThemes ?? []).map(t => [t.id, t]));
    const themes = (result.themes as any[]).map(t => ({
      ...t,
      // if LLM referenced a real theme, overlay DB fields
      ...(t.id && dbThemeMap.has(t.id) ? dbThemeMap.get(t.id) : {}),
      // always keep LLM-provided fit_reason and suggested_allocation
      fit_reason:           t.fit_reason,
      suggested_allocation: t.suggested_allocation,
      is_llm_generated:     !t.id || !dbThemeMap.has(t.id),
    }));

    return NextResponse.json({ themes });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}
