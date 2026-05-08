// src/lib/signal-scorer.ts
// Two-dimensional signal scoring engine.
// Combines fundamental and technical scores into a composite signal.
// Output: 'buy' | 'watch' | 'hold' | 'avoid' with 0-100 score.

// ─── Types ────────────────────────────────────────────────────────────────────

export type Signal = 'buy' | 'watch' | 'hold' | 'avoid'

export interface TickerInput {
  ticker:     string
  asset_type: string   // 'stock' | 'etf' | 'crypto' | 'commodity'
  change_pct: number   // today's % change
  sparkline:  number[] // last N daily closes
}

export interface AssetFundamentals {
  ticker:         string
  asset_type:     string
  sector:         string | null
  pe_ratio:       number | null
  profit_margin:  number | null
  eps:            number | null
  analyst_rating: string | null
}

export interface ThemeRow {
  ticker:     string
  conviction: number  // 0-100
}

export interface MacroRow {
  aspect: string
  score:  number  // -1 to 1
}

export interface SectorPE {
  sector: string
  median_pe: number
}

export interface SignalResult {
  signal:            Signal
  score:             number   // 0-100 composite
  fundamental_score: number | null
  technical_score:   number | null
  f_components:      Record<string, number> | null
  t_components:      Record<string, number> | null
}

export interface BatchScoreInput {
  tickers:      TickerInput[]
  assets:       AssetFundamentals[]
  themes:       ThemeRow[]
  macroScores:  MacroRow[]
  sectorPEs:    SectorPE[]
  spySparkline: number[]  // SPY closes for relative strength
}

// ─── Technical scoring ────────────────────────────────────────────────────────

function scoreMomentum(sparkline: number[]): number {
  if (sparkline.length < 2) return 50
  const first = sparkline[0]
  const last  = sparkline[sparkline.length - 1]
  if (first === 0) return 50
  const pct = ((last - first) / first) * 100
  // Map -10%..+10% to 0..100
  return Math.max(0, Math.min(100, 50 + pct * 5))
}

function scoreRelativeStrength(sparkline: number[], spySparkline: number[]): number {
  if (sparkline.length < 2 || spySparkline.length < 2) return 50
  const tickerReturn = (sparkline[sparkline.length - 1] - sparkline[0]) / sparkline[0]
  const spyReturn    = (spySparkline[spySparkline.length - 1] - spySparkline[0]) / spySparkline[0]
  const rs = tickerReturn - spyReturn
  // Map -5%..+5% relative outperformance to 0..100
  return Math.max(0, Math.min(100, 50 + rs * 1000))
}

function scoreTrend(sparkline: number[]): number {
  if (sparkline.length < 3) return 50
  // Count how many days close > previous close
  let upDays = 0
  for (let i = 1; i < sparkline.length; i++) {
    if (sparkline[i] > sparkline[i - 1]) upDays++
  }
  return (upDays / (sparkline.length - 1)) * 100
}

function scoreDayChange(changePct: number): number {
  // Map -5%..+5% to 0..100
  return Math.max(0, Math.min(100, 50 + changePct * 10))
}

function technicalScore(input: TickerInput, spySparkline: number[]): {
  score: number
  components: Record<string, number>
} {
  const momentum  = scoreMomentum(input.sparkline)
  const relStr    = scoreRelativeStrength(input.sparkline, spySparkline)
  const trend     = scoreTrend(input.sparkline)
  const dayChange = scoreDayChange(input.change_pct)

  // Weighted composite
  const score = Math.round(
    momentum  * 0.30 +
    relStr    * 0.30 +
    trend     * 0.25 +
    dayChange * 0.15
  )

  return {
    score,
    components: { momentum, relStr, trend, dayChange },
  }
}

// ─── Fundamental scoring ──────────────────────────────────────────────────────

function scoreAnalystRating(rating: string | null): number {
  if (!rating) return 50
  const r = rating.toLowerCase()
  if (r.includes('strong buy'))  return 90
  if (r.includes('buy'))         return 75
  if (r.includes('outperform'))  return 70
  if (r.includes('hold'))        return 50
  if (r.includes('underperform')) return 30
  if (r.includes('sell'))        return 15
  return 50
}

function scorePE(pe: number | null, sectorPEs: SectorPE[], sector: string | null): number {
  if (!pe || pe <= 0) return 50
  // Find sector median PE
  const sectorMedian = sector
    ? sectorPEs.find(s => s.sector.toLowerCase() === sector.toLowerCase())?.median_pe
    : null
  const benchmark = sectorMedian ?? 20 // default market PE
  const ratio = pe / benchmark
  // Below median PE = better value
  if (ratio < 0.5)  return 85
  if (ratio < 0.75) return 70
  if (ratio < 1.0)  return 60
  if (ratio < 1.5)  return 45
  if (ratio < 2.0)  return 30
  return 15
}

function scoreProfitMargin(margin: number | null): number {
  if (margin === null) return 50
  if (margin >= 0.25)  return 90
  if (margin >= 0.15)  return 75
  if (margin >= 0.08)  return 60
  if (margin >= 0.02)  return 45
  if (margin >= 0)     return 35
  return 20 // negative margin
}

function scoreEPS(eps: number | null): number {
  if (eps === null) return 50
  if (eps > 10)  return 90
  if (eps > 5)   return 80
  if (eps > 2)   return 70
  if (eps > 0)   return 55
  return 25 // negative EPS
}

function fundamentalScore(
  asset: AssetFundamentals,
  sectorPEs: SectorPE[]
): { score: number; components: Record<string, number> } | null {
  // ETFs/crypto/commodities don't have fundamentals
  if (asset.asset_type !== 'stock') return null

  const hasAny = asset.pe_ratio !== null || asset.profit_margin !== null ||
                 asset.eps !== null      || asset.analyst_rating !== null
  if (!hasAny) return null

  const analyst = scoreAnalystRating(asset.analyst_rating)
  const pe      = scorePE(asset.pe_ratio, sectorPEs, asset.sector)
  const margin  = scoreProfitMargin(asset.profit_margin)
  const eps     = scoreEPS(asset.eps)

  // Weighted composite — analyst rating gets highest weight as it's most forward-looking
  const score = Math.round(
    analyst * 0.40 +
    pe      * 0.25 +
    margin  * 0.20 +
    eps     * 0.15
  )

  return {
    score,
    components: { analyst, pe, margin, eps },
  }
}

// ─── Theme + macro boosters ───────────────────────────────────────────────────

function themeBoost(ticker: string, themes: ThemeRow[]): number {
  const tickerThemes = themes.filter(t => t.ticker === ticker)
  if (tickerThemes.length === 0) return 0
  const maxConviction = Math.max(...tickerThemes.map(t => t.conviction))
  // Max +10 point boost for 100 conviction theme
  return (maxConviction / 100) * 10
}

function macroBoost(assetType: string, sector: string | null, macroScores: MacroRow[]): number {
  if (macroScores.length === 0) return 0

  const relevantAspects: string[] = []

  // Map asset type/sector to relevant macro aspects
  if (assetType === 'crypto')    relevantAspects.push('crypto', 'risk_appetite')
  if (assetType === 'commodity') relevantAspects.push('commodities', 'inflation')
  if (sector) {
    const s = sector.toLowerCase()
    if (s.includes('tech'))      relevantAspects.push('growth', 'tech')
    if (s.includes('energy'))    relevantAspects.push('commodities', 'energy')
    if (s.includes('financial')) relevantAspects.push('rates', 'financials')
    if (s.includes('health'))    relevantAspects.push('defensives')
    if (s.includes('util'))      relevantAspects.push('rates', 'defensives')
  }

  const relevant = macroScores.filter(m =>
    relevantAspects.some(a => m.aspect.toLowerCase().includes(a))
  )
  if (relevant.length === 0) return 0

  const avgScore = relevant.reduce((s, m) => s + m.score, 0) / relevant.length
  // avgScore is -1..1, map to -5..+5 point adjustment
  return avgScore * 5
}

// ─── Signal classification ────────────────────────────────────────────────────

function classifySignal(score: number): Signal {
  if (score >= 72) return 'buy'
  if (score >= 55) return 'watch'
  if (score >= 38) return 'hold'
  return 'avoid'
}

// ─── Batch scorer ─────────────────────────────────────────────────────────────

export function batchScoreSignals(input: BatchScoreInput): Map<string, SignalResult> {
  const { tickers, assets, themes, macroScores, sectorPEs, spySparkline } = input
  const results = new Map<string, SignalResult>()

  const assetMap = new Map(assets.map(a => [a.ticker, a]))

  for (const ticker of tickers) {
    const asset = assetMap.get(ticker.ticker)

    // Technical score (all asset types)
    const tech = technicalScore(ticker, spySparkline)

    // Fundamental score (stocks only)
    const fund = asset ? fundamentalScore(asset, sectorPEs) : null

    // Composite score
    let composite: number
    if (fund) {
      // Blend technical and fundamental 50/50 for stocks with fundamentals
      composite = Math.round(tech.score * 0.5 + fund.score * 0.5)
    } else {
      // Technical only for ETFs, crypto, commodities or stocks without fundamentals
      composite = tech.score
    }

    // Apply theme and macro boosts
    const tBoost = themeBoost(ticker.ticker, themes)
    const mBoost = macroBoost(
      ticker.asset_type,
      asset?.sector ?? null,
      macroScores
    )

    composite = Math.max(0, Math.min(100, Math.round(composite + tBoost + mBoost)))

    results.set(ticker.ticker, {
      signal:            classifySignal(composite),
      score:             composite,
      fundamental_score: fund?.score ?? null,
      technical_score:   tech.score,
      f_components:      fund?.components ?? null,
      t_components:      tech.components,
    })
  }

  return results
}
