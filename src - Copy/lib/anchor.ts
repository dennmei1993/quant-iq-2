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
 *   sentiment_magnitude = |sentiment_score|  (0–1)
 *   impact_weight       = derived from numeric impact_score (0-10):
 *                           ≥7 → 1.0 (high)
 *                           ≥4 → 0.5 (medium)
 *                           <4 → 0.2 (low)
 *   recency_decay       = exp(-0.1 × age_days)  (today=1.0, 7d=0.50, 14d=0.25)
 *
 * anchor_score = sum of all event contributions (unbounded — compounds)
 *
 * Thresholds:
 *   > 0    → any signal
 *   > 0.5  → moderate anchor
 *   > 1.0  → strong anchor (multiple high-impact events)
 *   < 0.15 → signal faded — theme should be replaced
 *
 * Replace condition:
 *   new_score > current_score × 1.2  (new signal ≥20% stronger)
 *   OR current_score < 0.15          (current signal faded)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ScoredEvent {
  id:              string
  headline:        string
  event_type:      string | null
  sentiment_score: number | null
  impact_score:    number | null
  published_at:    string
}

export interface AnchorResult {
  score:         number
  anchor_event:  ScoredEvent
  anchor_reason: string
}

// ─── Constants ───────────────────────────────────────────────────────────────

const FADE_THRESHOLD = 0.15   // score below this → theme faded
const REPLACE_MARGIN = 1.2    // new score must exceed current × this to replace

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert numeric impact_score (0-10) to a categorical weight */
function impactWeight(score: number | null): number {
  const s = score ?? 0
  if (s >= 7) return 1.0   // high
  if (s >= 4) return 0.5   // medium
  return 0.2                // low
}

function buildReason(event: ScoredEvent): string {
  const typeLabel  = EVENT_TYPE_LABELS[event.event_type ?? ''] ?? 'Market event'
  const impactLabel = event.impact_score != null
    ? `${event.impact_score}/10 impact`
    : 'notable impact'
  return `${typeLabel} — ${impactLabel}`
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  monetary_policy:  'Central bank decision',
  geopolitical:     'Geopolitical event',
  corporate:        'Corporate event',
  economic_data:    'Economic data release',
  regulatory:       'Regulatory development',
  market_structure: 'Market structure shift',
}

// ─── Main exports ─────────────────────────────────────────────────────────────

/**
 * Compute the anchor score for a set of events.
 */
export function computeAnchorScore(
  events: ScoredEvent[]
): Omit<AnchorResult, 'should_replace'> {
  if (!events.length) {
    // Return a dummy event to avoid null — caller should check events.length first
    return {
      score:         0,
      anchor_event:  { id: '', headline: '', event_type: null, sentiment_score: null, impact_score: null, published_at: new Date().toISOString() },
      anchor_reason: 'No recent events',
    }
  }

  const scored = events.map(e => {
    const ageDays    = (Date.now() - new Date(e.published_at).getTime()) / 86_400_000
    const magnitude  = Math.abs(e.sentiment_score ?? 0)
    const decay      = Math.exp(-0.1 * ageDays)
    const iWeight    = impactWeight(e.impact_score)
    const contribution = magnitude * iWeight * decay
    return { event: e, contribution }
  })

  const totalScore = scored.reduce((sum, s) => sum + s.contribution, 0)

  // Top event = highest individual contributor
  const top = [...scored].sort((a, b) => b.contribution - a.contribution)[0]

  return {
    score:         parseFloat(totalScore.toFixed(4)),
    anchor_event:  top.event,
    anchor_reason: buildReason(top.event),
  }
}

/**
 * Determine whether a new anchor score should replace the current theme.
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