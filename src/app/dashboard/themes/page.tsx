// src/app/dashboard/themes/page.tsx
import { createServiceClient } from "@/lib/supabase/server";
import ThemeTickerManager from '@/components/dashboard/ThemeTickerManager'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type TickerWeight = {
  ticker:       string
  final_weight: number
  relevance:    number
  rationale:    string | null
  asset_type:   string | null
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
  theme_type:        string
  ticker_weights:    TickerWeight[]
}

async function query<T>(q: any): Promise<T | null> {
  const result = await q
  return (result as any).data as T | null
}

const MOMENTUM_LABEL: Record<string, string> = {
  strong_up: 'â†‘â†‘ Strong', moderate_up: 'â†‘ Moderate',
  neutral: 'â†’ Neutral', moderate_down: 'â†“ Moderate', strong_down: 'â†“â†“ Strong',
}
const MOMENTUM_COLOR: Record<string, string> = {
  strong_up: 'var(--signal-bull)', moderate_up: '#8de0bf',
  neutral: 'var(--signal-neut)', moderate_down: '#e8a070', strong_down: 'var(--signal-bear)',
}
const TF_LABEL: Record<string, string> = { '1m': '1 Month', '3m': '3 Months', '6m': '6 Months' }

function relTime(iso: string | null) {
  if (!iso) return ''
  const hrs = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000)
  if (hrs < 1) return 'just now'
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function SectionHeader({ title, subtitle, count }: { title: string; subtitle: string; count: number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1rem' }}>
      <div>
        <h2 style={{ color: 'var(--cream)', fontSize: '1rem', fontWeight: 600, margin: 0 }}>{title}</h2>
        <p style={{ color: 'rgba(232,226,217,0.35)', fontSize: '0.75rem', margin: '0.2rem 0 0' }}>{subtitle}</p>
      </div>
      <span style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.3)', background: 'rgba(255,255,255,0.04)', padding: '0.2rem 0.5rem', borderRadius: 4 }}>
        {count} theme{count !== 1 ? 's' : ''}
      </span>
    </div>
  )
}

function ThemeCard({ theme, variant }: { theme: Theme; variant: 'watchlist' | 'dynamic' }) {
  const mColor      = MOMENTUM_COLOR[theme.momentum ?? 'neutral'] ?? 'var(--signal-neut)'
  const accentColor = variant === 'watchlist' ? '#7ab4e8' : mColor

  return (
    <div style={{
      background: 'var(--navy2)',
      border: `1px solid ${variant === 'watchlist' ? 'rgba(122,180,232,0.15)' : 'var(--dash-border)'}`,
      borderRadius: 10, overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '1.3rem 1.5rem', borderBottom: '1px solid var(--dash-border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.7rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{
              fontSize: '0.6rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em',
              background: variant === 'watchlist' ? 'rgba(122,180,232,0.12)' : 'rgba(200,169,110,0.12)',
              color: variant === 'watchlist' ? '#7ab4e8' : 'var(--gold)',
              padding: '0.18rem 0.5rem', borderRadius: 4,
            }}>
              {variant === 'watchlist' ? 'ðŸ“Œ Watchlist' : TF_LABEL[theme.timeframe] ?? theme.timeframe}
            </span>
            {theme.label && theme.label !== 'WATCHLIST' && (
              <span style={{
                fontSize: '0.6rem', fontWeight: 600, textTransform: 'uppercase',
                background: `${mColor}18`, color: mColor, padding: '0.18rem 0.5rem', borderRadius: 4,
              }}>
                {theme.label}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
            {variant === 'dynamic' && (
              <span style={{ fontSize: '0.72rem', color: mColor, fontWeight: 500 }}>
                {MOMENTUM_LABEL[theme.momentum ?? 'neutral'] ?? 'â†’ Neutral'}
              </span>
            )}
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '1.05rem', fontWeight: 700, color: accentColor, lineHeight: 1 }}>{theme.conviction ?? 0}</div>
              <div style={{ fontSize: '0.58rem', color: 'rgba(232,226,217,0.25)', marginTop: 2 }}>CONVICTION</div>
            </div>
          </div>
        </div>

        <h3 style={{ color: 'var(--cream)', fontSize: '1.05rem', fontWeight: 700, margin: '0 0 0.55rem', lineHeight: 1.3 }}>
          {theme.name}
        </h3>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.7rem' }}>
          <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
            <div style={{ width: `${theme.conviction ?? 0}%`, height: '100%', background: accentColor, borderRadius: 2 }} />
          </div>
          <span style={{ fontSize: '0.62rem', color: 'rgba(232,226,217,0.25)' }}>{theme.conviction ?? 0}/100</span>
        </div>

        {theme.brief && (
          <p style={{ fontSize: '0.8rem', color: 'rgba(232,226,217,0.5)', lineHeight: 1.6, margin: 0 }}>{theme.brief}</p>
        )}

        {variant === 'dynamic' && (theme.anchor_reason || theme.anchored_since) && (
          <div style={{ display: 'flex', gap: '1.2rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
            {theme.anchor_reason && (
              <span style={{ fontSize: '0.67rem', color: 'rgba(200,169,110,0.45)', fontStyle: 'italic' }}>âš“ {theme.anchor_reason}</span>
            )}
            {theme.anchored_since && (
              <span style={{ fontSize: '0.67rem', color: 'rgba(232,226,217,0.18)' }}>anchored {relTime(theme.anchored_since)}</span>
            )}
          </div>
        )}
      </div>

      {/* Interactive ticker manager */}
      <div style={{ padding: '0.9rem 1.5rem' }}>
        <ThemeTickerManager
          themeId={theme.id}
          initialTickers={theme.ticker_weights}
        />
      </div>
    </div>
  )
}

export default async function ThemesPage() {
  const supabase = createServiceClient()

  const allThemes = await query<Omit<Theme, 'ticker_weights'>[]>(
    supabase.from('themes')
      .select('id, name, label, timeframe, conviction, momentum, brief, anchor_reason, anchored_since, expires_at, theme_type')
      .eq('is_active', true)
      .order('theme_type').order('timeframe')
  ) ?? []

  const themeIds   = allThemes.map(t => t.id)
  const tickerRows = themeIds.length > 0
    ? await query<(TickerWeight & { theme_id: string })[]>(
        supabase.from('theme_tickers')
          .select('theme_id, ticker, final_weight, relevance, rationale, assets!inner(asset_type)')
          .in('theme_id', themeIds)
          .order('final_weight', { ascending: false })
      ) ?? []
    : []

  const weightsByTheme = new Map<string, TickerWeight[]>()
  for (const row of tickerRows) {
    const { theme_id, assets, ...rest } = row as any
    const entry = { ...rest, asset_type: (assets as any)?.asset_type ?? null }
    if (!weightsByTheme.has(theme_id)) weightsByTheme.set(theme_id, [])
    weightsByTheme.get(theme_id)!.push(entry)
  }

  const themes: Theme[]         = allThemes.map(t => ({ ...t, ticker_weights: weightsByTheme.get(t.id) ?? [] }))
  const watchlistThemes         = themes.filter(t => t.theme_type === 'watchlist')
  const dynamicThemes           = themes.filter(t => t.theme_type === 'dynamic')

  return (
    <div>
      <h1 style={{ color: 'var(--cream)', fontFamily: 'serif', fontSize: '1.8rem', marginBottom: '0.4rem' }}>Themes</h1>
      <p style={{ color: 'rgba(232,226,217,0.35)', fontSize: '0.82rem', marginBottom: '2.5rem' }}>
        Persistent watchlist themes and AI-generated market themes with associated asset weights
      </p>

      <div style={{ marginBottom: '3rem' }}>
        <SectionHeader
          title="Watchlist Themes"
          subtitle="Persistent structural themes â€” always tracked regardless of daily news"
          count={watchlistThemes.length}
        />
        {watchlistThemes.length === 0 ? (
          <div style={{ color: 'rgba(232,226,217,0.2)', fontSize: '0.82rem', padding: '2rem 0' }}>No watchlist themes yet.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(520px, 1fr))', gap: '1.2rem' }}>
            {watchlistThemes.map(t => <ThemeCard key={t.id} theme={t} variant="watchlist" />)}
          </div>
        )}
      </div>

      <div>
        <SectionHeader
          title="Market Themes"
          subtitle="AI-generated from recent high-impact events Â· updated daily"
          count={dynamicThemes.length}
        />
        {dynamicThemes.length === 0 ? (
          <div style={{ color: 'rgba(232,226,217,0.2)', fontSize: '0.82rem', padding: '2rem 0' }}>No market themes yet â€” run the themes cron to generate.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
            {dynamicThemes.map(t => <ThemeCard key={t.id} theme={t} variant="dynamic" />)}
          </div>
        )}
      </div>
    </div>
  )
}

