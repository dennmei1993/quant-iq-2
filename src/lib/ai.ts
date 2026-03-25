/**
 * lib/ai.ts
 *
 * generateTheme() updated: Claude now outputs a ticker_weights array
 * with { ticker, weight, rationale } per ticker instead of a flat
 * candidate_tickers string array.
 *
 * weight = relevance (0.0–1.0): how central this ticker is to the theme.
 * rationale = one sentence explaining the connection.
 *
 * candidate_tickers[] is kept on the return value for backward compatibility
 * with anything still reading it — derived from ticker_weights.
 *
 * classifyEvent() and generateAdvisoryMemo() are unchanged.
 */

import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EventInput {
  headline:        string
  ai_summary?:     string | null
  event_type?:     string | null
  sectors?:        string[] | null
  sentiment_score?: number
  impact_score?:   number | null
  published_at:    string
}

export interface TickerWeight {
  ticker:    string   // US-listed ticker symbol, e.g. "NVDA"
  weight:    number   // 0.0–1.0 relevance score
  rationale: string   // one sentence
}

export interface ThemeOutput {
  name:               string
  label:              string
  conviction:         number        // 0–100
  momentum:           string
  brief:              string        // 3-4 sentence thesis
  ticker_weights:     TickerWeight[]
  candidate_tickers:  string[]      // derived from ticker_weights, backward compat
}

// ─── generateTheme ────────────────────────────────────────────────────────────

export async function generateTheme(
  events: EventInput[],
  timeframe: '1m' | '3m' | '6m'
): Promise<ThemeOutput> {
  const timeframeLabel = { '1m': '1-month', '3m': '3-month', '6m': '6-month' }[timeframe]

  const eventLines = events
    .slice(0, 20)
    .map(e => `- ${e.headline}${e.ai_summary ? ` (${e.ai_summary})` : ''}`)
    .join('\n')

  const prompt = `You are a professional investment analyst. Based on these recent macro and market events, identify the single strongest ${timeframeLabel} investment theme for US markets.

RECENT EVENTS:
${eventLines}

Respond ONLY with a valid JSON object. No markdown, no commentary, no extra keys.

{
  "name": "Short theme name, 3–6 words",
  "label": "Single capitalised word e.g. BULLISH",
  "conviction": <integer 0–100>,
  "momentum": "<strong_up|moderate_up|neutral|moderate_down|strong_down>",
  "brief": "3–4 sentence investment thesis. Why now, what's the catalyst, what's the risk.",
  "ticker_weights": [
    {
      "ticker": "TICKER",
      "weight": <float 0.0–1.0>,
      "rationale": "One sentence, max 20 words, explaining this ticker's connection."
    }
  ]
}

Rules for ticker_weights:
- 4–8 US-listed tickers (stocks, ETFs, or crypto symbols)
- weight scale:
    1.0  = primary direct play — core revenue/earnings exposure
    0.7  = strong secondary — significant but indirect exposure
    0.4  = thematic tailwind — sector or macro alignment
    0.2  = peripheral — marginal connection, monitor only
- Order by weight descending
- Use only tickers you are highly confident are listed on a US exchange
- rationale must be specific and investment-relevant`

  const response = await anthropic.messages.create({
    model:      'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages:   [{ role: 'user', content: prompt }],
  })

  const raw = response.content
    .filter(b => b.type === 'text')
    .map(b => (b as any).text)
    .join('')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()

  const parsed = JSON.parse(raw) as Omit<ThemeOutput, 'candidate_tickers'>

  // Clamp weights to valid range in case Claude drifts
  const ticker_weights = parsed.ticker_weights.map(tw => ({
    ticker:    tw.ticker.toUpperCase().trim(),
    weight:    Math.max(0, Math.min(1, Number(tw.weight) || 0)),
    rationale: tw.rationale ?? '',
  }))

  return {
    ...parsed,
    ticker_weights,
    candidate_tickers: ticker_weights.map(tw => tw.ticker),
  }
}

// ─── classifyEvent (unchanged) ────────────────────────────────────────────────

export interface ClassificationOutput {
  event_type:    string
  sectors:       string[]
  sentiment_score: number
  impact_score:  number   // 1–10: 1-2=low, 3-4=medium, 5-6=medium-high, 7-8=high, 9-10=breaking
  tickers:       string[]
  ai_summary:    string
}

export async function classifyEvent(
  headline: string,
  summary?: string | null
): Promise<ClassificationOutput> {
  const prompt = `Classify this financial news event for investment signal analysis.

HEADLINE: ${headline}
${summary ? `SUMMARY: ${summary}` : ''}

Respond ONLY with a valid JSON object:
{
  "event_type": "<monetary_policy|geopolitical|corporate|economic_data|regulatory>",
  "sectors": ["<affected US market sectors>"],
  "sentiment_score": <float -1.0 to 1.0 for US markets>,
  "impact_score": <integer 1-10>,
  "tickers": ["<directly affected US-listed tickers, max 5>"],
  "ai_summary": "<1 sentence investment-relevant summary>"
}

impact_score scale:
  9-10 = Breaking / systemic (Fed emergency action, war declaration, market halt)
  7-8  = High impact (rate decision, major earnings miss, geopolitical shock)
  5-6  = Medium-high (strong jobs report, sector-wide news, large M&A)
  3-4  = Medium (earnings in-line, minor regulatory update, analyst upgrade)
  1-2  = Low (routine filing, opinion piece, minor corporate news)`

  const response = await anthropic.messages.create({
    model:      'claude-sonnet-4-20250514',
    max_tokens: 512,
    messages:   [{ role: 'user', content: prompt }],
  })

  const raw = response.content
    .filter(b => b.type === 'text')
    .map(b => (b as any).text)
    .join('')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()

  return JSON.parse(raw) as ClassificationOutput
}

// ─── generateAdvisoryMemo (unchanged) ─────────────────────────────────────────

export async function generateAdvisoryMemo(
  holdings: { ticker: string; quantity?: number | null; avg_cost?: number | null }[],
  recentEvents: { headline: string; ai_summary?: string | null; sentiment_score: number; impact_score: number }[],
  macroEnvironment?: string
): Promise<string> {
  const holdingsList = holdings
    .map(h => `${h.ticker}${h.quantity ? ` (${h.quantity} units)` : ''}`)
    .join(', ')

  const eventsList = recentEvents
    .slice(0, 10)
    .map(e => `- ${e.ai_summary ?? e.headline} [impact: ${e.impact_score}/10, sentiment: ${e.sentiment_score.toFixed(2)}]`)
    .join('\n')

  const prompt = `You are a professional investment advisor. Write a concise advisory memo for a portfolio.

PORTFOLIO HOLDINGS: ${holdingsList}

RECENT RELEVANT EVENTS:
${eventsList}

${macroEnvironment ? `MACRO CONTEXT: ${macroEnvironment}` : ''}

Write a 3–4 sentence advisory memo that:
1. Identifies the most significant risk or opportunity from current events
2. Calls out which specific holdings are most affected
3. Suggests a concrete near-term action or watchpoint

Professional, direct language. No bullet points. Plain prose only.`

  const response = await anthropic.messages.create({
    model:      'claude-sonnet-4-20250514',
    max_tokens: 512,
    messages:   [{ role: 'user', content: prompt }],
  })

  return response.content
    .filter(b => b.type === 'text')
    .map(b => (b as any).text)
    .join('')
    .trim()
}

// ─── generateAssetSignals ─────────────────────────────────────────────────────

export interface AssetSignalInput {
  ticker:     string
  name:       string
  asset_type: string
  sector:     string | null
}

export interface ThemeInput {
  name:               string
  timeframe:          string
  candidate_tickers:  string[]
  conviction:         number
  brief:              string
}

export interface AssetSignalOutput {
  ticker:    string
  signal:    'buy' | 'watch' | 'hold' | 'avoid'
  score:     number   // 0–100
  rationale: string   // one sentence
}

/**
 * Score each asset against the current themes and recent events.
 * Returns a signal (buy/watch/hold/avoid), score (0-100), and rationale.
 *
 * Batches assets in groups of 20 to keep prompt size manageable.
 */
export async function generateAssetSignals(
  assets: AssetSignalInput[],
  events: { headline: string; ai_summary?: string | null; sentiment_score?: number | null; impact_score?: number | null }[],
  themes: ThemeInput[]
): Promise<AssetSignalOutput[]> {
  if (!assets.length) return []

  const themesSummary = themes
    .map(t => `${t.timeframe}: "${t.name}" (conviction ${t.conviction}) — tickers: ${t.candidate_tickers.join(', ')}`)
    .join('\n')

  const eventsSummary = events
    .slice(0, 15)
    .map(e => `- ${e.ai_summary ?? e.headline} [impact: ${e.impact_score ?? 1}/10, sentiment: ${(e.sentiment_score ?? 0).toFixed(2)}]`)
    .join('\n')

  const results: AssetSignalOutput[] = []
  const BATCH = 10   // reduced from 20 — keeps response well within token limit
  const DELAY = 1500 // ms between batches

  for (let i = 0; i < assets.length; i += BATCH) {
    const batch = assets.slice(i, i + BATCH)
    const tickerList = batch.map(a => `${a.ticker} (${a.name}, ${a.asset_type}, sector: ${a.sector ?? 'unknown'})`).join('\n')

    const prompt = `You are a quantitative investment analyst. Given the current investment themes and recent market events, score each asset.

ACTIVE THEMES:
${themesSummary}

RECENT EVENTS:
${eventsSummary}

ASSETS TO SCORE:
${tickerList}

Respond ONLY with a valid JSON array. No markdown, no commentary.

[
  {
    "ticker": "TICKER",
    "signal": "<buy|watch|hold|avoid>",
    "score": <integer 0-100>,
    "rationale": "One sentence explaining the signal."
  }
]

Signal rules:
  buy   = 70-100: directly in an active theme or strong positive event exposure
  watch = 50-69:  thematic tailwind or positive sector exposure
  hold  = 30-49:  neutral, no strong signal either way
  avoid = 0-29:   negative event exposure or bearish theme signal`

    try {
      const response = await anthropic.messages.create({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 2048,  // increased — 10 assets × ~80 tokens each + overhead
        messages:   [{ role: 'user', content: prompt }],
      })

      const raw = response.content
        .filter(b => b.type === 'text')
        .map(b => (b as any).text)
        .join('')
        .trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim()

      const parsed = JSON.parse(raw) as AssetSignalOutput[]
      results.push(...parsed)
    } catch (err) {
      console.error(`[generateAssetSignals] batch ${i / BATCH + 1} failed:`, err)
    }

    // Rate limit protection between batches
    if (i + BATCH < assets.length) {
      await new Promise(r => setTimeout(r, DELAY))
    }
  }

  return results
}
