// src/app/api/cron/regime/route.ts
//
// Classifies the current market regime from economic indicators + macro scores.
// Uses a two-step approach:
//   1. Rule-based pre-classification (deterministic, auditable)
//   2. Claude Haiku refines/validates using geopolitical context from events table
//
// Writes a single row to market_regime (upserted).
// Schedule: 0 11 * * * — after economic-data (6am), ingest (8am), macro (9am)
//
// Output flows into:
//   - market-intelligence cron (12pm) — adds regime row to snapshot
//   - portfolio builder strategy prompt — reads regime as hard constraint

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cronLog } from "@/lib/cron-logger";

const anthropic = new Anthropic();

function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

type CyclePhase       = "early" | "mid" | "late" | "recession";
type InflationRegime  = "deflationary" | "stable" | "elevated" | "higher-for-longer" | "stagflation";
type MonetaryStance   = "accommodative" | "neutral" | "restrictive" | "pivoting";
type RiskBias         = "risk-on" | "neutral" | "risk-off" | "defensive";
type GrowthTrajectory = "accelerating" | "stable" | "decelerating" | "contracting";
type StyleBias        = "growth" | "balanced" | "defensive" | "income" | "speculative";
type CashBias         = "low" | "moderate" | "elevated" | "high";
type DurationBias     = "short" | "neutral" | "long";

interface RegimeClassification {
  cycle_phase:           CyclePhase;
  inflation_regime:      InflationRegime;
  monetary_stance:       MonetaryStance;
  risk_bias:             RiskBias;
  growth_trajectory:     GrowthTrajectory;
  label:                 string;
  favoured_sectors:      string[];
  avoid_sectors:         string[];
  style_bias:            StyleBias;
  cash_bias:             CashBias;
  duration_bias:         DurationBias;
  rationale:             string;
  confidence:            number;
  key_indicators:        Record<string, any>;
  classification_method: string;
}

// ─── Robust JSON extractor ────────────────────────────────────────────────────
// Handles: markdown fences, leading/trailing prose, comments, extra whitespace.
// Finds the first { and matching last } — ignores everything outside.

function extractJson(raw: string): any {
  // Strip markdown code fences regardless of language tag
  let text = raw.replace(/```[a-z]*\s*/gi, "").replace(/```/g, "").trim();

  // Find outermost JSON object boundaries
  const start = text.indexOf("{");
  const end   = text.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      `No JSON object found in LLM response. Raw (first 300 chars): ${raw.slice(0, 300)}`
    );
  }

  const jsonStr = text.slice(start, end + 1);

  try {
    return JSON.parse(jsonStr);
  } catch (parseErr: any) {
    throw new Error(
      `JSON parse failed: ${parseErr.message}. ` +
      `Extracted (first 300): ${jsonStr.slice(0, 300)}`
    );
  }
}

// ─── Step 1: Rule-based classifier ───────────────────────────────────────────

function classifyByRules(
  econ:     Record<string, number | null>,
  macroAvg: number,
): Partial<RegimeClassification> {

  const gdp       = econ.gdp_growth_real;
  const cpi       = econ.cpi_yoy;
  const pce       = econ.pce_yoy;
  const fedRate   = econ.fed_funds_rate;
  const spread    = econ.yield_spread_10y2y;
  const unemp     = econ.unemployment_rate;
  const payrolls  = econ.nonfarm_payrolls;
  const sentiment = econ.consumer_sentiment;

  // ── Cycle phase ───────────────────────────────────────────────────────────
  let cycle_phase: CyclePhase;
  if      (gdp != null && gdp < 0)                                       cycle_phase = "recession";
  else if (gdp != null && gdp < 1.5 && unemp != null && unemp > 4.5)    cycle_phase = "late";
  else if (gdp != null && gdp < 1.5)                                     cycle_phase = "late";
  else if (gdp != null && gdp > 3   && unemp != null && unemp < 4)       cycle_phase = "early";
  else                                                                    cycle_phase = "mid";

  // ── Inflation regime ──────────────────────────────────────────────────────
  const inflationRate = cpi ?? pce ?? 0;
  let inflation_regime: InflationRegime;
  if      (inflationRate < 1)                              inflation_regime = "deflationary";
  else if (inflationRate <= 2.5)                           inflation_regime = "stable";
  else if (inflationRate <= 3.5)                           inflation_regime = macroAvg < -0.5 ? "elevated" : "higher-for-longer";
  else if (gdp != null && gdp < 1.5)                       inflation_regime = "stagflation";
  else                                                     inflation_regime = "higher-for-longer";

  // ── Monetary stance ───────────────────────────────────────────────────────
  let monetary_stance: MonetaryStance;
  if (fedRate != null) {
    if      (fedRate >= 5) monetary_stance = "restrictive";
    else if (fedRate >= 4) monetary_stance = macroAvg < -1   ? "pivoting" : "neutral";
    else if (fedRate >= 3) monetary_stance = macroAvg < -1.5 ? "pivoting" : "neutral";
    else                   monetary_stance = "accommodative";
  } else {
    monetary_stance = "neutral";
  }

  // ── Growth trajectory ─────────────────────────────────────────────────────
  let growth_trajectory: GrowthTrajectory;
  if      (gdp != null && gdp < 0)   growth_trajectory = "contracting";
  else if (gdp != null && gdp < 1.5) growth_trajectory = "decelerating";
  else if (gdp != null && gdp > 3)   growth_trajectory = payrolls != null && payrolls > 200 ? "accelerating" : "stable";
  else                               growth_trajectory = "stable";

  // ── Risk bias ─────────────────────────────────────────────────────────────
  const sentimentWeak = sentiment != null && sentiment < 65;
  const yieldInverted = spread    != null && spread < 0;
  let risk_bias: RiskBias;
  if      (cycle_phase === "recession" || (yieldInverted && sentimentWeak))        risk_bias = "defensive";
  else if (cycle_phase === "late" && sentimentWeak)                                 risk_bias = "risk-off";
  else if (cycle_phase === "early" && monetary_stance === "accommodative")          risk_bias = "risk-on";
  else                                                                              risk_bias = "neutral";

  // ── Sector implications ───────────────────────────────────────────────────
  const sectorMap: Record<string, { favour: string[]; avoid: string[] }> = {
    recession: { favour: ["Consumer Staples", "Utilities", "Healthcare"],           avoid: ["Technology", "Consumer Discretionary", "Financials", "Industrials"] },
    late:      { favour: ["Energy", "Materials", "Healthcare", "Consumer Staples"], avoid: ["Technology", "Consumer Discretionary", "Real Estate"] },
    mid:       { favour: ["Technology", "Industrials", "Financials"],               avoid: ["Utilities", "Consumer Staples"] },
    early:     { favour: ["Technology", "Consumer Discretionary", "Financials"],    avoid: ["Utilities", "Consumer Staples", "Real Estate"] },
  };

  const inflationFavour = inflationRate > 3 ? ["Energy", "Materials", "Real Estate"]       : [];
  const inflationAvoid  = inflationRate > 3 ? ["Consumer Discretionary", "Technology"] : [];

  const base = sectorMap[cycle_phase];
  const favoured_sectors = [...new Set([...base.favour, ...inflationFavour])].slice(0, 4);
  const avoid_sectors    = [...new Set([...base.avoid,  ...inflationAvoid])].slice(0, 3);

  // ── Style + cash + duration bias ──────────────────────────────────────────
  const style_bias: StyleBias =
    cycle_phase === "recession"                        ? "defensive" :
    cycle_phase === "late" && risk_bias === "risk-off" ? "defensive" :
    cycle_phase === "late"                             ? "balanced"  :
    cycle_phase === "mid"                              ? "growth"    :
    cycle_phase === "early"                            ? "growth"    : "balanced";

  const cash_bias: CashBias =
    risk_bias === "defensive" ? "high"     :
    risk_bias === "risk-off"  ? "elevated" :
    cycle_phase === "late"    ? "moderate" : "low";

  const duration_bias: DurationBias =
    monetary_stance === "restrictive"   ? "short"   :
    monetary_stance === "pivoting"      ? "neutral" :
    monetary_stance === "accommodative" ? "long"    : "neutral";

  return {
    cycle_phase, inflation_regime, monetary_stance, risk_bias, growth_trajectory,
    favoured_sectors, avoid_sectors, style_bias, cash_bias, duration_bias,
  };
}

// ─── Step 2: LLM refinement ───────────────────────────────────────────────────

async function refineWithLlm(
  rules:       Partial<RegimeClassification>,
  econ:        Record<string, number | null>,
  macroScores: any[],
  geoEvents:   any[],
): Promise<RegimeClassification> {

  const econSummary = [
    econ.fed_funds_rate     != null ? `Fed funds: ${econ.fed_funds_rate}%`                                               : null,
    econ.treasury_10y       != null ? `10Y yield: ${econ.treasury_10y}%`                                                 : null,
    econ.yield_spread_10y2y != null ? `Yield curve: ${econ.yield_spread_10y2y > 0 ? "+" : ""}${econ.yield_spread_10y2y}%` : null,
    econ.gdp_growth_real    != null ? `Real GDP: ${econ.gdp_growth_real}% ann.`                                           : null,
    econ.cpi_yoy            != null ? `CPI: ${econ.cpi_yoy}% YoY`                                                        : null,
    econ.pce_yoy            != null ? `PCE: ${econ.pce_yoy}% YoY`                                                        : null,
    econ.unemployment_rate  != null ? `Unemployment: ${econ.unemployment_rate}%`                                          : null,
    econ.nonfarm_payrolls   != null ? `Payrolls: +${econ.nonfarm_payrolls}k`                                              : null,
    econ.consumer_sentiment != null ? `Consumer sentiment: ${econ.consumer_sentiment}`                                    : null,
  ].filter(Boolean).join(" | ");

  const macroSummary = macroScores
    .map(m => `${m.aspect}: ${m.score > 0 ? "+" : ""}${m.score}/10 (${m.direction})`)
    .join(", ");

  const geoSummary = geoEvents.slice(0, 5)
    .map(e => `• ${e.headline}`)
    .join("\n");

  const prompt = `You are a macro strategist classifying the current US market regime for portfolio construction.

AUTHORITATIVE ECONOMIC DATA:
${econSummary}

MACRO SENTIMENT SCORES (from news analysis):
${macroSummary}

RECENT GEOPOLITICAL EVENTS:
${geoSummary || "None significant"}

RULE-BASED PRE-CLASSIFICATION:
- Cycle phase: ${rules.cycle_phase}
- Inflation regime: ${rules.inflation_regime}
- Monetary stance: ${rules.monetary_stance}
- Risk bias: ${rules.risk_bias}
- Growth trajectory: ${rules.growth_trajectory}
- Style bias: ${rules.style_bias}
- Favoured sectors: ${rules.favoured_sectors?.join(", ")}
- Avoid sectors: ${rules.avoid_sectors?.join(", ")}

Review the rule-based classification against the data and geopolitical context.
Adjust if the geopolitical situation or specific data points warrant a different classification.
Provide a confidence score (0-100) for the overall regime classification.

IMPORTANT: Respond with ONLY the raw JSON object below. No markdown, no fences, no explanation, no text before or after the JSON.

{
  "cycle_phase": "late",
  "inflation_regime": "higher-for-longer",
  "monetary_stance": "pivoting",
  "risk_bias": "risk-off",
  "growth_trajectory": "decelerating",
  "label": "Late-cycle · Higher-for-longer · Pivoting · Risk-off",
  "favoured_sectors": ["Energy", "Defence", "Healthcare", "Consumer Staples"],
  "avoid_sectors": ["Technology", "Consumer Discretionary"],
  "style_bias": "defensive",
  "cash_bias": "elevated",
  "duration_bias": "neutral",
  "rationale": "2-3 sentences citing specific data points and any geopolitical factors",
  "confidence": 78,
  "key_indicators": {
    "gdp_growth": 0.7,
    "cpi_yoy": 2.87,
    "fed_rate": 3.64,
    "unemployment": 4.3,
    "yield_spread": 0.51,
    "consumer_sentiment": 56.6
  }
}`;

  const msg = await anthropic.messages.create({
    model:      "claude-haiku-4-5-20251001",
    max_tokens: 700,
    messages:   [{ role: "user", content: prompt }],
  });

  const raw    = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  const result = extractJson(raw);

  return { ...result, classification_method: "rules+llm" };
}

// ─── GET / POST handler ───────────────────────────────────────────────────────

export async function GET(req: NextRequest)  { return handler(req); }
export async function POST(req: NextRequest) { return handler(req); }

async function handler(req: NextRequest) {
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";
  const validSecret  = process.env.CRON_SECRET
    ? req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`
    : false;

  if (!isVercelCron && !validSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const log      = await cronLog.start('regime', 'analysis', req as unknown as Request);
  const supabase = createServiceClient();
  const started  = Date.now();

  try {
    // ── Load inputs in parallel ─────────────────────────────────────────────
    const [econRes, macroRes, geoRes] = await Promise.all([
      supabase
        .from("economic_indicators")
        .select("indicator, value")
        .order("refreshed_at", { ascending: false }),
      supabase
        .from("macro_scores")
        .select("aspect, score, direction, commentary")
        .order("scored_at", { ascending: false })
        .limit(6),
      supabase
        .from("events")
        .select("headline, event_type, impact_score, sentiment_score, published_at")
        .eq("ai_processed", true)
        .in("event_type", ["geopolitical", "conflict", "trade", "policy"])
        .order("impact_score", { ascending: false })
        .limit(10),
    ]);

    // Build economic indicator map
    const econMap: Record<string, number | null> = {};
    for (const row of (econRes.data ?? [])) {
      econMap[row.indicator] = row.value != null ? parseFloat(String(row.value)) : null;
    }

    const macroScores = macroRes.data ?? [];
    const macroAvg    = macroScores.length
      ? macroScores.reduce((s, m) => s + m.score, 0) / macroScores.length
      : 0;
    const geoEvents   = geoRes.data ?? [];

    // ── Step 1: rule-based classification ───────────────────────────────────
    const rules = classifyByRules(econMap, macroAvg);

    // ── Step 2: LLM refinement ───────────────────────────────────────────────
    const regime = await refineWithLlm(rules, econMap, macroScores, geoEvents);

    // ── Upsert to market_regime ─────────────────────────────────────────────
    const { data: existing } = await supabase
      .from("market_regime")
      .select("id")
      .limit(1)
      .single();

    const upsertData = { ...regime, refreshed_at: new Date().toISOString() };

    let dbError;
    if (existing?.id) {
      const { error } = await supabase.from("market_regime").update(upsertData).eq("id", existing.id);
      dbError = error;
    } else {
      const { error } = await supabase.from("market_regime").insert(upsertData);
      dbError = error;
    }

    if (dbError) throw dbError;

    // ── Publish to market_intelligence snapshot ──────────────────────────────
    await supabase
      .from("market_intelligence")
      .upsert({
        aspect:       "regime",
        summary:      regime.label,
        data:         regime,
        score:        regime.risk_bias === "risk-on"   ?  5 :
                      regime.risk_bias === "defensive"  ? -7 :
                      regime.risk_bias === "risk-off"   ? -4 : 0,
        sentiment:    regime.risk_bias === "risk-on"
                        ? "bullish"
                        : (regime.risk_bias === "defensive" || regime.risk_bias === "risk-off")
                          ? "bearish"
                          : "neutral",
        sources:      ["market_regime"],
        cron_name:    "regime",
        refreshed_at: new Date().toISOString(),
      }, { onConflict: "aspect" });

    const elapsed = Math.round((Date.now() - started) / 1000);
    console.log(`[regime] ${elapsed}s — ${regime.label} (confidence: ${regime.confidence}%)`);

    await log.success({
      records_in:  macroScores.length + geoEvents.length + Object.keys(econMap).length,
      records_out: 1,
      meta: {
        label:             regime.label,
        cycle_phase:       regime.cycle_phase,
        inflation_regime:  regime.inflation_regime,
        monetary_stance:   regime.monetary_stance,
        risk_bias:         regime.risk_bias,
        growth_trajectory: regime.growth_trajectory,
        style_bias:        regime.style_bias,
        cash_bias:         regime.cash_bias,
        confidence:        regime.confidence,
        favoured_sectors:  regime.favoured_sectors,
        avoid_sectors:     regime.avoid_sectors,
        econ_indicators:   Object.keys(econMap).length,
        macro_scores:      macroScores.length,
        geo_events:        geoEvents.length,
        elapsed_s:         elapsed,
        method:            regime.classification_method,
      },
    });

    return NextResponse.json({
      ok:      true,
      regime:  regime.label,
      details: {
        cycle_phase:       regime.cycle_phase,
        inflation_regime:  regime.inflation_regime,
        monetary_stance:   regime.monetary_stance,
        risk_bias:         regime.risk_bias,
        growth_trajectory: regime.growth_trajectory,
        style_bias:        regime.style_bias,
        cash_bias:         regime.cash_bias,
        favoured_sectors:  regime.favoured_sectors,
        avoid_sectors:     regime.avoid_sectors,
        confidence:        regime.confidence,
      },
      rationale: regime.rationale,
      elapsed_s: elapsed,
    });

  } catch (e: any) {
    const elapsed = Math.round((Date.now() - started) / 1000);
    console.error("[regime] fatal:", e);

    await log.fail(e, {
      meta: {
        elapsed_s:   elapsed,
        error_stage: e.message?.includes("JSON") || e.message?.includes("json") || e.message?.includes("parse")
          ? "llm_parse"
          : e.message?.includes("supabase")
            ? "db_write"
            : "unknown",
      },
    });

    return NextResponse.json({ ok: false, error: e.message ?? String(e) }, { status: 500 });
  }
}
