/**
 * app/dashboard/themes/page.tsx
 *
 * Investment themes page. Shows active 1m / 3m / 6m themes with:
 *  - Conviction bar per theme
 *  - Expandable ticker list with AI-assigned weight bars + rationale
 */

'use client'

import { useEffect, useState, useCallback } from 'react'
import styles from './themes.module.css'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TickerWeight {
  ticker:    string
  weight:    number
  rationale: string | null
}

interface Theme {
  id:                 string
  name:               string
  timeframe:          '1m' | '3m' | '6m'
  conviction:         number
  momentum:           string
  brief:              string
  candidate_tickers:  string[]
  tickers:            TickerWeight[]
  expires_at:         string | null
  // Anchor fields
  is_anchored:        boolean
  anchor_score:       number
  anchored_since:     string | null
  anchor_reason:      string | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TF_LABELS: Record<string, string> = {
  '1m': '1 month',
  '3m': '3 months',
  '6m': '6 months',
}

const MOMENTUM: Record<string, { label: string; cls: string }> = {
  strong_up:     { label: '↑↑ Strong',    cls: styles.momSU },
  moderate_up:   { label: '↑ Moderate',   cls: styles.momMU },
  neutral:       { label: '→ Neutral',    cls: styles.momN  },
  moderate_down: { label: '↓ Moderate',   cls: styles.momMD },
  strong_down:   { label: '↓↓ Strong',    cls: styles.momSD },
}

// Weight label shown next to the bar
function weightLabel(w: number): string {
  if (w >= 0.85) return 'Primary'
  if (w >= 0.6)  return 'Strong'
  if (w >= 0.35) return 'Thematic'
  return 'Peripheral'
}

// ─── WeightBar ────────────────────────────────────────────────────────────────

function WeightBar({ weight }: { weight: number }) {
  // Colour: gold → green as weight rises
  const hue = Math.round(weight * 60)          // 0 = amber, 60 = green
  const fill = `hsl(${hue + 30}, 60%, 40%)`

  return (
    <div className={styles.wbWrap}>
      <div className={styles.wbBg}>
        <div className={styles.wbFill} style={{ width: `${weight * 100}%`, background: fill }} />
      </div>
      <span className={styles.wbPct}>{(weight * 100).toFixed(0)}</span>
      <span className={styles.wbLabel}>{weightLabel(weight)}</span>
    </div>
  )
}

// ─── Anchor badge ─────────────────────────────────────────────────────────────

function AnchorBadge({ theme }: { theme: Theme }) {
  if (!theme.is_anchored && !theme.anchored_since) return null

  const since = theme.anchored_since
    ? new Date(theme.anchored_since).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null

  return (
    <div className={styles.anchorBadge} title={theme.anchor_reason ?? ''}>
      <span className={styles.anchorIcon}>⚓</span>
      <span className={styles.anchorText}>
        Anchored{since ? ` since ${since}` : ''}
      </span>
      {theme.anchor_reason && (
        <span className={styles.anchorReason}>{theme.anchor_reason}</span>
      )}
    </div>
  )
}

// ─── ThemeCard ────────────────────────────────────────────────────────────────

function ThemeCard({ theme }: { theme: Theme }) {
  const [open, setOpen] = useState(false)
  const mom = MOMENTUM[theme.momentum] ?? { label: theme.momentum, cls: styles.momN }

  return (
    <div className={styles.card}>

      {/* Header — always visible, click to expand */}
      <div className={styles.cardHeader} onClick={() => setOpen(o => !o)}>
        <div className={styles.cardLeft}>
          <h3 className={styles.cardName}>{theme.name}</h3>
          <span className={`${styles.momBadge} ${mom.cls}`}>{mom.label}</span>
          {theme.is_anchored && <AnchorBadge theme={theme} />}
        </div>
        <div className={styles.cardRight}>
          <div className={styles.convRow}>
            <span className={styles.convLabel}>Conviction</span>
            <div className={styles.convBg}>
              <div className={styles.convFill} style={{ width: `${theme.conviction}%` }} />
            </div>
            <span className={styles.convNum}>{theme.conviction}</span>
          </div>
          <span className={styles.chevron}>{open ? '↑' : '↓'}</span>
        </div>
      </div>

      {/* Brief — always visible */}
      <p className={styles.brief}>{theme.brief}</p>

      {/* Tickers — expanded only */}
      {open && (
        <div className={styles.tickerList}>
          <div className={styles.tickerListHeader}>
            Tickers — AI relevance weight
          </div>

          {theme.tickers.length === 0 ? (
            <p className={styles.noTickers}>
              No weights yet — run the themes cron to populate.
            </p>
          ) : (
            theme.tickers.map(tw => (
              <div key={tw.ticker} className={styles.tickerRow}>
                <span className={styles.tkSymbol}>{tw.ticker}</span>
                <WeightBar weight={tw.weight} />
                {tw.rationale && (
                  <p className={styles.rationale}>{tw.rationale}</p>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {theme.expires_at && (
        <p className={styles.expiry}>
          Refreshes {new Date(theme.expires_at).toLocaleDateString()}
        </p>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ThemesPage() {
  const [themes,  setThemes]  = useState<Theme[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [tf,      setTf]      = useState<'all' | '1m' | '3m' | '6m'>('all')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const p = new URLSearchParams({ weights: 'true' })
      if (tf !== 'all') p.set('timeframe', tf)
      const res = await fetch(`/api/themes?${p}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setThemes((await res.json()).themes ?? [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [tf])

  useEffect(() => { load() }, [load])

  const grouped = (['1m', '3m', '6m'] as const).reduce((acc, t) => {
    acc[t] = themes.filter(x => x.timeframe === t)
    return acc
  }, {} as Record<string, Theme[]>)

  return (
    <div className={styles.page}>

      <div className={styles.header}>
        <h1 className={styles.title}>Investment Themes</h1>
        <p className={styles.sub}>
          AI-generated macro themes. Tap a theme to see its constituent tickers
          and relevance weights.
        </p>
      </div>

      <div className={styles.filterBar}>
        {(['all', '1m', '3m', '6m'] as const).map(t => (
          <button
            key={t}
            className={`${styles.fb} ${tf === t ? styles.fbActive : ''}`}
            onClick={() => setTf(t)}
          >
            {t === 'all' ? 'All horizons' : TF_LABELS[t]}
          </button>
        ))}
      </div>

      {loading && <div className={styles.state}>Loading…</div>}
      {error   && <div className={styles.err}>{error}</div>}

      {!loading && !error && (
        <>
          {(['1m', '3m', '6m'] as const).map(t => {
            if (tf !== 'all' && tf !== t) return null
            const group = grouped[t]
            if (!group?.length) return null
            return (
              <section key={t} className={styles.section}>
                <h2 className={styles.sectionLabel}>{TF_LABELS[t]} horizon</h2>
                {group.map(theme => <ThemeCard key={theme.id} theme={theme} />)}
              </section>
            )
          })}

          {themes.length === 0 && (
            <div className={styles.state}>
              No active themes. Run the themes cron to generate them.
            </div>
          )}
        </>
      )}
    </div>
  )
}
