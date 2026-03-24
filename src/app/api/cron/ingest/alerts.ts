/**
 * lib/alerts.ts
 *
 * Auto-alert generation engine.
 *
 * Called from the ingest cron after new events are classified.
 * For each user with holdings, checks whether any recent high/medium-impact
 * events affect their held tickers or sectors and inserts alert rows.
 *
 * Alert types generated here:
 *   - 'portfolio_risk'  : a high-impact event directly hits a held ticker
 *   - 'macro_shift'     : a high-impact macro event affects a held sector
 *   - 'theme_update'    : a new theme includes a held ticker as candidate
 *
 * De-duplication: we check for an existing unread alert for the same
 * (user_id, event_id) pair before inserting to avoid flooding.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = any

// ─── Types (mirrors DB schema) ──────────────────────────────────────────────

interface EventRow {
  id: string
  headline: string
  ai_summary: string | null
  event_type: string | null
  sectors: string[] | null
  tickers: string[] | null
  sentiment_score: number
  impact_level: string | null
  published_at: string
}

interface HoldingRow {
  id: string
  ticker: string
  portfolio_id: string
}

interface PortfolioRow {
  id: string
  user_id: string
  holdings: HoldingRow[]
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Generate alerts for all users with portfolios.
 * Looks at events from the last 24 hours that are:
 *   - ai_processed = true
 *   - impact_level in ('high', 'medium')
 *
 * Returns the total number of new alerts inserted.
 */
export async function generateAlertsForAllUsers(
  supabase: AnySupabaseClient
): Promise<number> {
  // 1. Fetch recent high/medium impact events (last 24h)
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data: events, error: eventsErr } = await supabase
    .from('events')
    .select('id, headline, ai_summary, event_type, sectors, tickers, sentiment_score, impact_level, published_at')
    .eq('ai_processed', true)
    .in('impact_level', ['high', 'medium'])
    .gte('published_at', since)
    .order('published_at', { ascending: false })
    .limit(50)

  if (eventsErr) throw new Error(`Failed to fetch events: ${eventsErr.message}`)
  if (!events?.length) return 0

  // 2. Fetch all portfolios with their holdings (users who have holdings)
  const { data: portfolios, error: portErr } = await supabase
    .from('portfolios')
    .select(`
      id,
      user_id,
      holdings (
        id,
        ticker
      )
    `)

  if (portErr) throw new Error(`Failed to fetch portfolios: ${portErr.message}`)
  if (!portfolios?.length) return 0

  // Filter to portfolios that actually have holdings
  const activePortfolios = portfolios.filter(
    (p: any) => p.holdings?.length > 0
  ) as PortfolioRow[]

  if (!activePortfolios.length) return 0

  // 3. Also fetch latest themes to check theme_update alerts
  const { data: activeThemes } = await supabase
    .from('themes')
    .select('id, name, timeframe, candidate_tickers, conviction')
    .eq('is_active', true)

  // 4. For each portfolio × event combination, check for matches
  let totalInserted = 0

  for (const portfolio of activePortfolios) {
    const heldTickers = new Set(portfolio.holdings.map(h => h.ticker.toUpperCase()))

    // Also fetch the asset sectors for held tickers so we can match on sector
    const { data: assetRows } = await supabase
      .from('assets')
      .select('ticker, sector')
      .in('ticker', [...heldTickers])

    const tickerSectorMap = new Map<string, string>()
    for (const a of assetRows ?? []) {
      if (a.sector) tickerSectorMap.set(a.ticker.toUpperCase(), a.sector)
    }

    const heldSectors = new Set(
      [...heldTickers].map(t => tickerSectorMap.get(t)).filter(Boolean) as string[]
    )

    for (const event of events as EventRow[]) {
      // De-duplicate: skip if this user already has an alert for this event
      const { data: existingAlert } = await supabase
        .from('alerts')
        .select('id')
        .eq('user_id', portfolio.user_id)
        .eq('event_id', event.id)
        .maybeSingle()

      if (existingAlert) continue

      // Determine if there's a match and what kind
      const match = resolveAlertMatch(event, heldTickers, heldSectors)
      if (!match) continue

      // Build the alert message
      const message = buildAlertMessage(match.type, event, match.matchedTicker)

      const { error: insertErr } = await supabase
        .from('alerts')
        .insert({
          user_id: portfolio.user_id,
          event_id: event.id,
          alert_type: match.type,
          title: match.title,
          message,
          severity: event.impact_level === 'high' ? 'high' : 'medium',
          sentiment: sentimentLabel(event.sentiment_score),
          is_read: false,
          created_at: new Date().toISOString(),
        })

      if (!insertErr) {
        totalInserted++
      } else {
        console.error(`[alerts] Insert failed for user ${portfolio.user_id}:`, insertErr.message)
      }
    }

    // Theme-based alerts: check if any active theme candidate_tickers overlap holdings
    if (activeThemes) {
      for (const theme of activeThemes) {
        const candidates = (theme.candidate_tickers ?? []).map((t: string) => t.toUpperCase())
        const overlap = candidates.filter((t: string) => heldTickers.has(t))

        if (overlap.length === 0) continue

        // De-duplicate theme alerts: check by (user_id, theme_id)
        const { data: existingThemeAlert } = await supabase
          .from('alerts')
          .select('id')
          .eq('user_id', portfolio.user_id)
          .eq('theme_id', theme.id)
          .maybeSingle()

        if (existingThemeAlert) continue

        const { error: insertErr } = await supabase
          .from('alerts')
          .insert({
            user_id: portfolio.user_id,
            theme_id: theme.id,
            alert_type: 'theme_update',
            title: `New ${theme.timeframe} theme includes your holdings`,
            message: `The "${theme.name}" theme (${theme.conviction}% conviction) lists ${overlap.join(', ')} as candidate tickers — assets you currently hold.`,
            severity: theme.conviction >= 70 ? 'high' : 'medium',
            sentiment: 'bullish', // themes are always forward-looking positives
            is_read: false,
            created_at: new Date().toISOString(),
          })

        if (!insertErr) totalInserted++
      }
    }
  }

  return totalInserted
}

// ─── Match resolution ────────────────────────────────────────────────────────

interface AlertMatch {
  type: 'portfolio_risk' | 'macro_shift' | 'theme_update'
  title: string
  matchedTicker?: string
}

function resolveAlertMatch(
  event: EventRow,
  heldTickers: Set<string>,
  heldSectors: Set<string>
): AlertMatch | null {
  const eventTickers = (event.tickers ?? []).map(t => t.toUpperCase())
  const eventSectors = event.sectors ?? []

  // Direct ticker match → portfolio_risk (highest priority)
  const tickerOverlap = eventTickers.find(t => heldTickers.has(t))
  if (tickerOverlap) {
    const sentiment = event.sentiment_score < -0.2
      ? '⚠ Bearish signal'
      : event.sentiment_score > 0.2
        ? '↑ Bullish signal'
        : 'Neutral signal'
    return {
      type: 'portfolio_risk',
      title: `${sentiment}: ${tickerOverlap} in your portfolio`,
      matchedTicker: tickerOverlap,
    }
  }

  // Sector match → macro_shift
  const sectorOverlap = eventSectors.find(s => heldSectors.has(s))
  if (sectorOverlap && event.impact_level === 'high') {
    return {
      type: 'macro_shift',
      title: `Macro shift affecting your ${sectorOverlap} holdings`,
    }
  }

  return null
}

// ─── Message builder ─────────────────────────────────────────────────────────

function buildAlertMessage(
  type: AlertMatch['type'],
  event: EventRow,
  matchedTicker?: string
): string {
  const summary = event.ai_summary ?? event.headline
  const scoreStr = `Sentiment: ${(event.sentiment_score * 100).toFixed(0)}/100`

  switch (type) {
    case 'portfolio_risk':
      return `${summary} — This event directly references ${matchedTicker}, which is in your portfolio. ${scoreStr}.`

    case 'macro_shift':
      return `${summary} — This ${event.event_type ?? 'macro'} event affects your sector exposure. ${scoreStr}.`

    default:
      return summary
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sentimentLabel(score: number): 'bullish' | 'bearish' | 'neutral' {
  if (score > 0.2) return 'bullish'
  if (score < -0.2) return 'bearish'
  return 'neutral'
}
