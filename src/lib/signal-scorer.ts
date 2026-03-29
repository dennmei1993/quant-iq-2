// src/lib/signal-scorer.ts
/**
 * Two-dimensional signal scoring system.
 *
 * FUNDAMENTAL SCORE (0-100) — "Is this a quality company in a good environment?"
 *   20% Valuation    — PE vs sector average (lower = better)
 *   20% Profitability — profit margin + EPS growth
 *   20% Analyst       — consensus Buy/Hold/Sell
 *   20% Theme         — conviction from active themes
 *   20% Macro         — macro score aligned to sector
 *
 * TECHNICAL SCORE (0-100) — "Is now a good time to act?"
 *   30% Trend         — price vs 5d/20d moving averages
 *   25% Momentum      — RSI(14)
 *   25% Rel Strength  — vs SPY over 30 days
 *   20% Volatility    — inverse (lower vol = better score)
 *
 * SIGNAL MATRIX (moderate default):
 *   F≥65 + T≥60 → buy
 *   F≥65 + T≥40 → watch
 *   F≥65 + T<40 → hold
 *   F 40-64 + T≥60 → watch
 *   F 40-64 + T<60 → hold
 *   F<40  + T≥60 → hold
 *   F<40  + T<40 → avoid
 *
 * RISK APPETITE SHIFT:
 *   aggressive:   T threshold -10 (acts sooner)
 *   conservative: T threshold +10 (requires confirmation)
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type RiskAppetite = 'aggressive' | 'moderate' | 'conservative'
export type SignalLabel   = 'buy' | 'watch' | 'hold' | 'avoid'

export interface FundamentalComponents {
  valuation:    number   // 0-100
  profitability:number   // 0-100
  consensus:      number   // 0-100
  theme:        number   // 0-100
  macro:        number   // 0-100
}

export interface TechnicalComponents {
  trend:          number  // 0-100
  momentum:       number  // 0-100 (RSI-based)
  rel_strength:   number  // 0-100 (vs SPY)
  volatility:     number  // 0-100 (inverse vol)
}

export interface SignalScoreResult {
  signal:             SignalLabel
  score:              number      // composite 0-100 for backward compat
  fundamental_score:  number
  technical_score:    number
  f_components:       FundamentalComponents
  t_components:       TechnicalComponents
}

export interface ScoringInput {
  ticker:         string
  asset_type:     string
  // Price data
  change_pct:     number
  sparkline:      number[]       // 30 daily closes
  spy_sparkline:  number[]       // SPY 30 daily closes for rel strength
  // Fundamental data
  pe_ratio:       number | null
  sector_pe:      number | null  // sector average PE
  profit_margin:  number | null  // percentage e.g. 27.04
  eps:            number | null
  eps_prev:       number | null  // prior period EPS for growth calc
  analyst_rating: string | null  // 'Strong Buy' | 'Buy' | 'Hold' | 'Sell' | 'Strong Sell'
  theme_conviction: number       // 0-100, highest active theme conviction
  macro_score:    number         // -10 to +10 overall macro
  sector_macro:   number         // -10 to +10 sector-specific macro aspect
}

// ─── Fundamental scoring ──────────────────────────────────────────────────────

function scoreValuation(pe: number | null, sectorPE: number | null): number {
  if (pe == null) return 50  // neutral if unknown
  if (pe <= 0)    return 20  // negative earnings = poor

  if (sectorPE && sectorPE > 0) {
    // Compare to sector: 0.5× sector PE → 90, 1× → 60, 1.5× → 40, 2× → 25
    const ratio = pe / sectorPE
    if (ratio <= 0.5) return 90
    if (ratio <= 0.8) return 75
    if (ratio <= 1.0) return 60
    if (ratio <= 1.3) return 48
    if (ratio <= 1.5) return 38
    if (ratio <= 2.0) return 28
    return 15
  }

  // Absolute PE scoring if no sector benchmark
  if (pe < 10)  return 80
  if (pe < 15)  return 70
  if (pe < 20)  return 60
  if (pe < 25)  return 52
  if (pe < 30)  return 44
  if (pe < 40)  return 35
  if (pe < 60)  return 25
  return 15
}

function scoreProfitability(margin: number | null, eps: number | null, epsPrev: number | null): number {
  let score = 50

  // Profit margin component
  if (margin != null) {
    if (margin > 30)      score += 25
    else if (margin > 20) score += 18
    else if (margin > 10) score += 10
    else if (margin > 5)  score += 3
    else if (margin < 0)  score -= 20
  }

  // EPS growth component
  if (eps != null && epsPrev != null && epsPrev !== 0) {
    const growth = ((eps - epsPrev) / Math.abs(epsPrev)) * 100
    if (growth > 30)      score += 25
    else if (growth > 15) score += 18
    else if (growth > 5)  score += 10
    else if (growth > 0)  score += 5
    else if (growth < -10) score -= 15
    else if (growth < 0)   score -= 8
  }

  return Math.max(0, Math.min(100, score))
}

function scoreAnalyst(rating: string | null): number {
  if (!rating) return 50
  const r = rating.toLowerCase()
  if (r.includes('strong buy'))  return 90
  if (r.includes('buy'))         return 75
  if (r.includes('outperform'))  return 70
  if (r.includes('overweight'))  return 68
  if (r.includes('hold'))        return 50
  if (r.includes('neutral'))     return 48
  if (r.includes('underweight')) return 30
  if (r.includes('underperform'))return 28
  if (r.includes('sell'))        return 20
  if (r.includes('strong sell')) return 10
  return 50
}

function scoreTheme(conviction: number): number {
  if (conviction === 0) return 45  // not in any theme — slightly below neutral
  return Math.min(100, 40 + conviction * 0.6)
}

function scoreMacro(macroScore: number, sectorMacro: number): number {
  // Weight sector macro more heavily (60%) vs overall (40%)
  const combined = sectorMacro * 0.6 + macroScore * 0.4
  return ((combined + 10) / 20) * 100
}

export function scoreFundamental(input: ScoringInput): { score: number; components: FundamentalComponents } {
  const valuation     = scoreValuation(input.pe_ratio, input.sector_pe)
  const profitability = scoreProfitability(input.profit_margin, input.eps, input.eps_prev)
  const consensus       = scoreAnalyst(input.analyst_rating)
  const theme         = scoreTheme(input.theme_conviction)
  const macro         = scoreMacro(input.macro_score, input.sector_macro)

  const score = Math.round(
    valuation     * 0.20 +
    profitability * 0.20 +
    consensus       * 0.20 +
    theme         * 0.20 +
    macro         * 0.20
  )

  return {
    score: Math.max(0, Math.min(100, score)),
    components: { valuation, profitability, consensus, theme, macro },
  }
}

// ─── Technical scoring ────────────────────────────────────────────────────────

function movingAverage(prices: number[], period: number): number | null {
  if (prices.length < period) return null
  const slice = prices.slice(-period)
  return slice.reduce((a, b) => a + b, 0) / period
}

function scoreTrend(prices: number[]): number {
  if (prices.length < 5) return 50
  const last  = prices[prices.length - 1]
  const ma5   = movingAverage(prices, 5)
  const ma20  = movingAverage(prices, 20)

  let score = 50

  if (ma5 != null) {
    const pctAboveMa5 = ((last - ma5) / ma5) * 100
    if (pctAboveMa5 > 5)       score += 20
    else if (pctAboveMa5 > 2)  score += 12
    else if (pctAboveMa5 > 0)  score += 6
    else if (pctAboveMa5 < -5) score -= 20
    else if (pctAboveMa5 < -2) score -= 12
    else                       score -= 6
  }

  if (ma20 != null) {
    const pctAboveMa20 = ((last - ma20) / ma20) * 100
    if (pctAboveMa20 > 5)       score += 15
    else if (pctAboveMa20 > 2)  score += 8
    else if (pctAboveMa20 > 0)  score += 4
    else if (pctAboveMa20 < -5) score -= 15
    else if (pctAboveMa20 < -2) score -= 8
    else                        score -= 4
  }

  // Golden cross: MA5 > MA20
  if (ma5 != null && ma20 != null) {
    if (ma5 > ma20 * 1.01) score += 15
    else if (ma5 < ma20 * 0.99) score -= 15
  }

  return Math.max(0, Math.min(100, score))
}

function scoreRSI(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50

  const changes = prices.slice(1).map((p, i) => p - prices[i])
  const recent  = changes.slice(-period)

  const gains  = recent.filter(c => c > 0).reduce((a, b) => a + b, 0) / period
  const losses = Math.abs(recent.filter(c => c < 0).reduce((a, b) => a + b, 0)) / period

  if (losses === 0) return 90
  const rs  = gains / losses
  const rsi = 100 - (100 / (1 + rs))

  // RSI scoring: oversold (<30) = opportunity, overbought (>70) = caution
  if (rsi < 20)      return 85   // deeply oversold — potential reversal
  if (rsi < 30)      return 72   // oversold
  if (rsi < 40)      return 62
  if (rsi < 60)      return 55   // neutral zone
  if (rsi < 70)      return 48
  if (rsi < 80)      return 38   // overbought
  return 25                      // deeply overbought
}

function scoreRelativeStrength(prices: number[], spyPrices: number[]): number {
  if (prices.length < 5 || spyPrices.length < 5) return 50

  const tickerReturn = (prices[prices.length - 1] - prices[0]) / prices[0]
  const spyReturn    = (spyPrices[spyPrices.length - 1] - spyPrices[0]) / spyPrices[0]
  const alpha        = (tickerReturn - spyReturn) * 100  // excess return in %

  if (alpha > 15)     return 90
  if (alpha > 8)      return 78
  if (alpha > 4)      return 66
  if (alpha > 1)      return 57
  if (alpha > -1)     return 50
  if (alpha > -4)     return 42
  if (alpha > -8)     return 32
  if (alpha > -15)    return 22
  return 12
}

function scoreVolatility(prices: number[]): number {
  if (prices.length < 5) return 50

  const returns = prices.slice(1).map((p, i) => (p - prices[i]) / prices[i])
  const mean    = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length
  const stdDev  = Math.sqrt(variance) * 100  // daily % std dev

  // Lower volatility = higher score (inverse)
  if (stdDev < 0.5)  return 85
  if (stdDev < 1.0)  return 75
  if (stdDev < 1.5)  return 65
  if (stdDev < 2.0)  return 55
  if (stdDev < 3.0)  return 42
  if (stdDev < 4.0)  return 32
  if (stdDev < 6.0)  return 22
  return 12
}

export function scoreTechnical(input: ScoringInput): { score: number; components: TechnicalComponents } {
  const prices    = input.sparkline
  const spyPrices = input.spy_sparkline

  const trend        = scoreTrend(prices)
  const momentum     = scoreRSI(prices)
  const rel_strength = scoreRelativeStrength(prices, spyPrices)
  const volatility   = scoreVolatility(prices)

  const score = Math.round(
    trend        * 0.30 +
    momentum     * 0.25 +
    rel_strength * 0.25 +
    volatility   * 0.20
  )

  return {
    score: Math.max(0, Math.min(100, score)),
    components: { trend, momentum, rel_strength, volatility },
  }
}

// ─── Signal matrix ────────────────────────────────────────────────────────────

export function deriveSignal(
  f: number,
  t: number,
  risk: RiskAppetite = 'moderate'
): SignalLabel {
  // Risk appetite shifts the technical threshold
  const tShift = risk === 'aggressive' ? -10 : risk === 'conservative' ? +10 : 0
  const tAdj   = t - tShift  // effectively raises/lowers the bar

  if (f >= 65) {
    if (tAdj >= 60) return 'buy'
    if (tAdj >= 40) return 'watch'
    return 'hold'
  }
  if (f >= 40) {
    if (tAdj >= 60) return 'watch'
    return 'hold'
  }
  // f < 40 (weak fundamentals)
  if (tAdj >= 60) return 'hold'
  return 'avoid'
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export function scoreSignal(
  input: ScoringInput,
  risk:  RiskAppetite = 'moderate'
): SignalScoreResult {
  const { score: fundamental_score, components: f_components } = scoreFundamental(input)
  const { score: technical_score,   components: t_components } = scoreTechnical(input)

  const signal = deriveSignal(fundamental_score, technical_score, risk)

  // Backward-compatible composite score
  const score = Math.round(fundamental_score * 0.5 + technical_score * 0.5)

  return {
    signal,
    score,
    fundamental_score,
    technical_score,
    f_components,
    t_components,
  }
}

// ─── Batch scoring ────────────────────────────────────────────────────────────

export interface BatchInput {
  tickers:      { ticker: string; asset_type: string; change_pct: number; sparkline: number[] }[]
  assets:       { ticker: string; pe_ratio: number | null; profit_margin: number | null; eps: number | null; analyst_rating: string | null; sector: string | null }[]
  themes:       { ticker: string; conviction: number }[]
  macroScores:  { aspect: string; score: number }[]
  sectorPEs:    { sector: string; pe: number }[]
  spySparkline: number[]
}

// Map sector names to macro aspects
const SECTOR_MACRO_MAP: Record<string, string> = {
  technology:    'growth',
  financials:    'fed',
  healthcare:    'growth',
  energy:        'geopolitical',
  industrials:   'growth',
  defence:       'geopolitical',
  consumer:      'labour',
  real_estate:   'fed',
  materials:     'inflation',
  utilities:     'fed',
  communication: 'growth',
  crypto:        'credit',
  commodity:     'inflation',
  bonds:         'fed',
}

export function batchScoreSignals(
  input:     BatchInput,
  risk:      RiskAppetite = 'moderate'
): Map<string, SignalScoreResult> {
  const results = new Map<string, SignalScoreResult>()

  // Pre-compute lookups
  const assetMap    = new Map(input.assets.map(a => [a.ticker, a]))
  const themeMap    = new Map<string, number>()
  const sectorPEMap = new Map(input.sectorPEs.map(s => [s.sector, s.pe]))
  const macroMap    = new Map(input.macroScores.map(m => [m.aspect, m.score]))

  for (const row of input.themes) {
    const existing = themeMap.get(row.ticker) ?? 0
    if (row.conviction > existing) themeMap.set(row.ticker, row.conviction)
  }

  const overallMacro = input.macroScores.length
    ? input.macroScores.reduce((a, m) => a + m.score, 0) / input.macroScores.length
    : 0

  for (const t of input.tickers) {
    const asset   = assetMap.get(t.ticker)
    const sector  = asset?.sector ?? 'general'
    const macroAspect = SECTOR_MACRO_MAP[sector] ?? 'growth'

    const scoringInput: ScoringInput = {
      ticker:           t.ticker,
      asset_type:       t.asset_type,
      change_pct:       t.change_pct,
      sparkline:        t.sparkline,
      spy_sparkline:    input.spySparkline,
      pe_ratio:         asset?.pe_ratio ?? null,
      sector_pe:        sectorPEMap.get(sector) ?? null,
      profit_margin:    asset?.profit_margin ?? null,
      eps:              asset?.eps ?? null,
      eps_prev:         null,  // would need historical — future enhancement
      analyst_rating:   asset?.analyst_rating ?? null,
      theme_conviction: themeMap.get(t.ticker) ?? 0,
      macro_score:      overallMacro,
      sector_macro:     macroMap.get(macroAspect) ?? 0,
    }

    results.set(t.ticker, scoreSignal(scoringInput, risk))
  }

  return results
}
