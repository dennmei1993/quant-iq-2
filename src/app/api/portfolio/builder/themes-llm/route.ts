// src/app/api/portfolio/builder/themes-llm/route.ts
//
// POST — LLM-powered theme generation.
// Unlike /builder/themes which ranks existing DB themes,
// this route asks Claude to freely define investment themes
// based purely on strategy + macro context, then maps them
// back to DB themes by name/concept for downstream allocation.

import { NextRequest, NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/supabase";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const { portfolio_id, strategy } = await req.json();

    const { data: raw } = await supabase
      .from("portfolios").select("*")
      .eq("id", portfolio_id).eq("user_id", user.id).single();
    if (!raw) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
    const p = raw as any;

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

    const prompt = `You are a senior portfolio strategist. Based on the investment strategy and macro environment below, define the best investment themes for this portfolio.

STRATEGY:
- Style: ${strategy.style}
- Cash reserve: ${strategy.cash_reserve_pct}%
- Sector tilts: ${strategy.sector_tilts?.join(", ") || "none"}
- Avoid sectors: ${strategy.avoid_sectors?.join(", ") || "none"}
- Max single position: ${strategy.max_single_weight}%
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
For each theme, suggest what % of investable capital to allocate.
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

    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514", max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    });

    const text   = msg.content.filter(b => b.type === "text").map(b => (b as any).text).join("");
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
