// src/app/api/portfolio/builder/strategy/route.ts
//
// POST — generate a strategy profile.
//
// mode=data: Data-driven — Claude reads portfolio preferences + our DB macro scores
// mode=llm:  LLM-powered — grounds reasoning in:
//              1. Recent high-impact events from our DB events table (RSS-ingested, AI-classified)
//              2. Claude web_search tool for real-time geopolitical context
//              3. Portfolio preferences as hard constraints
//            No DB macro scores used — model reasons from live data.

import { NextRequest, NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/supabase";
import { callLlm } from "@/lib/llm-caller";
import { logLlmStep } from "@/lib/builder-llm-logger";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

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

    // ── Data mode: fetch macro scores + events ──────────────────────────────────
    let macro: any[] = [];
    let recentEvents: any[] = [];
    let webContext = "";

    if (mode === "data") {
      const [macroRes, eventsRes] = await Promise.all([
        supabase
          .from("macro_scores")
          .select("aspect, score, direction, commentary")
          .order("scored_at", { ascending: false }).limit(6),
        supabase
          .from("events")
          .select("headline, ai_summary, event_type, sentiment_score, impact_score, sectors, published_at, source_name")
          .eq("ai_processed", true)
          .gte("impact_score", 6)
          .order("published_at", { ascending: false })
          .limit(20),
      ]);
      macro        = macroRes.data  ?? [];
      recentEvents = eventsRes.data ?? [];
    }

    // ── LLM mode: fetch recent high-impact events from DB + web search ────────
    if (mode === "llm") {
      // 1. Pull recent high-impact events from our RSS-ingested events table
      const { data: events } = await supabase
        .from("events")
        .select("headline, ai_summary, event_type, sentiment_score, impact_score, sectors, published_at, source_name")
        .eq("ai_processed", true)
        .gte("impact_score", 6)
        .order("published_at", { ascending: false })
        .limit(20);
      recentEvents = events ?? [];

      // 2. Use Claude web_search tool to fetch real-time geopolitical context
      try {
        const searchMsg = await anthropic.messages.create({
          model:     "claude-sonnet-4-20250514",
          max_tokens: 1500,
          tools: [{
            type: "web_search_20250305",
            name: "web_search",
          } as any],
          messages: [{
            role:    "user",
            content: `Search for the latest news on: (1) current geopolitical conflicts and their impact on US stock markets, (2) US Federal Reserve latest policy decisions and interest rate outlook, (3) major sector-specific risks in US equities right now. Provide a concise factual summary of the most market-relevant developments from the past 30 days. Focus on: Middle East tensions, trade policy changes, earnings trends, and central bank signals.`,
          }],
        });

        // Extract text from web search response
        webContext = searchMsg.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("\n")
          .slice(0, 3000); // cap to avoid token overflow
      } catch (e) {
        // Web search failure is non-fatal — fall back to model's training knowledge
        console.warn("Web search failed, using training knowledge only:", e);
        webContext = "";
      }
    }

    // ── Build prompt based on mode ────────────────────────────────────────────
    const prompt = mode === "llm"
      ? buildLlmPrompt(p, recentEvents, webContext)
      : buildDataPrompt(p, macro, recentEvents);

    const llmStart  = Date.now();
    const llmResult = await callLlm({ provider, model_id, prompt, max_tokens: 1200 });
    await logLlmStep({ supabase, run_id, step: "strategy", prompt, response: llmResult, started_at: llmStart });

    const clean    = llmResult.text.replace(/```json|```/g, "").trim();
    const strategy = JSON.parse(clean);

    return NextResponse.json({ strategy, macro, recentEvents });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM prompt — pure advisory, no DB data, model uses its own knowledge
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Shared event formatter — used by both LLM and data prompts
// ─────────────────────────────────────────────────────────────────────────────

function formatEventsForPrompt(events: any[]): string {
  if (!events.length) return "No recent high-impact events available.";

  const grouped: Record<string, any[]> = {};
  for (const e of events) {
    const type = e.event_type ?? "general";
    if (!grouped[type]) grouped[type] = [];
    grouped[type].push(e);
  }

  const lines: string[] = [];
  for (const [type, items] of Object.entries(grouped)) {
    lines.push(`[${type.toUpperCase().replace(/_/g, " ")}]`);
    for (const e of items.slice(0, 8)) {
      const date      = new Date(e.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const sentiment = e.sentiment_score != null
        ? (e.sentiment_score > 0 ? `+${e.sentiment_score.toFixed(1)}` : e.sentiment_score.toFixed(1))
        : "?";
      const impact  = e.impact_score != null ? e.impact_score.toFixed(1) : "?";
      const sectors = (e.sectors ?? []).join(", ") || "—";
      lines.push(`  • [${date}] impact:${impact} sentiment:${sentiment} sectors:(${sectors})`);
      lines.push(`    ${e.headline}`);
      if (e.ai_summary) lines.push(`    → ${e.ai_summary}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function buildLlmPrompt(p: any, recentEvents: any[], webContext: string): string {
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
    "=== REAL-TIME MARKET INTELLIGENCE ===",
    "",
    webContext
      ? `LIVE WEB SEARCH RESULTS (retrieved now — treat as current facts):\n${webContext}`
      : "NOTE: Web search unavailable — use your training knowledge for current events.",
    "",
    recentEvents.length > 0
      ? [
          `RECENT HIGH-IMPACT EVENTS FROM NEWS FEED (last ${recentEvents.length} events, impact score ≥6/10):`,
          ...recentEvents.map(e => {
            const date = e.published_at ? new Date(e.published_at).toLocaleDateString("en-AU", { day: "numeric", month: "short" }) : "";
            const sectors = e.sectors?.length ? ` [${e.sectors.join(", ")}]` : "";
            const sentiment = e.sentiment_score != null ? ` sentiment:${e.sentiment_score > 0 ? "+" : ""}${e.sentiment_score.toFixed(1)}` : "";
            return `- [${date}]${sectors}${sentiment} ${e.headline}${e.ai_summary ? ": " + e.ai_summary : ""}`;
          }),
          "",
          "You MUST incorporate the above events into your sector tilt and avoid recommendations.",
          "If any event signals risk to a sector (e.g. Middle East conflict → Energy/Defence implications,",
          "tariff news → affected sectors), your rationale must explicitly reference it.",
        ].join("\n")
      : "No recent high-impact events available from news feed.",
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
    "=== CURRENT EVENTS INTELLIGENCE ===",
    "",
    "The following events have been ingested from financial news sources and AI-classified.",
    "These represent REAL current events your training data may not include.",
    "You MUST factor these into your sector tilts and avoid recommendations.",
    "Do not ignore geopolitical events — they directly affect sector risk.",
    "",
    formatEventsForPrompt(recentEvents),
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
    '  "rationale": "3-4 sentences — must (1) state how this satisfies risk/horizon/cash constraints and (2) reference at least one specific recent event from the news feed or web search that influenced the recommendation",',
    '  "macro_context": "2-3 sentences citing SPECIFIC current events, conflicts, or policy decisions by name that drove sector tilts and style — not generic statements like \'geopolitical uncertainty\' but actual named events"',
    "}",
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Data prompt — Claude reads our DB macro scores and portfolio preferences
// ─────────────────────────────────────────────────────────────────────────────

function buildDataPrompt(p: any, macro: any[], events: any[]): string {
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

RECENT HIGH-IMPACT EVENTS (AI-classified from live news feeds):
${formatEventsForPrompt(events)}

Based on the above data and events, recommend a strategy profile for this portfolio.

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
