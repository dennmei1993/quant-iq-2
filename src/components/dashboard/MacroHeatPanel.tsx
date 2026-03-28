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
    label:    'Interest Rates',
    icon:     '🏦',
    subtitle: 'US Federal Reserve · borrowing costs',
    sectors:  ['Banks & lenders', 'Property & housing', 'Power & utilities', 'Tech companies'],
    themes:   ['Rate-Sensitive Growth', 'Regional Banking', 'Property Trusts'],
    bullNote: 'Rates falling → cheaper loans, rising property values, tech stocks tend to go up',
    bearNote: 'Rates rising → banks earn more, savings rates improve, property prices under pressure',
  },
  inflation: {
    label:    'Cost of Living',
    icon:     '🛒',
    subtitle: 'Prices · inflation · purchasing power',
    sectors:  ['Oil & gas', 'Mining & metals', 'Supermarkets & staples', 'Manufacturing'],
    themes:   ['Commodity Supercycle', 'Inflation Hedges', 'Clean Energy Transition'],
    bullNote: 'Prices cooling → household budgets improve, consumer spending picks up',
    bearNote: 'Prices rising → energy, gold, and everyday essential companies hold value better',
  },
  labour: {
    label:    'Jobs & Wages',
    icon:     '👷',
    subtitle: 'Employment · wage growth · job security',
    sectors:  ['Retail & shopping', 'Restaurants & leisure', 'Supermarkets', 'Healthcare'],
    themes:   ['Consumer Spending', 'Wage Growth', 'AI & Automation'],
    bullNote: 'More jobs → people spend more, retailers and restaurants benefit',
    bearNote: 'Job losses → people cut spending, defensive stocks like supermarkets hold up better',
  },
  growth: {
    label:    'Economic Growth',
    icon:     '📊',
    subtitle: 'GDP · business activity · consumer spending',
    sectors:  ['Technology', 'Construction & infrastructure', 'Retail & discretionary', 'Mining'],
    themes:   ['AI Infrastructure', 'Infrastructure Buildout', 'Reshoring'],
    bullNote: 'Economy growing → most shares do well, especially tech and construction',
    bearNote: 'Economy slowing → everyday essential stocks and healthcare tend to hold up better',
  },
  geopolitical: {
    label:    'World Events',
    icon:     '🌐',
    subtitle: 'Conflicts · trade tensions · global stability',
    sectors:  ['Defence & weapons', 'Oil & gas', 'Gold', 'Cybersecurity'],
    themes:   ['Defense Industrial Complex', 'Middle East Energy Crisis', 'Cybersecurity'],
    bullNote: 'Tensions easing → markets generally rise, travel and trade stocks recover',
    bearNote: 'Tensions rising → defence, oil, and gold companies typically benefit',
  },
  credit: {
    label:    'Market Confidence',
    icon:     '📉',
    subtitle: 'Investor sentiment · market stress · fear levels',
    sectors:  ['Banks & financial services', 'Insurance', 'Property', 'Shares broadly'],
    themes:   ['Financial Stability', 'Regional Banking', 'Income & Dividends'],
    bullNote: 'Confidence high → investors willing to take risks, shares generally rise',
    bearNote: 'Confidence low → investors move to safety — cash, government bonds, gold',
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
  if (score >= 6)  return 'Very Positive'
  if (score >= 3)  return 'Positive'
  if (score >= 1)  return 'Slightly Positive'
  if (score >= -1) return 'Neutral'
  if (score >= -3) return 'Slightly Negative'
  if (score >= -6) return 'Negative'
  return 'Very Negative'
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
  const pct   = scoreToPct(score)
  const color = scoreColor(score)
  return (
    <div className={styles.gaugeWrap}>
      <div className={styles.gaugeLabels}>
        <span>Negative</span><span>Neutral</span><span>Positive</span>
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

          {/* Plain English implication */}
          {meta && (
            <div style={{
              fontSize: '0.72rem',
              color: isBull ? '#4eca99' : '#e87070',
              background: isBull ? 'rgba(78,202,153,0.06)' : 'rgba(232,112,112,0.06)',
              border: `1px solid ${isBull ? 'rgba(78,202,153,0.15)' : 'rgba(232,112,112,0.15)'}`,
              borderRadius: 5, padding: '0.5rem 0.7rem',
              marginBottom: '0.75rem', lineHeight: 1.6,
            }}>
              <strong style={{ display: 'block', marginBottom: '0.2rem', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.7 }}>
                What this means for investors
              </strong>
              {isBull ? meta.bullNote : meta.bearNote}
            </div>
          )}

          {/* Affected industries */}
          {meta?.sectors.length > 0 && (
            <div style={{ marginBottom: '0.65rem' }}>
              <div style={{ fontSize: '0.6rem', color: 'rgba(232,226,217,0.25)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.35rem' }}>
                Industries most affected
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

          {/* Related investment themes */}
          {meta?.themes.length > 0 && (
            <div style={{ marginBottom: '0.65rem' }}>
              <div style={{ fontSize: '0.6rem', color: 'rgba(232,226,217,0.25)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.35rem' }}>
                Related investment themes
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
            <span>{score.event_count} news events analysed</span>
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
      <div className={styles.header}><h3 className={styles.title}>Market Conditions</h3></div>
      <div className={styles.loading}>Loading…</div>
    </div>
  )

  if (error) return (
    <div className={styles.wrap}>
      <div className={styles.header}><h3 className={styles.title}>Market Conditions</h3></div>
      <div className={styles.empty}>{error}</div>
    </div>
  )

  if (!scores.length) return (
    <div className={styles.wrap}>
      <div className={styles.header}><h3 className={styles.title}>Market Conditions</h3></div>
      <div className={styles.empty}>No data yet — run the macro cron to generate scores.</div>
    </div>
  )

  const overallScore = scores.reduce((s, m) => s + m.score, 0) / scores.length
  const overallColor = scoreColor(overallScore)

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <div>
          <h3 className={styles.title}>Market Conditions</h3>
          <p className={styles.sub}>How 6 key economic factors are affecting markets right now · click any card to learn more</p>
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
