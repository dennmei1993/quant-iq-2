/**
 * lib/watchlist-alerts.ts
 *
 * Scans recent high-impact events against watchlist themes.
 * For each watchlist theme, checks if any event's tickers or sectors
 * overlap with the theme's mapped tickers. If so, inserts an alert
 * for all users with portfolios.
 *
 * Called from the ingest cron after classification completes.
 * Impact threshold: impact_score >= 5 (medium-high or above).
 */

type AnySupabaseClient = any

interface WatchlistTheme {
  id:         string
  name:       string
  conviction: number | null
  tickers:    string[]
}

interface EventRow {
  id:              string
  headline:        string
  ai_summary:      string | null
  event_type:      string | null
  sectors:         string[] | null
  tickers:         string[] | null
  sentiment_score: number | null
  impact_score:    number | null
  published_at:    string
}

export async function generateWatchlistAlerts(
  supabase: AnySupabaseClient
): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // 1. Fetch recent significant events
  const eventsResult = await (supabase
    .from('events')
    .select('id, headline, ai_summary, event_type, sectors, tickers, sentiment_score, impact_score, published_at')
    .eq('ai_processed', true)
    .gte('impact_score', 5)
    .gte('published_at', since)
    .order('impact_score', { ascending: false })
    .limit(30) as unknown as Promise<{ data: EventRow[] | null }>)

  const events = eventsResult.data ?? []
  if (!events.length) return 0

  // 2. Fetch active watchlist themes + their tickers
  const themesResult = await (supabase
    .from('themes')
    .select('id, name, conviction')
    .eq('is_active', true)
    .eq('theme_type', 'watchlist') as unknown as Promise<{ data: { id: string; name: string; conviction: number | null }[] | null }>)

  const rawThemes = themesResult.data ?? []
  if (!rawThemes.length) return 0

  // Fetch tickers for each theme
  const themeIds    = rawThemes.map(t => t.id)
  const tickersResult = await (supabase
    .from('theme_tickers')
    .select('theme_id, ticker')
    .in('theme_id', themeIds) as unknown as Promise<{ data: { theme_id: string; ticker: string }[] | null }>)

  const tickersByTheme = new Map<string, string[]>()
  for (const row of tickersResult.data ?? []) {
    if (!tickersByTheme.has(row.theme_id)) tickersByTheme.set(row.theme_id, [])
    tickersByTheme.get(row.theme_id)!.push(row.ticker.toUpperCase())
  }

  const themes: WatchlistTheme[] = rawThemes.map(t => ({
    ...t,
    tickers: tickersByTheme.get(t.id) ?? [],
  })).filter(t => t.tickers.length > 0)

  // 3. Fetch all user IDs with portfolios (they receive theme alerts)
  const portfoliosResult = await (supabase
    .from('portfolios')
    .select('user_id') as unknown as Promise<{ data: { user_id: string }[] | null }>)

  const userIds = [...new Set((portfoliosResult.data ?? []).map(p => p.user_id))]
  if (!userIds.length) return 0

  // 4. Match events to watchlist themes
  let totalInserted = 0

  for (const theme of themes) {
    const themeTickerSet = new Set(theme.tickers)

    for (const event of events) {
      const eventTickers = (event.tickers ?? []).map(t => t.toUpperCase())
      const matchedTicker = eventTickers.find(t => themeTickerSet.has(t))
      if (!matchedTicker) continue

      // De-duplicate: one alert per (theme_id, event_id) across all users
      const existingResult = await (supabase
        .from('alerts')
        .select('id')
        .eq('theme_id', theme.id)
        .eq('event_id', event.id)
        .limit(1) as unknown as Promise<{ data: { id: string }[] | null }>)

      if ((existingResult.data ?? []).length > 0) continue

      const sentimentLabel = (event.sentiment_score ?? 0) > 0.2 ? '↑ Bullish'
        : (event.sentiment_score ?? 0) < -0.2 ? '↓ Bearish'
        : '→ Neutral'

      const body = `${event.ai_summary ?? event.headline} — ${matchedTicker} is a constituent of your "${theme.name}" watchlist theme. ${sentimentLabel} signal (impact ${event.impact_score}/10).`

      // Insert one alert per user
      for (const user_id of userIds) {
        await (supabase.from('alerts') as any).insert({
          user_id,
          theme_id:   theme.id,
          event_id:   event.id,
          type:       'theme_signal',
          title:      `${theme.name} signal: ${matchedTicker}`,
          body,
          is_read:    false,
          created_at: new Date().toISOString(),
        })
        totalInserted++
      }
    }
  }

  return totalInserted
}
