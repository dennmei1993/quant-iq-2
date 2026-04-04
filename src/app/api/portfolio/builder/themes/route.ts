// src/app/api/portfolio/builder/themes/route.ts
//
// POST — rank and recommend themes that fit the generated strategy

import { NextRequest, NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/supabase";
import { callLlm } from "@/lib/llm-caller";
import { logLlmStep } from "@/lib/builder-llm-logger";


export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const { portfolio_id, strategy, run_id = null , provider = "claude", model_id } = await req.json();

    const { data: raw } = await supabase
      .from("portfolios").select("*")
      .eq("id", portfolio_id).eq("user_id", user.id).single();
    if (!raw) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
    const p = raw as any;

    // Fetch recent high-impact events to inform theme relevance
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: events } = await supabase
      .from("events")
      .select("headline, ai_summary, event_type, impact_score, sentiment_score, sectors, tickers, published_at")
      .eq("ai_processed", true)
      .gte("published_at", thirtyDaysAgo)
      .order("impact_score", { ascending: false })
      .limit(20);
    const recentEvents = (events ?? []);

    // Fetch active themes with their tickers
    const { data: themes } = await supabase
      .from("themes")
      .select("id, name, brief, conviction, momentum, theme_type, timeframe")
      .eq("is_active", true)
      .order("conviction", { ascending: false })
      .limit(20);

    if (!themes?.length) {
      return NextResponse.json({ themes: [] });
    }

    const prompt = `You are an investment strategy advisor. Given a portfolio strategy and a list of active investment themes, recommend which themes best fit the strategy and suggest capital allocations.

STRATEGY:
- Style: ${strategy.style}
- Cash reserve: ${strategy.cash_reserve_pct}%
- Sector tilts: ${strategy.sector_tilts?.join(", ") || "none"}
- Avoid sectors: ${strategy.avoid_sectors?.join(", ") || "none"}
- Max single position: ${strategy.max_single_weight}%
- Horizon: ${p.investment_horizon}
- Risk: ${p.risk_appetite}
- Investable capital: $${Math.round((p.total_capital ?? 0) * (1 - (strategy.cash_reserve_pct ?? 0) / 100)).toLocaleString()}
- Target holdings: ${p.target_holdings ?? 15}

AVAILABLE THEMES:
${themes.map(t => `- ID:${t.id} | ${t.name} [${t.theme_type}] conviction:${t.conviction}% momentum:${t.momentum ?? "stable"} | ${t.brief ?? ""}`).join("\n")}

RECENT HIGH-IMPACT EVENTS (real news — use these to assess theme momentum and risk):
${recentEvents.map(e => {
  const date = new Date(e.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const sectors = (e.sectors ?? []).join(", ") || "general";
  return `• [${date}] [${sectors}] impact:${(e.impact_score ?? 0).toFixed(1)} — ${e.headline}${e.ai_summary ? `\n  → ${e.ai_summary}` : ""}`;
}).join("\n")}

For each theme, assess how well it fits the strategy and suggest what % of the investable capital to allocate to it.
Factor in the recent events above — themes with tailwinds from current events should score higher; themes facing headwinds should score lower or be excluded.
Select 3-6 themes. Allocations should sum to approximately ${100 - (strategy.cash_reserve_pct ?? 0)}% across all chosen themes (the rest stays as cash reserve).

Respond ONLY with valid JSON, no markdown:
{
  "themes": [
    {
      "id": "theme-uuid-here",
      "name": "AI Infrastructure",
      "brief": "...",
      "conviction": 85,
      "momentum": "rising",
      "fit_reason": "One sentence: why this theme fits the strategy",
      "suggested_allocation": 25
    }
  ]
}`;

    const llmStart  = Date.now();
    const llmResult = await callLlm({ provider, model_id, prompt, max_tokens: 1200 });
    await logLlmStep({ supabase, run_id, step: "themes", prompt, response: llmResult, started_at: llmStart });
    const text = llmResult.text;
    const clean = text.replace(/```json|```/g, "").trim();
    const result = JSON.parse(clean);

    // Merge with DB theme data to ensure accuracy
    const themeMap = new Map(themes.map(t => [t.id, t]));
    const merged = (result.themes as any[]).map(t => ({
      ...t,
      ...themeMap.get(t.id) ?? {},
      fit_reason:           t.fit_reason,
      suggested_allocation: t.suggested_allocation,
    }));

    return NextResponse.json({ themes: merged });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}
