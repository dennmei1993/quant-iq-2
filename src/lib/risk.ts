/**
 * lib/risk.ts
 *
 * Portfolio risk scoring engine.
 *
 * Computes a 0–100 risk score for a portfolio by:
 *   1. Loading all holdings for the portfolio
 *   2. For each holding, finding recent events that reference the ticker or its sector
 *   3. Weighting events by impact_level, sentiment_score, and recency
 *   4. Aggregating into a portfolio-level risk score + per-holding breakdown
 *
 * Risk score interpretation:
 *   0–25  : Low risk — mostly bullish/neutral signals
 *   26–50 : Moderate risk — mixed signals
 *   51–75 : Elevated risk — bearish signals present
 *   76–100: High risk — multiple high-impact bearish events
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = any

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HoldingRisk {
  ticker: string
  quantity: number | null
  avg_cost: number | null
  risk_score: number       // 0–100 for this holding
  risk_label: 'low' | 'moderate' | 'elevated' | 'high'
  signal: 'bullish' | 'bearish' | 'neutral'
  event_count: number      // number of matching events in lookback window
  top_event: {
    id: string
    headline: string
    ai_summary: string | null
    sentiment_score: number
    impact_level: string | null
    published_at: string
  } | null
}

export interface PortfolioRisk {
  portfolio_id: string
  risk_score: number           // 0–100 aggregate
  risk_label: 'low' | 'moderate' | 'elevated' | 'high'
  holdings: HoldingRisk[]
  computed_at: string          // ISO timestamp
  event_coverage: number       // % of holdings with at least 1 matching event
}

// ─── Constants ───────────────────────────────────────────────────────────────

// How many days back to look for relevant events
const LOOKBACK_DAYS = 7

// Impact level weights
const IMPACT_WEIGHT: Record<string, number> = {
  high: 1.0,
  medium: 0.5,
  low: 0.2,
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function computePortfolioRisk(
  supabase: AnySupabaseClient,
  portfolioId: string
): Promise<PortfolioRisk> {
  // 1. Load holdings
  const { data: holdings, error: holdErr } = await supabase
    .from('holdings')
    .select('id, ticker, quantity, avg_cost')
    .eq('portfolio_id', portfolioId)

  if (holdErr) throw new Error(`Failed to load holdings: ${holdErr.message}`)
  if (!holdings?.length) {
    return emptyRisk(portfolioId)
  }

  // 2. Load asset sectors for held tickers
  const tickers = holdings.map(h => h.ticker.toUpperCase())

  const { data: assets } = await supabase
    .from('assets')
    .select('ticker, sector')
    .in('ticker', tickers)

  const tickerSectorMap = new Map<string, string>()
  for (const a of assets ?? []) {
    if (a.sector) tickerSectorMap.set(a.ticker.toUpperCase(), a.sector)
  }

  // 3. Load recent events
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data: events, error: evErr } = await supabase
    .from('events')
    .select('id, headline, ai_summary, event_type, sectors, tickers, sentiment_score, impact_level, published_at')
    .eq('ai_processed', true)
    .gte('published_at', since)
    .order('published_at', { ascending: false })
    .limit(100)

  if (evErr) throw new Error(`Failed to load events: ${evErr.message}`)

  const recentEvents = events ?? []

  // 4. Score each holding
  const holdingRisks: HoldingRisk[] = holdings.map(holding => {
    const ticker = holding.ticker.toUpperCase()
    const sector = tickerSectorMap.get(ticker)

    // Find matching events: either the event tags this ticker OR its sector
    const matchingEvents = recentEvents.filter(e => {
      const eventTickers = (e.tickers ?? []).map((t: string) => t.toUpperCase())
      const eventSectors = e.sectors ?? []

      return (
        eventTickers.includes(ticker) ||
        (sector && eventSectors.includes(sector))
      )
    })

    if (!matchingEvents.length) {
      return {
        ticker,
        quantity: holding.quantity,
        avg_cost: holding.avg_cost,
        risk_score: 25, // baseline — no news is neutral/low risk
        risk_label: 'low',
        signal: 'neutral',
        event_count: 0,
        top_event: null,
      }
    }

    // Score = weighted average of (1 - normalised_sentiment) × impact_weight
    // sentiment_score is -1 (bearish) to +1 (bullish)
    // We invert it so bearish → high risk contribution
    let weightedSum = 0
    let weightTotal = 0

    for (const e of matchingEvents) {
      const impactW = IMPACT_WEIGHT[e.impact_level ?? 'low'] ?? 0.2
      // Recency decay: events from today get weight 1.0, 7 days ago get ~0.43
      const ageDays =
        (Date.now() - new Date(e.published_at).getTime()) / (1000 * 60 * 60 * 24)
      const recencyW = Math.exp(-0.2 * ageDays)

      const w = impactW * recencyW
      // Convert sentiment to risk contribution: bearish (-1) → 100 risk, bullish (+1) → 0 risk
      const riskContrib = ((1 - e.sentiment_score) / 2) * 100

      weightedSum += riskContrib * w
      weightTotal += w
    }

    const holdingScore = weightTotal > 0
      ? Math.round(weightedSum / weightTotal)
      : 25

    // Sort matching events by impact × |sentiment| to find most significant
    const sortedEvents = [...matchingEvents].sort((a, b) => {
      const impactA = IMPACT_WEIGHT[a.impact_level ?? 'low'] ?? 0.2
      const impactB = IMPACT_WEIGHT[b.impact_level ?? 'low'] ?? 0.2
      return (impactB * Math.abs(b.sentiment_score)) - (impactA * Math.abs(a.sentiment_score))
    })

    const topEvent = sortedEvents[0]

    return {
      ticker,
      quantity: holding.quantity,
      avg_cost: holding.avg_cost,
      risk_score: holdingScore,
      risk_label: scoreToLabel(holdingScore),
      signal: scoreToSignal(holdingScore),
      event_count: matchingEvents.length,
      top_event: {
        id: topEvent.id,
        headline: topEvent.headline,
        ai_summary: topEvent.ai_summary,
        sentiment_score: topEvent.sentiment_score,
        impact_level: topEvent.impact_level,
        published_at: topEvent.published_at,
      },
    }
  })

  // 5. Aggregate portfolio score
  // Weight by position value where we have data, otherwise equal-weight
  let portfolioScore: number

  const scoredHoldings = holdingRisks.filter(h => h.event_count > 0)
  const eventCoverage = scoredHoldings.length / holdingRisks.length

  if (holdingRisks.length === 0) {
    portfolioScore = 0
  } else {
    // Equal weight across all holdings (we don't have live prices for $ weighting)
    const sum = holdingRisks.reduce((acc, h) => acc + h.risk_score, 0)
    portfolioScore = Math.round(sum / holdingRisks.length)
  }

  return {
    portfolio_id: portfolioId,
    risk_score: portfolioScore,
    risk_label: scoreToLabel(portfolioScore),
    holdings: holdingRisks,
    computed_at: new Date().toISOString(),
    event_coverage: Math.round(eventCoverage * 100),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function scoreToLabel(score: number): 'low' | 'moderate' | 'elevated' | 'high' {
  if (score <= 25) return 'low'
  if (score <= 50) return 'moderate'
  if (score <= 75) return 'elevated'
  return 'high'
}

function scoreToSignal(score: number): 'bullish' | 'bearish' | 'neutral' {
  if (score <= 35) return 'bullish'
  if (score >= 65) return 'bearish'
  return 'neutral'
}

function emptyRisk(portfolioId: string): PortfolioRisk {
  return {
    portfolio_id: portfolioId,
    risk_score: 0,
    risk_label: 'low',
    holdings: [],
    computed_at: new Date().toISOString(),
    event_coverage: 0,
  }
}
