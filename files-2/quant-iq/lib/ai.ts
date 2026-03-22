// lib/ai.ts
// All Claude AI integrations for Quant IQ.
// Model: claude-sonnet-4-20250514
//
// Functions:
//   classifyEvent()       → event_type, sectors, sentiment, impact, tickers, summary
//   generateTheme()       → investment theme with conviction + brief
//   generateAssetSignals() → buy/watch/hold/avoid for each asset
//   generateAdvisoryMemo() → personalised portfolio advisory prose

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
export const MODEL = "claude-sonnet-4-20250514";

// ── Types ─────────────────────────────────────────────────────────────────────

export type EventType =
  | "monetary_policy" | "geopolitical" | "corporate"
  | "economic_data"   | "regulatory"   | "market_structure";

export type ImpactLevel = "low" | "medium" | "high";

export type Momentum =
  | "strong_up" | "moderate_up" | "neutral"
  | "moderate_down" | "strong_down";

export type Signal = "buy" | "watch" | "hold" | "avoid";

export interface ClassifiedEvent {
  event_type:      EventType;
  sectors:         string[];
  sentiment_score: number;    // -1.0 to +1.0
  impact_level:    ImpactLevel;
  tickers:         string[];
  ai_summary:      string;
}

export interface GeneratedTheme {
  name:              string;
  label:             string;
  conviction:        number;  // 0–100
  momentum:          Momentum;
  brief:             string;
  candidate_tickers: string[];
}

export interface AssetSignalUpdate {
  ticker:    string;
  signal:    Signal;
  score:     number;  // 0–100
  rationale: string;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function parseJSON<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text.replace(/```json\n?|\n?```/g, "").trim()) as T;
  } catch {
    return fallback;
  }
}

async function ask(prompt: string, maxTokens = 512): Promise<string> {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });
  return res.content[0].type === "text" ? res.content[0].text : "";
}

// ── classifyEvent ─────────────────────────────────────────────────────────────

export async function classifyEvent(
  headline: string,
  description?: string
): Promise<ClassifiedEvent> {
  const text = await ask(`You are a quantitative analyst classifying financial news for US market investors.

Headline: ${headline}${description ? `\nDescription: ${description}` : ""}

Respond ONLY with this JSON — no other text:
{
  "event_type": "monetary_policy"|"geopolitical"|"corporate"|"economic_data"|"regulatory"|"market_structure",
  "sectors": ["affected", "sectors"],
  "sentiment_score": <-1.0 to +1.0 for US markets>,
  "impact_level": "low"|"medium"|"high",
  "tickers": ["directly", "affected", "US", "tickers"],
  "ai_summary": "<one investment-relevant sentence>"
}

Sectors: technology, financials, energy, healthcare, defence, consumer, materials, utilities, real_estate, industrials, broad_market
Impact: high = likely >2% move, medium = 0.5–2%, low = <0.5%
Only include tickers you are highly confident are materially affected.`);

  return parseJSON<ClassifiedEvent>(text, {
    event_type: "market_structure",
    sectors: [],
    sentiment_score: 0,
    impact_level: "low",
    tickers: [],
    ai_summary: headline,
  });
}

// ── generateTheme ─────────────────────────────────────────────────────────────

export async function generateTheme(
  events: Array<{
    headline: string; event_type: string; sectors: string[];
    sentiment_score: number; impact_level: string; ai_summary: string;
  }>,
  timeframe: "1m" | "3m" | "6m"
): Promise<GeneratedTheme> {
  const horizon = { "1m": "1 month", "3m": "3 months", "6m": "6 months" }[timeframe];
  const eventLines = events
    .slice(0, 20)
    .map((e, i) =>
      `${i + 1}. [${e.impact_level.toUpperCase()}] ${e.headline} ` +
      `(sentiment: ${e.sentiment_score >= 0 ? "+" : ""}${e.sentiment_score.toFixed(2)}, ` +
      `sectors: ${e.sectors.join(", ")})`
    )
    .join("\n");

  const text = await ask(`You are a senior investment strategist.
Identify the single most important investment theme for a ${horizon} horizon from these recent events:

${eventLines}

Respond ONLY with this JSON — no other text:
{
  "name": "<3–6 word theme name>",
  "label": "<2–3 word short label>",
  "conviction": <0–100>,
  "momentum": "strong_up"|"moderate_up"|"neutral"|"moderate_down"|"strong_down",
  "brief": "<3–4 sentence investment thesis>",
  "candidate_tickers": ["up", "to", "6", "US", "tickers", "or", "ETFs"]
}

Conviction: 80–100 = multiple confirming signals, 60–79 = high, 40–59 = moderate, 20–39 = low.`, 1024);

  return parseJSON<GeneratedTheme>(text, {
    name: "Market Uncertainty",
    label: "Risk-Off",
    conviction: 30,
    momentum: "neutral",
    brief: "Current signals are mixed. Monitor macro releases and Fed commentary before adding risk.",
    candidate_tickers: ["SPY", "GLD", "TLT"],
  });
}

// ── generateAssetSignals ──────────────────────────────────────────────────────

export async function generateAssetSignals(
  assets: Array<{ ticker: string; name: string; asset_type: string; sector: string | null }>,
  recentEvents: Array<{ headline: string; sectors: string[]; sentiment_score: number; impact_level: string }>,
  activeThemes: Array<{ name: string; timeframe: string; candidate_tickers: string[]; conviction: number }>
): Promise<AssetSignalUpdate[]> {
  const text = await ask(`You are a quantitative analyst generating trading signals.

Recent high-impact events:
${recentEvents.slice(0, 10).map(e =>
  `- ${e.headline} (sentiment: ${e.sentiment_score.toFixed(2)}, sectors: ${e.sectors.join(", ")})`
).join("\n")}

Active investment themes:
${activeThemes.map(t =>
  `- ${t.name} (${t.timeframe}, conviction ${t.conviction}, tickers: ${t.candidate_tickers.join(", ")})`
).join("\n")}

Generate signals for ALL of these assets:
${assets.map(a => `${a.ticker}: ${a.name} (${a.asset_type}, ${a.sector ?? "general"})`).join("\n")}

Respond ONLY with a JSON array — no other text:
[{"ticker":"TICKER","signal":"buy"|"watch"|"hold"|"avoid","score":<0-100>,"rationale":"<one sentence>"}]

Signal guide: buy = strong theme alignment, watch = positive but wait for entry, hold = neutral, avoid = negative or high risk.`, 1024);

  const parsed = parseJSON<AssetSignalUpdate[]>(text, []);
  if (parsed.length) return parsed;

  return assets.map(a => ({
    ticker: a.ticker, signal: "hold" as Signal, score: 50,
    rationale: "Insufficient signal data.",
  }));
}

// ── generateAdvisoryMemo ──────────────────────────────────────────────────────

export async function generateAdvisoryMemo(
  holdings: Array<{ ticker: string; name?: string | null; quantity?: number | null; avg_cost?: number | null }>,
  recentEvents: Array<{ headline: string; event_type: string; sectors: string[]; sentiment_score: number; impact_level: string; ai_summary: string | null }>,
  activeThemes: Array<{ name: string; timeframe: string; conviction: number; brief: string | null }>,
  macro?: { fed_rate?: number; cpi_yoy?: number; unemployment?: number }
): Promise<string> {
  const holdingLines = holdings
    .map(h => `${h.ticker}${h.name ? ` (${h.name})` : ""}${h.quantity ? ` — ${h.quantity} units` : ""}${h.avg_cost ? ` @ $${h.avg_cost}` : ""}`)
    .join("\n");

  const macroLines = macro
    ? `Fed rate: ${macro.fed_rate ?? "N/A"}% | CPI YoY: ${macro.cpi_yoy ?? "N/A"}% | Unemployment: ${macro.unemployment ?? "N/A"}%`
    : "";

  const text = await ask(`You are a senior portfolio advisor writing a concise advisory memo.

Holdings:
${holdingLines}
${macroLines ? `\nMacro: ${macroLines}` : ""}

Recent high-impact events:
${recentEvents.slice(0, 8).map(e => `[${e.impact_level.toUpperCase()}] ${e.ai_summary || e.headline}`).join("\n")}

Active themes:
${activeThemes.map(t => `${t.name} (${t.timeframe}, conviction ${t.conviction}/100): ${t.brief}`).join("\n\n")}

Write a 4–6 sentence personalised advisory memo that:
1. Names which holdings are most exposed to recent events (positively or negatively)
2. Notes alignment or misalignment with active themes
3. Gives one specific, actionable recommendation
4. Flags the single biggest risk to monitor

Professional but direct tone. Plain prose only — no bullet points, no headers.`);

  return text.trim() || "Unable to generate memo. Please try again.";
}
