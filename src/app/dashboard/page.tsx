// src/app/dashboard/page.tsx
import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/server'
import MarketEnvironmentPanel from '@/components/dashboard/MarketEnvironmentPanel'

export const dynamic  = 'force-dynamic'
export const revalidate = 0

// ─── Types ────────────────────────────────────────────────────────────────────

type MacroScore = { aspect: string; score: number }

type Theme = {
  id:                string
  name:              string
  timeframe:         string
  conviction:        number | null
  momentum:          string | null
  candidate_tickers: string[] | null
  brief:             string | null
}

type TopSignal = {
  ticker:            string
  signal:            string
  score:             number | null
  fundamental_score: number | null
  technical_score:   number | null
  price_usd:         number | null
  change_pct:        number | null
  name:              string | null
  sector:            string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function signalColor(s: string) {
  return ({
    buy:   'var(--signal-bull)',
    watch: 'var(--signal-neut)',
    hold:  'rgba(232,226,217,0.35)',
    avoid: 'var(--signal-bear)',
  } as Record<string, string>)[s] ?? 'rgba(232,226,217,0.35)'
}

function tfLabel(tf: string) {
  return ({ '1m': '1M', '3m': '3M', '6m': '6M' } as Record<string, string>)[tf] ?? tf
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

function macroLabel(avg: number): { label: string; color: string; description: string } {
  if (avg >= 4)  return { label: 'Strongly Bullish',  color: '#4eca99', description: 'Macro conditions strongly favour risk assets' }
  if (avg >= 2)  return { label: 'Bullish',            color: '#8de0bf', description: 'Macro environment broadly supportive' }
  if (avg >= 0)  return { label: 'Neutral',            color: '#e09845', description: 'Mixed signals — selective positioning advised' }
  if (avg >= -2) return { label: 'Cautious',           color: '#e8a070', description: 'Macro headwinds present — favour quality and defence' }
  if (avg >= -4) return { label: 'Bearish',            color: '#e87070', description: 'Risk-off environment — reduce exposure, watch cash' }
  return          { label: 'Strongly Bearish',  color: '#c0392b', description: 'Significant macro stress — defensive positioning recommended' }
}

const ASPECT_LABELS: Record<string, { label: string; icon: string }> = {
  fed:         { label: 'Fed Policy',   icon: '🏦' },
  inflation:   { label: 'Inflation',    icon: '📈' },
  growth:      { label: 'Growth',       icon: '🌱' },
  labour:      { label: 'Labour',       icon: '👷' },
  geopolitical:{ label: 'Geopolitical', icon: '🌍' },
  credit:      { label: 'Credit',       icon: '💳' },
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const db = createServiceClient()

  const [macroResult, themesResult, signalsResult] = await Promise.all([
    db.from('macro_scores').select('aspect, score'),

    db.from('themes')
      .select('id, name, timeframe, conviction, momentum, candidate_tickers, brief')
      .eq('is_active', true)
      .order('conviction', { ascending: false })
      .limit(6),

    db.from('asset_signals')
      .select(`
        ticker, signal, score, fundamental_score, technical_score, price_usd, change_pct,
        assets!inner(name, sector)
      `)
      .in('signal', ['buy', 'watch'])
      .order('score', { ascending: false })
      .limit(6),
  ])

  const macroScores: MacroScore[] = (macroResult.data ?? []) as MacroScore[]
  const themes: Theme[]           = (themesResult.data ?? []) as Theme[]

  const topSignals: TopSignal[] = (signalsResult.data ?? []).map((r: any) => ({
    ticker:            r.ticker,
    signal:            r.signal,
    score:             r.score,
    fundamental_score: r.fundamental_score,
    technical_score:   r.technical_score,
    price_usd:         r.price_usd,
    change_pct:        r.change_pct,
    name:              r.assets?.name ?? null,
    sector:            r.assets?.sector ?? null,
  }))

  // Overall macro average
  const macroAvg = macroScores.length
    ? macroScores.reduce((a, m) => a + m.score, 0) / macroScores.length
    : 0
  const env = macroLabel(macroAvg)

  // Strongest and weakest macro aspects
  const sorted  = [...macroScores].sort((a, b) => b.score - a.score)
  const tailwind = sorted[0]
  const headwind = sorted[sorted.length - 1]

  return (
    <div>
      {/* Page title */}
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ color: 'var(--cream)', fontFamily: 'serif', fontSize: '1.8rem', margin: 0 }}>
          Market Overview
        </h1>
        <p style={{ color: 'rgba(232,226,217,0.3)', fontSize: '0.8rem', marginTop: '0.3rem' }}>
          {new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* ── Market Environment Banner ── */}
      <div style={{
        background: `linear-gradient(135deg, ${env.color}12 0%, rgba(15,20,40,0) 60%)`,
        border: `1px solid ${env.color}30`,
        borderRadius: 12, padding: '1.4rem 1.6rem', marginBottom: '1.5rem',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        flexWrap: 'wrap', gap: '1rem',
      }}>
        <div>
          <div style={{ fontSize: '0.6rem', color: 'rgba(232,226,217,0.3)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '0.4rem' }}>
            Current Market Environment
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: env.color, letterSpacing: '-0.01em', marginBottom: '0.3rem' }}>
            {env.label}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'rgba(232,226,217,0.5)', maxWidth: 400 }}>
            {env.description}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '1.5rem' }}>
          {tailwind && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.6rem', color: 'rgba(232,226,217,0.25)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.2rem' }}>Tailwind</div>
              <div style={{ fontSize: '0.85rem', color: '#4eca99', fontWeight: 600 }}>
                {ASPECT_LABELS[tailwind.aspect]?.icon} {ASPECT_LABELS[tailwind.aspect]?.label ?? tailwind.aspect}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'rgba(78,202,153,0.5)', fontFamily: 'monospace' }}>
                +{tailwind.score.toFixed(1)}
              </div>
            </div>
          )}
          {headwind && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.6rem', color: 'rgba(232,226,217,0.25)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.2rem' }}>Headwind</div>
              <div style={{ fontSize: '0.85rem', color: '#e87070', fontWeight: 600 }}>
                {ASPECT_LABELS[headwind.aspect]?.icon} {ASPECT_LABELS[headwind.aspect]?.label ?? headwind.aspect}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'rgba(232,112,112,0.5)', fontFamily: 'monospace' }}>
                {headwind.score.toFixed(1)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Live Market Indexes (client component) ── */}
      <MarketEnvironmentPanel macroScores={macroScores} />

      {/* ── Top Opportunities ── */}
      {topSignals.length > 0 && (
        <div style={{ marginBottom: '2rem' }}>
          <SectionHeader
            title="Top opportunities right now"
            subtitle="Tickers with strongest Buy or Watch signals"
            href="/dashboard/assets"
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
            {topSignals.map(s => (
              <Link key={s.ticker} href={`/dashboard/tickers/${s.ticker}`} style={{ textDecoration: 'none' }}>
                <div style={{
                  background: 'var(--navy2)', border: `1px solid ${signalColor(s.signal)}22`,
                  borderRadius: 8, padding: '1rem 1.1rem', cursor: 'pointer',
                  transition: 'border-color 0.15s',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                    <div>
                      <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--cream)', fontFamily: 'monospace' }}>{s.ticker}</div>
                      <div style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.3)', marginTop: '0.1rem' }}>{s.sector ?? '—'}</div>
                    </div>
                    <span style={{
                      fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase',
                      color: signalColor(s.signal), background: `${signalColor(s.signal)}18`,
                      padding: '0.15rem 0.45rem', borderRadius: 3,
                    }}>
                      {s.signal}
                    </span>
                  </div>
                  {/* Score bars */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginBottom: '0.5rem' }}>
                    {[
                      { label: 'F', score: s.fundamental_score, color: '#7ab4e8' },
                      { label: 'T', score: s.technical_score,   color: '#4eca99' },
                    ].map(({ label, score, color }) => score != null && (
                      <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span style={{ fontSize: '0.58rem', color: 'rgba(232,226,217,0.25)', width: 8 }}>{label}</span>
                        <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
                          <div style={{ width: `${score}%`, height: '100%', background: color, borderRadius: 2, opacity: 0.7 }} />
                        </div>
                        <span style={{ fontSize: '0.58rem', color, fontFamily: 'monospace', minWidth: 20 }}>{score}</span>
                      </div>
                    ))}
                  </div>
                  {/* Price */}
                  {s.price_usd != null && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.8rem', fontFamily: 'monospace', color: 'var(--cream)' }}>
                        ${s.price_usd.toFixed(2)}
                      </span>
                      {s.change_pct != null && (
                        <span style={{ fontSize: '0.68rem', color: s.change_pct >= 0 ? 'var(--signal-bull)' : 'var(--signal-bear)' }}>
                          {s.change_pct >= 0 ? '+' : ''}{s.change_pct.toFixed(2)}%
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── Active Themes ── */}
      {themes.length > 0 && (
        <div style={{ marginBottom: '2rem' }}>
          <SectionHeader
            title="Active investment themes"
            subtitle="AI-identified macro-driven opportunities"
            href="/dashboard/themes"
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
            {themes.slice(0, 6).map(t => (
              <Link key={t.id} href="/dashboard/themes" style={{ textDecoration: 'none' }}>
                <div style={{
                  background: 'var(--navy2)', border: '1px solid var(--dash-border)',
                  borderRadius: 8, padding: '1rem 1.1rem', cursor: 'pointer',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                    <span style={{ fontSize: '0.6rem', color: 'var(--gold)', background: 'rgba(200,169,110,0.1)', padding: '0.1rem 0.35rem', borderRadius: 3 }}>
                      {tfLabel(t.timeframe)}
                    </span>
                    <span style={{ fontSize: '0.62rem', color: momentumColor(t.momentum), fontWeight: 500 }}>
                      {momentumLabel(t.momentum)}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--cream)', lineHeight: 1.35, marginBottom: '0.4rem' }}>
                    {t.name}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem' }}>
                    <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
                      <div style={{ width: `${t.conviction ?? 0}%`, height: '100%', background: momentumColor(t.momentum), borderRadius: 2 }} />
                    </div>
                    <span style={{ fontSize: '0.62rem', color: momentumColor(t.momentum), fontFamily: 'monospace' }}>
                      {t.conviction ?? 0}
                    </span>
                  </div>
                  {t.brief && (
                    <div style={{ fontSize: '0.68rem', color: 'rgba(232,226,217,0.35)', lineHeight: 1.5 }}>
                      {t.brief.slice(0, 100)}{t.brief.length > 100 ? '…' : ''}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                    {(t.candidate_tickers ?? []).slice(0, 4).map(tk => (
                      <span key={tk} style={{
                        fontSize: '0.58rem', color: 'rgba(78,202,153,0.6)',
                        background: 'rgba(78,202,153,0.06)', padding: '0.1rem 0.3rem', borderRadius: 3,
                      }}>
                        {tk}
                      </span>
                    ))}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ title, subtitle, href }: { title: string; subtitle?: string; href: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '0.85rem' }}>
      <div>
        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--cream)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {title}
        </div>
        {subtitle && (
          <div style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.3)', marginTop: '0.2rem' }}>{subtitle}</div>
        )}
      </div>
      <Link href={href} style={{ fontSize: '0.7rem', color: 'var(--gold)', opacity: 0.6, textDecoration: 'none' }}>
        View all →
      </Link>
    </div>
  )
}
