'use client'
// src/components/dashboard/MacroHeatPanel.tsx

import { useEffect, useState } from 'react'
import styles from './MacroHeatPanel.module.css'

interface MacroScore {
  aspect:      string
  score:       number
  direction:   'improving' | 'deteriorating' | 'stable'
  commentary:  string
  event_count: number
  scored_at:   string
}

const ASPECT_META: Record<string, {
  label: string; icon: string; subtitle: string
  sectors: string[]; themes: string[]
  bullNote: string; bearNote: string
}> = {
  fed: {
    label: 'Fed Policy', icon: '🏦', subtitle: 'Rate decisions · FOMC',
    sectors: ['Financials', 'Real Estate', 'Utilities', 'Technology'],
    themes:  ['Rate-Sensitive Growth', 'Regional Banking', 'Mortgage REITs'],
    bullNote: 'Rate cuts → growth stocks, REITs, small caps benefit',
    bearNote: 'Rate hikes → financials, USD, short-duration assets benefit',
  },
  inflation: {
    label: 'Inflation', icon: '📈', subtitle: 'CPI · PCE · PPI',
    sectors: ['Energy', 'Materials', 'Consumer Staples', 'Industrials'],
    themes:  ['Commodity Supercycle', 'Inflation Hedges', 'Clean Energy Transition'],
    bullNote: 'Falling inflation → consumer discretionary, tech multiples expand',
    bearNote: 'Rising inflation → commodities, energy, TIPS, gold benefit',
  },
  labour: {
    label: 'Labour Market', icon: '👷', subtitle: 'NFP · Unemployment',
    sectors: ['Consumer Discretionary', 'Consumer Staples', 'Retail', 'Healthcare'],
    themes:  ['Consumer Spending', 'Wage Growth', 'AI Automation'],
    bullNote: 'Strong jobs → consumer spending, retail, discretionary',
    bearNote: 'Weak jobs → defensive sectors, staples, healthcare',
  },
  growth: {
    label: 'Growth', icon: '📊', subtitle: 'GDP · PMI · Retail',
    sectors: ['Technology', 'Industrials', 'Consumer Discretionary', 'Materials'],
    themes:  ['AI Infrastructure', 'Capex Cycle', 'Reshoring'],
    bullNote: 'Strong growth → cyclicals, tech, small caps outperform',
    bearNote: 'Weak growth → defensives, healthcare, utilities hold up',
  },
  geopolitical: {
    label: 'Geopolitical', icon: '🌐', subtitle: 'Wars · Sanctions · Trade',
    sectors: ['Defense', 'Energy', 'Gold/Commodities', 'Cybersecurity'],
    themes:  ['Defense Industrial Complex', 'Middle East Energy Crisis', 'Cybersecurity'],
    bullNote: 'De-escalation → risk-on, emerging markets, trade beneficiaries',
    bearNote: 'Escalation → defense, energy, gold, USD safe havens',
  },
  credit: {
    label: 'Credit', icon: '💳', subtitle: 'Spreads · VIX · Yields',
    sectors: ['Financials', 'High Yield', 'Real Estate', 'Private Equity'],
    themes:  ['Financial Stability', 'Regional Banking', 'Leveraged Buyouts'],
    bullNote: 'Tightening spreads → risk assets, high yield, equities',
    bearNote: 'Widening spreads → quality bonds, defensives, cash',
  },
}

const DIRECTION_ICON: Record<string, string> = {
  improving: '↑', deteriorating: '↓', stable: '→',
}

function scoreColor(score: number): string {
  if (score >= 5)  return '#4eca99'
  if (score >= 2)  return '#8de0bf'
  if (score >= -2) return '#e09845'
  if (score >= -5) return '#e8a070'
  return '#e87070'
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

function GaugeMeter({ score }: { score: number }) {
  const pct = scoreToPct(score)
  const color = scoreColor(score)
  return (
    <div className={styles.gaugeWrap}>
      <div className={styles.gaugeLabels}>
        <span>-10</span><span>0</span><span>+10</span>
      </div>
      <div className={styles.gaugeTrack}>
        <div className={styles.gaugeMid} />
        <div className={styles.gaugePointer} style={{ left: `${pct}%`, background: color, color }} />
      </div>
    </div>
  )
}

function MeterCard({ score }: { score: MacroScore }) {
  const [open, setOpen] = useState(false)
  const meta    = ASPECT_META[score.aspect]
  const color   = scoreColor(score.score)
  const label   = scoreLabel(score.score)
  const dirIcon = DIRECTION_ICON[score.direction]
  const isBull  = score.score >= 0

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
          {/* AI commentary */}
          <p className={styles.commentary}>{score.commentary}</p>

          {/* Bull/bear implication */}
          {meta && (
            <div style={{
              fontSize: '0.72rem',
              color: isBull ? '#4eca99' : '#e87070',
              background: isBull ? 'rgba(78,202,153,0.06)' : 'rgba(232,112,112,0.06)',
              border: `1px solid ${isBull ? 'rgba(78,202,153,0.15)' : 'rgba(232,112,112,0.15)'}`,
              borderRadius: 5, padding: '0.45rem 0.65rem',
              marginBottom: '0.75rem', lineHeight: 1.5,
            }}>
              {isBull ? '↑ ' : '↓ '}{isBull ? meta.bullNote : meta.bearNote}
            </div>
          )}

          {/* Impacted sectors */}
          {meta?.sectors.length > 0 && (
            <div style={{ marginBottom: '0.65rem' }}>
              <div style={{ fontSize: '0.6rem', color: 'rgba(232,226,217,0.25)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.35rem' }}>
                Impacted Sectors
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                {meta.sectors.map(s => (
                  <span key={s} style={{
                    fontSize: '0.65rem',
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: 'rgba(232,226,217,0.55)',
                    padding: '0.15rem 0.45rem', borderRadius: 3,
                  }}>{s}</span>
                ))}
              </div>
            </div>
          )}

          {/* Related themes */}
          {meta?.themes.length > 0 && (
            <div style={{ marginBottom: '0.65rem' }}>
              <div style={{ fontSize: '0.6rem', color: 'rgba(232,226,217,0.25)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.35rem' }}>
                Related Themes
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                {meta.themes.map(t => (
                  <span key={t} style={{
                    fontSize: '0.65rem',
                    background: 'rgba(200,169,110,0.08)',
                    border: '1px solid rgba(200,169,110,0.15)',
                    color: 'var(--gold)',
                    padding: '0.15rem 0.45rem', borderRadius: 3,
                  }}>{t}</span>
                ))}
              </div>
            </div>
          )}

          <div className={styles.detailMeta}>
            <span>{score.event_count} events analysed</span>
            <span>Updated {relTime(score.scored_at)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default function MacroHeatPanel() {
  const [scores,  setScores]  = useState<MacroScore[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/macro')
      .then(r => r.json())
      .then(d => { setScores(d.scores ?? []); setLoading(false) })
      .catch(() => { setError('Failed to load macro scores'); setLoading(false) })
  }, [])

  if (loading) return (
    <div className={styles.wrap}>
      <div className={styles.header}><h3 className={styles.title}>Macro Heat Map</h3></div>
      <div className={styles.loading}>Loading macro scores…</div>
    </div>
  )

  if (error) return (
    <div className={styles.wrap}>
      <div className={styles.header}><h3 className={styles.title}>Macro Heat Map</h3></div>
      <div className={styles.empty}>{error}</div>
    </div>
  )

  if (!scores.length) return (
    <div className={styles.wrap}>
      <div className={styles.header}><h3 className={styles.title}>Macro Heat Map</h3></div>
      <div className={styles.empty}>No macro scores yet — run the macro cron to generate scores.</div>
    </div>
  )

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
        {scores.map(s => <MeterCard key={s.aspect} score={s} />)}
      </div>
    </div>
  )
}
