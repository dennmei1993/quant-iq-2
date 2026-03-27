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
