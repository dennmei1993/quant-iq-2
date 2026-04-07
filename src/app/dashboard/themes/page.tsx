// src/app/dashboard/themes/page.tsx — Terminal font fixes applied
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
  strong_up:   '↑↑ Strong',  moderate_up:   '↑ Moderate',
  neutral:     '→ Neutral',
  moderate_down: '↓ Moderate', strong_down: '↓↓ Strong',
}
const MOMENTUM_COLOR: Record<string, string> = {
  strong_up:    'var(--signal-bull)', moderate_up: '#7affb0',
  neutral:      'var(--signal-neut)',
  moderate_down:'#ff8a9a',           strong_down: 'var(--signal-bear)',
}
const TF_LABEL: Record<string, string> = { '1m': '1 Month', '3m': '3 Months', '6m': '6 Months' }

function relTime(iso: string | null) {
  if (!iso) return ''
  const hrs = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000)
  if (hrs < 1) return 'just now'
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ── Shared font constants (avoids repetition in inline styles) ──
const F_DISPLAY = "'Syne', var(--font-sans)"
const F_SANS    = "var(--font-sans)"
const F_MONO    = "'DM Mono', monospace"

function SectionHeader({ title, subtitle, count }: { title: string; subtitle: string; count: number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1rem' }}>
      <div>
        <h2 style={{ fontFamily: F_DISPLAY, color: 'var(--text-primary)', fontSize: '1rem', fontWeight: 500, margin: 0, letterSpacing: '-0.01em' }}>{title}</h2>
        <p style={{ fontFamily: F_SANS, color: 'var(--text-faint)', fontSize: '0.72rem', margin: '0.2rem 0 0', fontWeight: 300 }}>{subtitle}</p>
      </div>
      <span style={{ fontFamily: F_MONO, fontSize: '0.62rem', color: 'var(--text-faint)', background: 'rgba(255,255,255,0.03)', padding: '0.18rem 0.5rem', border: '1px solid var(--border-default)' }}>
        {count} theme{count !== 1 ? 's' : ''}
      </span>
    </div>
  )
}

function ThemeCard({ theme, variant }: { theme: Theme; variant: 'watchlist' | 'dynamic' }) {
  const mColor      = MOMENTUM_COLOR[theme.momentum ?? 'neutral'] ?? 'var(--signal-neut)'
  const accentColor = variant === 'watchlist' ? 'var(--blue)' : mColor

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: `1px solid ${variant === 'watchlist' ? 'rgba(90,154,245,0.2)' : 'var(--border-default)'}`,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '1.1rem 1.2rem', borderBottom: '1px solid var(--border-default)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.65rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{
              fontFamily: F_MONO,
              fontSize: '0.58rem', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.12em',
              background: variant === 'watchlist' ? 'rgba(90,154,245,0.08)' : 'rgba(78,255,145,0.08)',
              color: variant === 'watchlist' ? 'var(--blue)' : 'var(--green)',
              padding: '0.15rem 0.45rem',
              border: `1px solid ${variant === 'watchlist' ? 'rgba(90,154,245,0.2)' : 'rgba(78,255,145,0.2)'}`,
            }}>
              {variant === 'watchlist' ? '📌 Watchlist' : TF_LABEL[theme.timeframe] ?? theme.timeframe}
            </span>
            {theme.label && theme.label !== 'WATCHLIST' && (
              <span style={{
                fontFamily: F_MONO,
                fontSize: '0.58rem', fontWeight: 400, textTransform: 'uppercase', letterSpacing: '0.1em',
                background: `${mColor}12`, color: mColor, padding: '0.15rem 0.45rem',
                border: `1px solid ${mColor}30`,
              }}>
                {theme.label}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
            {variant === 'dynamic' && (
              <span style={{ fontFamily: F_MONO, fontSize: '0.68rem', color: mColor, fontWeight: 400, letterSpacing: '0.04em' }}>
                {MOMENTUM_LABEL[theme.momentum ?? 'neutral'] ?? '→ Neutral'}
              </span>
            )}
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: F_MONO, fontSize: '1rem', fontWeight: 400, color: accentColor, lineHeight: 1, letterSpacing: '-0.01em' }}>
                {theme.conviction ?? 0}
              </div>
              <div style={{ fontFamily: F_MONO, fontSize: '0.55rem', color: 'var(--text-faint)', marginTop: 2, letterSpacing: '0.1em' }}>CONVICTION</div>
            </div>
          </div>
        </div>

        <h3 style={{ fontFamily: F_DISPLAY, color: 'var(--text-primary)', fontSize: '0.95rem', fontWeight: 500, margin: '0 0 0.5rem', lineHeight: 1.3, letterSpacing: '-0.01em' }}>
          {theme.name}
        </h3>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem' }}>
          <div style={{ flex: 1, height: 2, background: 'var(--border-default)' }}>
            <div style={{ width: `${theme.conviction ?? 0}%`, height: '100%', background: accentColor }} />
          </div>
          <span style={{ fontFamily: F_MONO, fontSize: '0.6rem', color: 'var(--text-faint)' }}>{theme.conviction ?? 0}/100</span>
        </div>

        {theme.brief && (
          <p style={{ fontFamily: F_SANS, fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.72, margin: 0, fontWeight: 300 }}>
            {theme.brief}
          </p>
        )}

        {variant === 'dynamic' && (theme.anchor_reason || theme.anchored_since) && (
          <div style={{ display: 'flex', gap: '1.2rem', marginTop: '0.55rem', flexWrap: 'wrap' }}>
            {theme.anchor_reason && (
              <span style={{ fontFamily: F_MONO, fontSize: '0.62rem', color: 'var(--text-faint)', fontStyle: 'italic' }}>⚓ {theme.anchor_reason}</span>
            )}
            {theme.anchored_since && (
              <span style={{ fontFamily: F_MONO, fontSize: '0.62rem', color: 'var(--text-faint)' }}>anchored {relTime(theme.anchored_since)}</span>
            )}
          </div>
        )}
      </div>

      {/* Ticker manager */}
      <div style={{ padding: '0.8rem 1.2rem' }}>
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

  const themes           = allThemes.map(t => ({ ...t, ticker_weights: weightsByTheme.get(t.id) ?? [] }))
  const watchlistThemes  = themes.filter(t => t.theme_type === 'watchlist')
  const dynamicThemes    = themes.filter(t => t.theme_type === 'dynamic')

  return (
    <div>
      <div style={{ marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border-default)' }}>
        <h1 style={{ fontFamily: "'Syne', var(--font-sans)", color: 'var(--text-primary)', fontSize: '1.4rem', fontWeight: 500, marginBottom: '0.25rem', letterSpacing: '-0.01em' }}>
          Themes
        </h1>
        <p style={{ fontFamily: 'var(--font-sans)', color: 'var(--text-faint)', fontSize: '0.76rem', fontWeight: 300 }}>
          Persistent watchlist themes and AI-generated market themes with associated asset weights
        </p>
      </div>

      <div style={{ marginBottom: '3rem' }}>
        <SectionHeader
          title="Watchlist Themes"
          subtitle="Persistent structural themes — always tracked regardless of daily news"
          count={watchlistThemes.length}
        />
        {watchlistThemes.length === 0 ? (
          <div style={{ fontFamily: 'var(--font-sans)', color: 'var(--text-faint)', fontSize: '0.78rem', padding: '2rem 0', fontWeight: 300 }}>
            No watchlist themes yet.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(520px, 1fr))', gap: '1px', background: 'var(--border-default)' }}>
            {watchlistThemes.map(t => <ThemeCard key={t.id} theme={t} variant="watchlist" />)}
          </div>
        )}
      </div>

      <div>
        <SectionHeader
          title="Market Themes"
          subtitle="AI-generated from recent high-impact events · updated daily"
          count={dynamicThemes.length}
        />
        {dynamicThemes.length === 0 ? (
          <div style={{ fontFamily: 'var(--font-sans)', color: 'var(--text-faint)', fontSize: '0.78rem', padding: '2rem 0', fontWeight: 300 }}>
            No market themes yet — run the themes cron to generate.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', background: 'var(--border-default)' }}>
            {dynamicThemes.map(t => <ThemeCard key={t.id} theme={t} variant="dynamic" />)}
          </div>
        )}
      </div>
    </div>
  )
}
