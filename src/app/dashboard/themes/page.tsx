import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = 'force-dynamic'
export const revalidate = 0

// ─── Types ────────────────────────────────────────────────────────────────────

type TickerWeight = {
  ticker:       string
  final_weight: number
  relevance:    number
  rationale:    string | null
}

type Theme = {
  id:                string
  name:              string
  label:             string | null
  timeframe:         string
  conviction:        number | null
  momentum:          string | null
  brief:             string | null
  anchor_reason:     string | null
  anchored_since:    string | null
  expires_at:        string | null
  ticker_weights:    TickerWeight[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function query<T>(q: any): Promise<T | null> {
  const result = await q
  return (result as any).data as T | null
}

function momentumLabel(m: string | null) {
  return ({
    strong_up:    '↑↑ Strong',
    moderate_up:  '↑ Moderate',
    neutral:      '→ Neutral',
    moderate_down:'↓ Moderate',
    strong_down:  '↓↓ Strong',
  } as Record<string, string>)[m ?? 'neutral'] ?? '→ Neutral'
}

function momentumColor(m: string | null) {
  return ({
    strong_up:    'var(--signal-bull)',
    moderate_up:  '#8de0bf',
    neutral:      'var(--signal-neut)',
    moderate_down:'#e8a070',
    strong_down:  'var(--signal-bear)',
  } as Record<string, string>)[m ?? 'neutral'] ?? 'var(--signal-neut)'
}

function tfLabel(tf: string) {
  return ({ '1m': '1 Month', '3m': '3 Months', '6m': '6 Months' } as Record<string,string>)[tf] ?? tf
}

function weightColor(w: number) {
  if (w >= 0.7) return 'var(--signal-bull)'
  if (w >= 0.4) return 'var(--signal-neut)'
  return 'rgba(232,226,217,0.4)'
}

function weightLabel(w: number) {
  if (w >= 0.8) return 'Primary'
  if (w >= 0.6) return 'Strong'
  if (w >= 0.4) return 'Moderate'
  if (w >= 0.2) return 'Peripheral'
  return 'Watch'
}

function relTime(iso: string | null) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const hrs = Math.floor(diff / 3_600_000)
  if (hrs < 1) return 'just now'
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function ThemesPage() {
  const supabase = createServiceClient()

  // Fetch active themes
  const themes = await query<Omit<Theme, 'ticker_weights'>[]>(
    supabase
      .from('themes')
      .select('id, name, label, timeframe, conviction, momentum, brief, anchor_reason, anchored_since, expires_at')
      .eq('is_active', true)
      .order('timeframe')
  ) ?? []

  // Fetch ticker weights for all active themes
  const themeIds = themes.map(t => t.id)
  const tickerRows = themeIds.length > 0
    ? await query<(TickerWeight & { theme_id: string })[]>(
        supabase
          .from('theme_tickers')
          .select('theme_id, ticker, final_weight, relevance, rationale')
          .in('theme_id', themeIds)
          .order('final_weight', { ascending: false })
      ) ?? []
    : []

  // Group by theme
  const weightsByTheme = new Map<string, TickerWeight[]>()
  for (const row of tickerRows) {
    const { theme_id, ...rest } = row
    if (!weightsByTheme.has(theme_id)) weightsByTheme.set(theme_id, [])
    weightsByTheme.get(theme_id)!.push(rest)
  }

  const fullThemes: Theme[] = themes.map(t => ({
    ...t,
    ticker_weights: weightsByTheme.get(t.id) ?? [],
  }))

  return (
    <div>
      <h1 style={{ color: 'var(--cream)', fontFamily: 'serif', fontSize: '1.8rem', marginBottom: '0.4rem' }}>
        Investment Themes
      </h1>
      <p style={{ color: 'rgba(232,226,217,0.4)', fontSize: '0.82rem', marginBottom: '2rem' }}>
        AI-generated macro investment themes with associated asset weights · updated daily
      </p>

      {!fullThemes.length && (
        <div style={{ color: 'rgba(232,226,217,0.25)', fontSize: '0.85rem', padding: '3rem 0', textAlign: 'center' }}>
          No active themes yet — run the themes cron to generate.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {fullThemes.map(theme => {
          const mColor = momentumColor(theme.momentum)
          return (
            <div key={theme.id} style={{
              background: 'var(--navy2)',
              border: '1px solid var(--dash-border)',
              borderRadius: 10,
              overflow: 'hidden',
            }}>
              {/* Theme header */}
              <div style={{ padding: '1.4rem 1.6rem', borderBottom: '1px solid var(--dash-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.8rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                    {/* Timeframe badge */}
                    <span style={{
                      fontSize: '0.62rem', fontWeight: 600,
                      background: 'rgba(200,169,110,0.12)', color: 'var(--gold)',
                      padding: '0.2rem 0.55rem', borderRadius: 4,
                      textTransform: 'uppercase', letterSpacing: '0.08em',
                    }}>
                      {tfLabel(theme.timeframe)}
                    </span>
                    {/* Label badge */}
                    {theme.label && (
                      <span style={{
                        fontSize: '0.62rem', fontWeight: 600,
                        background: `${mColor}18`, color: mColor,
                        padding: '0.2rem 0.55rem', borderRadius: 4,
                        textTransform: 'uppercase', letterSpacing: '0.06em',
                      }}>
                        {theme.label}
                      </span>
                    )}
                  </div>

                  {/* Momentum + conviction */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexShrink: 0 }}>
                    <span style={{ fontSize: '0.75rem', color: mColor, fontWeight: 500 }}>
                      {momentumLabel(theme.momentum)}
                    </span>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: mColor, lineHeight: 1 }}>
                        {theme.conviction ?? 0}
                      </div>
                      <div style={{ fontSize: '0.6rem', color: 'rgba(232,226,217,0.3)', marginTop: 2 }}>
                        CONVICTION
                      </div>
                    </div>
                  </div>
                </div>

                {/* Theme name */}
                <h2 style={{ color: 'var(--cream)', fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.6rem', lineHeight: 1.3 }}>
                  {theme.name}
                </h2>

                {/* Conviction bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.8rem' }}>
                  <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.07)', borderRadius: 2 }}>
                    <div style={{ width: `${theme.conviction ?? 0}%`, height: '100%', background: mColor, borderRadius: 2 }} />
                  </div>
                  <span style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.3)', minWidth: '3rem', textAlign: 'right' }}>
                    {theme.conviction ?? 0}/100
                  </span>
                </div>

                {/* Brief */}
                {theme.brief && (
                  <p style={{ fontSize: '0.82rem', color: 'rgba(232,226,217,0.55)', lineHeight: 1.6, marginBottom: '0.6rem' }}>
                    {theme.brief}
                  </p>
                )}

                {/* Anchor + expiry meta */}
                <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                  {theme.anchor_reason && (
                    <span style={{ fontSize: '0.68rem', color: 'rgba(200,169,110,0.5)', fontStyle: 'italic' }}>
                      ⚓ {theme.anchor_reason}
                    </span>
                  )}
                  {theme.anchored_since && (
                    <span style={{ fontSize: '0.68rem', color: 'rgba(232,226,217,0.2)' }}>
                      anchored {relTime(theme.anchored_since)}
                    </span>
                  )}
                  {theme.expires_at && (
                    <span style={{ fontSize: '0.68rem', color: 'rgba(232,226,217,0.2)' }}>
                      expires {relTime(theme.expires_at)}
                    </span>
                  )}
                </div>
              </div>

              {/* Ticker weights table */}
              <div style={{ padding: '1rem 1.6rem' }}>
                <div style={{ fontSize: '0.68rem', color: 'rgba(232,226,217,0.25)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.8rem' }}>
                  Associated Assets · {theme.ticker_weights.length} tickers
                </div>

                {theme.ticker_weights.length === 0 && (
                  <p style={{ fontSize: '0.78rem', color: 'rgba(232,226,217,0.2)', fontStyle: 'italic' }}>
                    No tickers mapped yet — will populate on next theme generation.
                  </p>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {theme.ticker_weights.map(tw => (
                    <div key={tw.ticker} style={{
                      display: 'grid',
                      gridTemplateColumns: '80px 1fr 120px 80px',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.6rem 0.8rem',
                      background: 'rgba(255,255,255,0.025)',
                      borderRadius: 6,
                      border: '1px solid rgba(255,255,255,0.04)',
                    }}>
                      {/* Ticker */}
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--cream)', fontFamily: 'monospace' }}>
                        {tw.ticker}
                      </span>

                      {/* Rationale */}
                      <span style={{ fontSize: '0.73rem', color: 'rgba(232,226,217,0.45)', lineHeight: 1.4 }}>
                        {tw.rationale ?? '—'}
                      </span>

                      {/* Weight bar */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.07)', borderRadius: 2 }}>
                          <div style={{
                            width: `${tw.final_weight * 100}%`,
                            height: '100%',
                            background: weightColor(tw.final_weight),
                            borderRadius: 2,
                          }} />
                        </div>
                        <span style={{ fontSize: '0.65rem', color: weightColor(tw.final_weight), minWidth: '2.5rem', textAlign: 'right', fontWeight: 600 }}>
                          {(tw.final_weight * 100).toFixed(0)}%
                        </span>
                      </div>

                      {/* Weight label */}
                      <span style={{
                        fontSize: '0.6rem',
                        background: `${weightColor(tw.final_weight)}18`,
                        color: weightColor(tw.final_weight),
                        padding: '0.15rem 0.4rem',
                        borderRadius: 3,
                        textAlign: 'center',
                        fontWeight: 500,
                      }}>
                        {weightLabel(tw.final_weight)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
