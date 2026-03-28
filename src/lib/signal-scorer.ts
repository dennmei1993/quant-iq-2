// src/lib/signal-scorer.ts
/**
 * Weighted signal scoring for asset_signals.
 *
 * Combines 4 inputs into a composite 0-100 score:
 *
 *   1. Price momentum   (30%) — change_pct over prev close
 *   2. News sentiment   (35%) — avg sentiment_score from recent events for this ticker
 *   3. Theme conviction (25%) — highest theme conviction this ticker appears in
 *   4. Macro context    (10%) — overall macro score from macro_scores table
 *
 * Signal thresholds:
 *   >= 65  → buy
 *   >= 50  → watch
 *   >= 35  → hold
 *   <  35  → avoid
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SignalInput {
  ticker:          string
  change_pct:      number           // yesterday's price change %
  sentimentScores: number[]         // sentiment_score values from recent events (-1 to +1)
  themeConviction: number           // 0-100, highest conviction theme this ticker is in (0 if none)
  macroScore:      number           // -10 to +10 overall macro score
}

export interface SignalOutput {
  signal:  'buy' | 'watch' | 'hold' | 'avoid'
  score:   number   // 0-100
  details: {
    price_component:   number
    sentiment_component: number
    theme_component:   number
    macro_component:   number
  }
}

// ─── Normalisation helpers ────────────────────────────────────────────────────

/** Map change_pct to 0-100. Clamp at ±10% for extreme moves. */
function normalisePricePct(pct: number): number {
  const clamped = Math.max(-10, Math.min(10, pct))
  return ((clamped + 10) / 20) * 100
}

/** Map avg sentiment (-1 to +1) to 0-100 */
function normaliseSentiment(scores: number[]): number {
  if (!scores.length) return 50  // neutral if no events
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length
  const clamped = Math.max(-1, Math.min(1, avg))
  return ((clamped + 1) / 2) * 100
}

/** Map theme conviction (0-100) to 0-100 component. No theme → neutral 50. */
function normaliseTheme(conviction: number): number {
  if (conviction === 0) return 50  // no theme data → neutral
  return conviction
}

/** Map macro score (-10 to +10) to 0-100 */
function normaliseMacro(score: number): number {
  const clamped = Math.max(-10, Math.min(10, score))
  return ((clamped + 10) / 20) * 100
}

// ─── Weights ──────────────────────────────────────────────────────────────────

const WEIGHTS = {
  price:     0.30,
  sentiment: 0.35,
  theme:     0.25,
  macro:     0.10,
}

// ─── Main scorer ──────────────────────────────────────────────────────────────

export function scoreSignal(input: SignalInput): SignalOutput {
  const price_component     = normalisePricePct(input.change_pct)
  const sentiment_component = normaliseSentiment(input.sentimentScores)
  const theme_component     = normaliseTheme(input.themeConviction)
  const macro_component     = normaliseMacro(input.macroScore)

  const score = Math.round(
    price_component     * WEIGHTS.price     +
    sentiment_component * WEIGHTS.sentiment +
    theme_component     * WEIGHTS.theme     +
    macro_component     * WEIGHTS.macro
  )

  const signal: SignalOutput['signal'] =
    score >= 65 ? 'buy'   :
    score >= 50 ? 'watch' :
    score >= 35 ? 'hold'  : 'avoid'

  return {
    signal,
    score,
    details: { price_component, sentiment_component, theme_component, macro_component },
  }
}

// ─── Batch scorer ─────────────────────────────────────────────────────────────
// Used by the financials cron — takes all the data in one pass.

export interface BatchInput {
  tickers:   { ticker: string; change_pct: number }[]
  events:    { tickers: string[]; sentiment_score: number | null; published_at: string }[]
  themes:    { ticker: string; conviction: number }[]  // flattened theme_tickers
  macroScore: number  // overall average macro score
}

export function batchScoreSignals(input: BatchInput): Map<string, SignalOutput> {
  const results = new Map<string, SignalOutput>()

  // Pre-compute sentiment per ticker from last 7 days of events
  const sentimentMap = new Map<string, number[]>()
  const cutoff = Date.now() - 7 * 24 * 3_600_000
  for (const event of input.events) {
    if (!event.sentiment_score) continue
    if (new Date(event.published_at).getTime() < cutoff) continue
    for (const t of (event.tickers ?? [])) {
      if (!sentimentMap.has(t)) sentimentMap.set(t, [])
      sentimentMap.get(t)!.push(event.sentiment_score)
    }
  }

  // Pre-compute max theme conviction per ticker
  const themeMap = new Map<string, number>()
  for (const row of input.themes) {
    const existing = themeMap.get(row.ticker) ?? 0
    if (row.conviction > existing) themeMap.set(row.ticker, row.conviction)
  }

  // Score each ticker
  for (const { ticker, change_pct } of input.tickers) {
    const result = scoreSignal({
      ticker,
      change_pct,
      sentimentScores: sentimentMap.get(ticker) ?? [],
      themeConviction: themeMap.get(ticker) ?? 0,
      macroScore:      input.macroScore,
    })
    results.set(ticker, result)
  }

  return results
}
