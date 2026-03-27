'use client'
/**
 * components/dashboard/MacroHeatPanel.tsx
 *
 * Displays macro sentiment heat meters for 6 aspects.
 * Each meter shows a -10 to +10 score with colour, direction arrow,
 * and expandable Claude commentary.
 *
 * Usage:
 *   import MacroHeatPanel from '@/components/dashboard/MacroHeatPanel'
 *   <MacroHeatPanel />
 */

import { useEffect, useState } from 'react'
import styles from './MacroHeatPanel.module.css'

// ─── Types ────────────────────────────────────────────────────────────────────

interface MacroScore {
  aspect:      string
  score:       number
  direction:   'improving' | 'deteriorating' | 'stable'
  commentary:  string
  event_count: number
  scored_at:   string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ASPECT_META: Record<string, { label: string; icon: string; subtitle: string }> = {
  fed:          { label: 'Fed Policy',      icon: '🏦', subtitle: 'Rate decisions · FOMC' },
  inflation:    { label: 'Inflation',       icon: '📈', subtitle: 'CPI · PCE · PPI' },
  labour:       { label: 'Labour Market',   icon: '👷', subtitle: 'NFP · Unemployment' },
  growth:       { label: 'Growth',          icon: '📊', subtitle: 'GDP · PMI · Retail' },
  geopolitical: { label: 'Geopolitical',    icon: '🌐', subtitle: 'Wars · Sanctions · Trade' },
  credit:       { label: 'Credit',          icon: '💳', subtitle: 'Spreads · VIX · Yields' },
}

const DIRECTION_ICON: Record<string, string> = {
  improving:    '↑',
  deteriorating:'↓',
  stable:       '→',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 5)  return '#4eca99'   // strong bull
  if (score >= 2)  return '#8de0bf'   // mild bull
  if (score >= -2) return '#e09845'   // neutral
  if (score >= -5) return '#e8a070'   // mild bear
  return '#e87070'                    // strong bear
}

function scoreLabel(score: number): string {
  if (score >= 6)  return 'Very Bullish'
  if (score >= 3)  return 'Bullish'
  if (score >= 1)  return 'Mildly Bullish'
  if (score >= -1) return 'Neutral'
  if (score >= -3) return 'Mildly Bearish'
  if (score >= -6) return 'Bearish'
  return 'Very Bearish'
}

/** Convert -10/+10 score to 0-100% for the gauge fill */
function scoreToPct(score: number): number {
  return ((score + 10) / 20) * 100
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const hrs  = Math.floor(diff / 3_600_000)
  if (hrs < 1)  return 'just now'
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function GaugeMeter({ score }: { score: number }) {
  const pct   = scoreToPct(score)
  const color = scoreColor(score)

  return (
    <div className={styles.gaugeWrap}>
      <div className={styles.gaugeLabels}>
        <span>-10</span>
        <span>0</span>
        <span>+10</span>
      </div>
      <div className={styles.gaugeTrack}>
        <div className={styles.gaugeMid} />
        <div
          className={styles.gaugePointer}
          style={{ left: `${pct}%`, background: color, color }}
        />
      </div>
    </div>
  )
}

function MeterCard({ score, defaultOpen = false }: { score: MacroScore; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const meta  = ASPECT_META[score.aspect]
  const color = scoreColor(score.score)
  const label = scoreLabel(score.score)
  const dirIcon = DIRECTION_ICON[score.direction]

  return (
    <div className={styles.card} onClick={() => setOpen(o => !o)}>
      <div className={styles.cardHeader}>
        <div className={styles.cardLeft}>
          <span className={styles.cardIcon}>{meta?.icon}</span>
          <div>
            <div className={styles.cardLabel}>{meta?.label ?? score.aspect}</div>
            <div className={styles.cardSub}>{meta?.subtitle}</div>
          </div>
        </div>
        <div className={styles.cardRight}>
          <span className={styles.directionIcon} style={{ color }}>{dirIcon}</span>
          <span className={styles.scoreVal} style={{ color }}>
            {score.score >= 0 ? '+' : ''}{score.score.toFixed(1)}
          </span>
          <span className={styles.scoreLabel} style={{ color }}>{label}</span>
          <span className={styles.chevron}>{open ? '▲' : '▼'}</span>
        </div>
      </div>

      <GaugeMeter score={score.score} />

      {open && (
        <div className={styles.detail}>
          <p className={styles.commentary}>{score.commentary}</p>
          <div className={styles.detailMeta}>
            <span>{score.event_count} events analysed</span>
            <span>Updated {relTime(score.scored_at)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MacroHeatPanel() {
  const [scores,  setScores]  = useState<MacroScore[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/macro')
      .then(r => r.json())
      .then(d => {
        setScores(d.scores ?? [])
        setLoading(false)
      })
      .catch(err => {
        setError('Failed to load macro scores')
        setLoading(false)
      })
  }, [])

  if (loading) return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h3 className={styles.title}>Macro Heat Map</h3>
      </div>
      <div className={styles.loading}>Loading macro scores…</div>
    </div>
  )

  if (error) return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h3 className={styles.title}>Macro Heat Map</h3>
      </div>
      <div className={styles.empty}>{error}</div>
    </div>
  )

  if (!scores.length) return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h3 className={styles.title}>Macro Heat Map</h3>
      </div>
      <div className={styles.empty}>
        No macro scores yet — run the macro cron to generate scores.
      </div>
    </div>
  )

  // Overall market score = average of all aspects
  const overallScore = scores.reduce((s, m) => s + m.score, 0) / scores.length
  const overallColor = scoreColor(overallScore)

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <div>
          <h3 className={styles.title}>Macro Heat Map</h3>
          <p className={styles.sub}>AI-scored sentiment across 6 macro dimensions · click to expand</p>
        </div>
        <div className={styles.overall}>
          <div className={styles.overallLabel}>Overall</div>
          <div className={styles.overallScore} style={{ color: overallColor }}>
            {overallScore >= 0 ? '+' : ''}{overallScore.toFixed(1)}
          </div>
        </div>
      </div>

      <div className={styles.grid}>
        {scores.map(s => (
          <MeterCard key={s.aspect} score={s} />
        ))}
      </div>
    </div>
  )
}
