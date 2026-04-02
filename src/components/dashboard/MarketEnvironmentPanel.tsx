'use client'
// src/components/dashboard/MarketEnvironmentPanel.tsx
// Client component — fetches live index quotes from /api/market-snapshot
// Also renders macro aspect heatmap with context labels

import { useEffect, useState } from 'react'

type Quote = {
  symbol:     string
  label:      string
  sublabel:   string
  price:      number | null
  change:     number | null
  change_pct: number | null
  dayHigh:    number | null
  dayLow:     number | null
}

type MacroScore = { aspect: string; score: number }

const ASPECT_META: Record<string, { label: string; icon: string; bullish: string; bearish: string }> = {
  fed:         { label: 'Fed Policy',   icon: '🏦', bullish: 'Dovish — rate cuts supportive', bearish: 'Hawkish — rates weighing on growth' },
  inflation:   { label: 'Inflation',    icon: '📈', bullish: 'Cooling — reducing rate pressure', bearish: 'Elevated — Fed constrained' },
  growth:      { label: 'Growth',       icon: '🌱', bullish: 'Expanding — earnings supportive', bearish: 'Slowing — earnings risk rising' },
  labour:      { label: 'Labour',       icon: '👷', bullish: 'Strong employment — consumer resilient', bearish: 'Weakening — consumer caution' },
  geopolitical:{ label: 'Geopolitical', icon: '🌍', bullish: 'Stable — risk premium low', bearish: 'Elevated risk — defensive positioning' },
  credit:      { label: 'Credit',       icon: '💳', bullish: 'Spreads tight — liquidity supportive', bearish: 'Spreads widening — risk-off signal' },
}

function scoreToColor(score: number): string {
  if (score >= 4)  return '#4eca99'
  if (score >= 2)  return '#8de0bf'
  if (score >= 0)  return '#e09845'
  if (score >= -2) return '#e8a070'
  if (score >= -4) return '#e87070'
  return '#c0392b'
}

function scoreToBar(score: number): number {
  // Map -10..+10 to 0..100%
  return ((score + 10) / 20) * 100
}

export default function MarketEnvironmentPanel({ macroScores }: { macroScores: MacroScore[] }) {
  const [quotes,  setQuotes]  = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)
  const [asOf,    setAsOf]    = useState('')

  useEffect(() => {
    fetch('/api/market-snapshot')
      .then(r => r.json())
      .then(data => {
        setQuotes(data.quotes ?? [])
        if (data.timestamp) {
          setAsOf(new Date(data.timestamp).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }))
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem' }}>

      {/* ── Live Index Quotes ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '0.75rem',
      }}>
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{
                background: 'var(--navy2)', border: '1px solid var(--dash-border)',
                borderRadius: 8, padding: '1rem 1.1rem', height: 80,
                animation: 'pulse 1.5s ease-in-out infinite',
              }} />
            ))
          : quotes.map(q => {
              const isVix   = q.symbol === '^VIX'
              // VIX: higher = more fear = bad → invert color logic
              const up      = isVix
                ? (q.change_pct ?? 0) <= 0
                : (q.change_pct ?? 0) >= 0
              const rawUp   = (q.change_pct ?? 0) >= 0
              const color   = up ? 'var(--signal-bull)' : 'var(--signal-bear)'
              // Format price — VIX has no $ sign
              const priceStr = q.price != null
                ? isVix ? q.price.toFixed(2) : q.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                : '—'
              return (
                <div key={q.symbol} style={{
                  background: 'var(--navy2)', border: '1px solid var(--dash-border)',
                  borderRadius: 8, padding: '0.9rem 1.1rem',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.3rem' }}>
                    <div>
                      <div style={{ fontSize: '0.62rem', color: 'rgba(232,226,217,0.5)', fontWeight: 600, letterSpacing: '0.04em', marginBottom: '0.1rem' }}>
                        {q.label}
                      </div>
                      <div style={{ fontSize: '0.55rem', color: 'rgba(232,226,217,0.2)' }}>
                        {q.sublabel}
                      </div>
                    </div>
                    {isVix && (
                      <span style={{ fontSize: '0.55rem', color: up ? 'rgba(78,202,153,0.5)' : 'rgba(232,112,112,0.5)' }}>
                        {up ? 'Low Fear' : 'High Fear'}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--cream)', fontFamily: 'monospace', lineHeight: 1, marginBottom: '0.3rem' }}>
                    {isVix ? '' : ''}{priceStr}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.3rem' }}>
                    <span style={{ fontSize: '0.72rem', color, fontWeight: 500 }}>
                      {q.change_pct != null ? `${rawUp ? '+' : ''}${q.change_pct.toFixed(2)}%` : '—'}
                    </span>
                    {q.change != null && (
                      <span style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.25)', fontFamily: 'monospace' }}>
                        {rawUp ? '+' : ''}{q.change.toFixed(2)}
                      </span>
                    )}
                  </div>
                  {q.dayHigh != null && q.dayLow != null && (
                    <div style={{ fontSize: '0.58rem', color: 'rgba(232,226,217,0.2)', fontFamily: 'monospace' }}>
                      H {q.dayHigh.toLocaleString('en-US', { maximumFractionDigits: 2 })} · L {q.dayLow.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                    </div>
                  )}
                </div>
              )
            })
        }
      </div>
      {asOf && !loading && (
        <div style={{ fontSize: '0.6rem', color: 'rgba(232,226,217,0.2)', textAlign: 'right', marginTop: '-0.5rem' }}>
          Prev close · updated {asOf}
        </div>
      )}

      {/* ── Macro Heatmap ── compact one-line per aspect + overall heat ── */}
      <div style={{
        background: 'var(--navy2)', border: '1px solid var(--dash-border)',
        borderRadius: 10, padding: '0.9rem 1.2rem',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <div style={{ fontSize: '0.6rem', color: 'rgba(232,226,217,0.25)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            Macro Heat
          </div>
          {/* Overall heat gauge */}
          {(() => {
            const avg   = macroScores.length
              ? macroScores.reduce((a, m) => a + m.score, 0) / macroScores.length
              : 0
            const color = scoreToColor(avg)
            const pct   = scoreToBar(avg)
            const label = avg >= 2 ? 'Bullish' : avg >= 0 ? 'Neutral' : avg >= -2 ? 'Cautious' : 'Bearish'
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{ width: 80, height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 3, position: 'relative' }}>
                  <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.1)' }} />
                  {avg >= 0
                    ? <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: `${(avg / 10) * 50}%`, background: color, borderRadius: '0 3px 3px 0', opacity: 0.85 }} />
                    : <div style={{ position: 'absolute', right: '50%', top: 0, bottom: 0, width: `${(Math.abs(avg) / 10) * 50}%`, background: color, borderRadius: '3px 0 0 3px', opacity: 0.85 }} />
                  }
                </div>
                <span style={{ fontSize: '0.65rem', fontWeight: 600, color }}>{label}</span>
                <span style={{ fontSize: '0.6rem', color: 'rgba(232,226,217,0.3)', fontFamily: 'monospace' }}>
                  {avg > 0 ? '+' : ''}{avg.toFixed(1)}
                </span>
              </div>
            )
          })()}
        </div>

        {/* Compact aspect pills — one row */}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {macroScores
            .sort((a, b) => b.score - a.score)
            .map(m => {
              const meta  = ASPECT_META[m.aspect]
              const color = scoreToColor(m.score)
              const context = m.score > 0 ? meta?.bullish : m.score < 0 ? meta?.bearish : 'Neutral'
              return (
                <div
                  key={m.aspect}
                  title={context}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.35rem',
                    background: `${color}10`, border: `1px solid ${color}28`,
                    borderRadius: 6, padding: '0.3rem 0.6rem',
                    cursor: 'default',
                  }}
                >
                  <span style={{ fontSize: '0.75rem' }}>{meta?.icon}</span>
                  <span style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.55)', fontWeight: 500 }}>
                    {meta?.label ?? m.aspect}
                  </span>
                  <span style={{ fontSize: '0.68rem', fontWeight: 700, color, fontFamily: 'monospace' }}>
                    {m.score > 0 ? '+' : ''}{m.score.toFixed(1)}
                  </span>
                  {/* Mini bar */}
                  <div style={{ width: 24, height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, position: 'relative' }}>
                    <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.1)' }} />
                    {m.score >= 0
                      ? <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: `${(m.score / 10) * 50}%`, background: color, borderRadius: '0 2px 2px 0', opacity: 0.8 }} />
                      : <div style={{ position: 'absolute', right: '50%', top: 0, bottom: 0, width: `${(Math.abs(m.score) / 10) * 50}%`, background: color, borderRadius: '2px 0 0 2px', opacity: 0.8 }} />
                    }
                  </div>
                </div>
              )
            })}
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.7; }
        }
      `}</style>
    </div>
  )
}
