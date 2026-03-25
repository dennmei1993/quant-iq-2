/**
 * lib/anchor.ts
 *
 * Theme anchor scoring engine.
 *
 * An anchor score represents how strongly a set of recent events
 * is driving a theme. Higher = more persistent signal.
 *
 * Formula per event:
 *   contribution = sentiment_magnitude × impact_weight × recency_decay
 *
 * Where:
 *   sentiment_magnitude = |sentiment_score|  (0–1, direction doesn't matter for persistence)
 *   impact_weight       = high:1.0 / medium:0.5 / low:0.2
 *   recency_decay       = exp(-0.1 × age_days)  (today=1.0, 7days=0.50, 14days=0.25)
 *
 * Portfolio anchor_score = sum of all matching event contributions
 *
 * Thresholds:
 *   anchor_score > 0  → theme is anchored (any signal)
 *   anchor_score > 0.5 → moderate anchor
 *   anchor_score > 1.0 → strong anchor (multiple high-impact events)
 *   anchor_score < 0.15 → signal faded, theme should be replaced
 *
 * Replace condition:
 *   new_score > current_score × 1.2  (new signal is 20% stronger)
 *   OR current_score < 0.15          (current signal faded)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ScoredEvent {
  id:              string
  headline:        string
  event_type:      string | null
  sentiment_score: number | null
  impact_score: number | null
  published_at:    string
}

export interface AnchorResult {
  score:          number      // computed anchor strength
  anchor_event:   ScoredEvent // the single most impactful event driving the theme
  anchor_reason:  string      // human-readable label for UI
  should_replace: boolean     // whether this score beats the current theme
}

// ─── Constants ───────────────────────────────────────────────────────────────

const IMPACT_WEIGHT: Record<string, number> = {
  high:   1.0,
  medium: 0.5,
  low:    0.2,
}

const FADE_THRESHOLD   = 0.15  // score below this → theme has faded
const REPLACE_MARGIN   = 1.2   // new score must exceed current × this to replace

// ─── Main exports ─────────────────────────────────────────────────────────────

/**
 * Compute the anchor score for a set of events.
 * Returns the score, the top driving event, and a human-readable reason.
 */
export function computeAnchorScore(events: ScoredEvent[]): Omit<AnchorResult, 'should_replace'> {
  if (!events.length) {
    return {
      score:         0,
      anchor_event:  events[0],
      anchor_reason: 'No recent events',
    }
  }

  // Score each event
  const scored = events.map(e => {
    const ageDays = (Date.now() - new Date(e.published_at).getTime()) / 86_400_000
    const impactW = IMPACT_WEIGHT[e.impact_score ?? 1] ?? 0.2
    const magnitude = Math.abs(e.sentiment_score ?? 0)
    const decay = Math.exp(-0.1 * ageDays)
    const contribution = magnitude * impactW * decay

    return { event: e, contribution }
  })

  // Total score = sum of all contributions
  const totalScore = scored.reduce((sum, s) => sum + s.contribution, 0)

  // Top event = highest individual contributor
  const top = scored.sort((a, b) => b.contribution - a.contribution)[0]

  const reason = buildReason(top.event)

  return {
    score:        parseFloat(totalScore.toFixed(4)),
    anchor_event: top.event,
    anchor_reason: reason,
  }
}

/**
 * Determine whether a new anchor score should replace the current theme.
 * Returns true if:
 *   - Current score has faded below FADE_THRESHOLD, OR
 *   - New score is at least REPLACE_MARGIN × stronger than current
 */
export function shouldReplaceTheme(
  currentScore: number,
  newScore:     number
): { replace: boolean; reason: string } {
  if (currentScore < FADE_THRESHOLD) {
    return {
      replace: true,
      reason:  `Current theme signal faded (score ${currentScore.toFixed(3)} < ${FADE_THRESHOLD})`,
    }
  }

  if (newScore > currentScore * REPLACE_MARGIN) {
    return {
      replace: true,
      reason:  `Stronger signal detected (${newScore.toFixed(3)} > ${currentScore.toFixed(3)} × ${REPLACE_MARGIN})`,
    }
  }

  return {
    replace: false,
    reason:  `Theme anchored (score ${currentScore.toFixed(3)}, new: ${newScore.toFixed(3)})`,
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildReason(event: ScoredEvent): string {
  const typeLabel = EVENT_TYPE_LABELS[event.event_type ?? ''] ?? 'Market event'
  const impactLabel = event.impact_score
    ? `${event.impact_score}/10 impact` : "notable impact"

  return `${typeLabel} — ${impactLabel}`
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  monetary_policy: 'Central bank decision',
  geopolitical:    'Geopolitical event',
  corporate:       'Corporate event',
  economic_data:   'Economic data release',
  regulatory:      'Regulatory development',
  market_structure:'Market structure shift',
}
