/**
 * lib/macro.ts
 *
 * Macro sentiment scoring engine.
 *
 * For each of the 6 macro aspects, this module:
 *  1. Filters relevant classified events from the last 7 days
 *  2. Computes a weighted score (-10 to +10)
 *  3. Asks Claude for a 1-2 sentence commentary
 *  4. Returns a MacroScore ready to upsert into macro_scores
 */

import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── Types ────────────────────────────────────────────────────────────────────

export type MacroAspect = 'fed' | 'inflation' | 'labour' | 'growth' | 'geopolitical' | 'credit'

export interface MacroScore {
  aspect:      MacroAspect
  score:       number        // -10 to +10
  direction:   'improving' | 'deteriorating' | 'stable'
  commentary:  string
  event_count: number
  scored_at:   string
}

export interface ScoringEvent {
  id:              string
  headline:        string
  ai_summary:      string | null
  event_type:      string | null
  sectors:         string[] | null
  sentiment_score: number | null
  impact_score:    number | null
  published_at:    string
}

// ─── Aspect definitions ───────────────────────────────────────────────────────

interface AspectConfig {
  label:        string
  description:  string   // shown to Claude for context
  event_types:  string[] // match on event_type
  sectors:      string[] // match on any sector keyword (case-insensitive)
  keywords:     string[] // match on headline/summary keywords
}

export const ASPECT_CONFIG: Record<MacroAspect, AspectConfig> = {
  fed: {
    label:       'Fed / Monetary Policy',
    description: 'Federal Reserve interest rate decisions, FOMC statements, QE/QT, forward guidance',
    event_types: ['monetary_policy'],
    sectors:     ['federal reserve', 'central bank', 'monetary', 'interest rate', 'fomc'],
    keywords:    ['fed', 'fomc', 'federal reserve', 'rate', 'powell', 'hawkish', 'dovish', 'taper', 'qe', 'qt'],
  },
  inflation: {
    label:       'Inflation',
    description: 'CPI, PCE, PPI data, inflation expectations, price pressures across sectors',
    event_types: ['economic_data'],
    sectors:     ['inflation', 'consumer prices', 'cpi', 'pce', 'ppi'],
    keywords:    ['inflation', 'cpi', 'pce', 'ppi', 'price', 'deflation', 'consumer price', 'producer price'],
  },
  labour: {
    label:       'Labour Market',
    description: 'Non-farm payrolls, unemployment rate, jobless claims, wage growth, labour participation',
    event_types: ['economic_data'],
    sectors:     ['employment', 'labour', 'labor', 'jobs', 'workforce'],
    keywords:    ['jobs', 'payroll', 'unemployment', 'jobless', 'nfp', 'labour', 'labor', 'hiring', 'layoff', 'wage'],
  },
  growth: {
    label:       'Growth',
    description: 'GDP, PMI, retail sales, industrial production, economic growth indicators',
    event_types: ['economic_data'],
    sectors:     ['gdp', 'pmi', 'retail', 'industrial', 'manufacturing', 'consumer'],
    keywords:    ['gdp', 'pmi', 'retail sales', 'growth', 'recession', 'expansion', 'manufacturing', 'industrial'],
  },
  geopolitical: {
    label:       'Geopolitical Risk',
    description: 'Wars, sanctions, trade disputes, political instability, supply chain disruptions',
    event_types: ['geopolitical'],
    sectors:     ['geopolitical', 'defense', 'energy', 'oil', 'sanctions', 'trade'],
    keywords:    ['war', 'conflict', 'sanction', 'tariff', 'trade', 'geopolit', 'iran', 'china', 'russia'],
  },
  credit: {
    label:       'Credit & Financial Conditions',
    description: 'Credit spreads, VIX, yield curve, financial stress, lending conditions',
    event_types: ['corporate', 'monetary_policy'],
    sectors:     ['financials', 'bonds', 'credit', 'banking', 'lending'],
    keywords:    ['credit', 'spread', 'vix', 'yield curve', 'default', 'leverage', 'debt', 'bond', 'financial conditions'],
  },
}

// ─── Event filtering ──────────────────────────────────────────────────────────

/**
 * Filter events relevant to a given macro aspect.
 * Matches on event_type, sector keywords, or headline/summary keywords.
 */
export function filterEventsForAspect(
  events: ScoringEvent[],
  aspect: MacroAspect
): ScoringEvent[] {
  const config = ASPECT_CONFIG[aspect]

  return events.filter(e => {
    // Match event_type
    if (config.event_types.includes(e.event_type ?? '')) {
      // Further filter by keyword for economic_data (too broad otherwise)
      if (e.event_type === 'economic_data') {
        return matchesKeywords(e, config.keywords) || matchesSectors(e, config.sectors)
      }
      return true
    }
    // Match sectors
    if (matchesSectors(e, config.sectors)) return true
    // Match keywords in headline/summary
    if (matchesKeywords(e, config.keywords)) return true
    return false
  })
}

function matchesSectors(e: ScoringEvent, sectors: string[]): boolean {
  const eventSectors = (e.sectors ?? []).map(s => s.toLowerCase())
  return sectors.some(s => eventSectors.some(es => es.includes(s)))
}

function matchesKeywords(e: ScoringEvent, keywords: string[]): boolean {
  const text = `${e.headline} ${e.ai_summary ?? ''}`.toLowerCase()
  return keywords.some(k => text.includes(k))
}

// ─── Score computation ────────────────────────────────────────────────────────

/**
 * Compute a macro score from -10 to +10.
 *
 * Formula per event:
 *   weight      = impact_score / 10  (0.1 to 1.0)
 *   contribution = sentiment_score × weight × recency_decay
 *   recency_decay = exp(-0.15 × age_days)
 *
 * Final score = sum(contributions) / normaliser × 10
 * Clamped to [-10, 10].
 */
export function computeMacroScore(events: ScoringEvent[]): number {
  if (!events.length) return 0

  let weightedSum  = 0
  let totalWeight  = 0

  for (const e of events) {
    const sentiment = e.sentiment_score ?? 0
    const impact    = (e.impact_score ?? 1) / 10
    const ageDays   = (Date.now() - new Date(e.published_at).getTime()) / 86_400_000
    const decay     = Math.exp(-0.15 * ageDays)
    const weight    = impact * decay

    weightedSum += sentiment * weight
    totalWeight += weight
  }

  if (totalWeight === 0) return 0

  const raw = (weightedSum / totalWeight) * 10
  return parseFloat(Math.max(-10, Math.min(10, raw)).toFixed(2))
}

/**
 * Determine direction based on score magnitude and sign.
 */
export function computeDirection(
  score: number
): 'improving' | 'deteriorating' | 'stable' {
  if (score >= 1.5)  return 'improving'
  if (score <= -1.5) return 'deteriorating'
  return 'stable'
}

// ─── Claude commentary ────────────────────────────────────────────────────────

/**
 * Generate a 1-2 sentence commentary for a macro aspect given its events.
 */
export async function generateMacroCommentary(
  aspect: MacroAspect,
  score: number,
  events: ScoringEvent[]
): Promise<string> {
  const config = ASPECT_CONFIG[aspect]
  const topEvents = events
    .sort((a, b) => (b.impact_score ?? 0) - (a.impact_score ?? 0))
    .slice(0, 5)
    .map(e => `- ${e.ai_summary ?? e.headline}`)
    .join('\n')

  const scoreLabel = score >= 3 ? 'strongly positive'
    : score >= 1  ? 'mildly positive'
    : score <= -3 ? 'strongly negative'
    : score <= -1 ? 'mildly negative'
    : 'neutral'

  const prompt = `You are a macro investment analyst. Write 1-2 sentences summarising the current state of ${config.label} for US markets.

Context: ${config.description}
Current signal: ${scoreLabel} (${score > 0 ? '+' : ''}${score}/10)

Most relevant recent events:
${topEvents || '- No significant events in the last 7 days'}

Rules:
- Be specific about the dominant driver
- Mention implications for US markets or assets
- No bullet points, plain prose only
- Maximum 40 words`

  try {
    const response = await anthropic.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 150,
      messages:   [{ role: 'user', content: prompt }],
    })

    return response.content
      .filter(b => b.type === 'text')
      .map(b => (b as any).text)
      .join('')
      .trim()
  } catch (err) {
    console.error(`[macro] commentary failed for ${aspect}:`, err)
    return `${config.label} signal is ${scoreLabel} based on ${events.length} recent events.`
  }
}

// ─── Full scoring pipeline ────────────────────────────────────────────────────

/**
 * Score a single aspect from a pool of events.
 */
export async function scoreAspect(
  aspect: MacroAspect,
  allEvents: ScoringEvent[]
): Promise<MacroScore> {
  const relevant  = filterEventsForAspect(allEvents, aspect)
  const score     = computeMacroScore(relevant)
  const direction = computeDirection(score)
  const commentary = await generateMacroCommentary(aspect, score, relevant)

  return {
    aspect,
    score,
    direction,
    commentary,
    event_count: relevant.length,
    scored_at:   new Date().toISOString(),
  }
}

// ─── Synthetic event generation ───────────────────────────────────────────────

/**
 * Generate synthetic EventInput entries from macro scores.
 * Only generates for aspects with |score| >= threshold.
 * These are fed into the theme generation pipeline alongside real events.
 *
 * On quiet news days these dominate theme generation.
 * On busy days real high-impact events outweigh them naturally.
 */
export function generateSyntheticEvents(
  macroRows: { aspect: string; score: number }[],
  threshold = 0.5
): import('@/lib/ai').EventInput[] {
  const now = new Date().toISOString()
  const synthetic: import('@/lib/ai').EventInput[] = []

  for (const { aspect, score } of macroRows) {
    if (Math.abs(score) < threshold) continue

    const config    = ASPECT_CONFIG[aspect as MacroAspect]
    const positive  = score > 0
    const magnitude = Math.abs(score)

    // Map score magnitude to impact_score (1-10)
    // |score| 1.5 → impact 4, |score| 5 → impact 7, |score| 8+ → impact 9
    const impact_score = Math.min(10, Math.round(3 + magnitude * 0.75))

    // Map score to sentiment (-1 to +1)
    const sentiment_score = parseFloat((score / 10).toFixed(3))

    const template = SYNTHETIC_TEMPLATES[aspect as MacroAspect]
    if (!template) continue

    const headline    = positive ? template.bullish_headline    : template.bearish_headline
    const ai_summary  = positive ? template.bullish_summary     : template.bearish_summary
    const event_type  = template.event_type
    const sectors     = template.sectors

    synthetic.push({
      headline,
      ai_summary,
      event_type,
      sectors,
      sentiment_score,
      impact_score,
      published_at: now,
    })
  }

  return synthetic
}

// ─── Synthetic event templates per aspect ────────────────────────────────────

interface SyntheticTemplate {
  bullish_headline: string
  bearish_headline: string
  bullish_summary:  string
  bearish_summary:  string
  event_type:       string
  sectors:          string[]
}

const SYNTHETIC_TEMPLATES: Record<MacroAspect, SyntheticTemplate> = {
  fed: {
    bullish_headline: "Federal Reserve signals dovish pivot as economic conditions improve",
    bearish_headline: "Federal Reserve maintains restrictive stance amid persistent inflation pressures",
    bullish_summary:  "Fed policy turning accommodative creates tailwind for rate-sensitive equities, REITs, and growth stocks as borrowing costs ease.",
    bearish_summary:  "Elevated interest rates sustain pressure on rate-sensitive sectors including real estate, utilities, and high-growth tech while supporting financials.",
    event_type:       "monetary_policy",
    sectors:          ["Financial Services", "Real Estate", "Technology", "Utilities"],
  },
  inflation: {
    bullish_headline: "Inflation data shows continued moderation toward Fed target",
    bearish_headline: "Inflation remains elevated challenging consumer spending and corporate margins",
    bullish_summary:  "Cooling inflation reduces pressure on Fed policy, supporting consumer discretionary spending and easing input cost pressures across sectors.",
    bearish_summary:  "Persistent inflation erodes consumer purchasing power, squeezes corporate margins, and keeps Fed rates elevated — negative for growth assets.",
    event_type:       "economic_data",
    sectors:          ["Consumer Discretionary", "Consumer Staples", "Industrials", "Materials"],
  },
  labour: {
    bullish_headline: "Strong labour market data signals robust economic foundation",
    bearish_headline: "Labour market shows signs of deterioration raising recession concerns",
    bullish_summary:  "Healthy employment supports consumer spending and corporate earnings growth, providing fundamental underpinning for equity markets.",
    bearish_summary:  "Weakening jobs market threatens consumer spending and signals potential economic slowdown, increasing recession risk for cyclical sectors.",
    event_type:       "economic_data",
    sectors:          ["Consumer Discretionary", "Financials", "Industrials", "Healthcare"],
  },
  growth: {
    bullish_headline: "Economic growth indicators beat expectations supporting risk assets",
    bearish_headline: "Growth data disappoints raising stagflation and recession fears",
    bullish_summary:  "Above-trend GDP and PMI readings support corporate earnings expectations and justify higher equity valuations across cyclical sectors.",
    bearish_summary:  "Below-trend growth data raises recession probability, favouring defensive sectors and cash while pressuring cyclical and high-beta assets.",
    event_type:       "economic_data",
    sectors:          ["Industrials", "Technology", "Consumer Discretionary", "Materials"],
  },
  geopolitical: {
    bullish_headline: "Geopolitical tensions ease supporting risk appetite and energy stability",
    bearish_headline: "Escalating geopolitical conflict disrupts energy markets and global supply chains",
    bullish_summary:  "Reduced geopolitical risk premium supports global trade flows and energy price stability, benefiting risk assets and transport sectors.",
    bearish_summary:  "Geopolitical conflict drives energy price volatility, supply chain disruptions, and flight-to-safety flows favouring defense, commodities, and gold.",
    event_type:       "geopolitical",
    sectors:          ["Energy", "Defense", "Materials", "Transportation"],
  },
  credit: {
    bullish_headline: "Financial conditions ease as credit spreads tighten and volatility falls",
    bearish_headline: "Credit conditions tighten as spreads widen and financial stress indicators rise",
    bullish_summary:  "Tight credit spreads and low volatility signal healthy financial conditions, supporting risk appetite and corporate borrowing for growth.",
    bearish_summary:  "Widening credit spreads and elevated VIX signal financial stress, tightening lending conditions and increasing downside risk for leveraged assets.",
    event_type:       "corporate",
    sectors:          ["Financials", "Real Estate", "Consumer Discretionary", "Energy"],
  },
}
