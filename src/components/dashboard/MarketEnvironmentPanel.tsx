'use client'
// src/components/dashboard/MarketEnvironmentPanel.tsx
// Client component — fetches live index quotes from /api/market-snapshot
// Also renders macro aspect heatmap with context labels

import { useEffect, useState } from 'react'

type Quote = {
  ticker:     string
  label:      string
  price:      number | null
  change:     number | null
  change_pct: number | null
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
              const up    = (q.change_pct ?? 0) >= 0
              const color = up ? 'var(--signal-bull)' : 'var(--signal-bear)'
              const isVix = q.ticker === 'VIXY'
              return (
                <div key={q.ticker} style={{
                  background: 'var(--navy2)', border: '1px solid var(--dash-border)',
                  borderRadius: 8, padding: '0.9rem 1.1rem',
                }}>
                  <div style={{ fontSize: '0.6rem', color: 'rgba(232,226,217,0.3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.4rem' }}>
                    {q.label}{isVix ? ' proxy' : ''}
                  </div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--cream)', fontFamily: 'monospace', lineHeight: 1 }}>
                    {q.price != null ? `$${q.price.toFixed(2)}` : '—'}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.3rem' }}>
                    <span style={{ fontSize: '0.72rem', color, fontWeight: 500 }}>
                      {q.change_pct != null ? `${up ? '+' : ''}${q.change_pct.toFixed(2)}%` : '—'}
                    </span>
                    {q.change != null && (
                      <span style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.25)', fontFamily: 'monospace' }}>
                        {up ? '+' : ''}{q.change.toFixed(2)}
                      </span>
                    )}
                  </div>
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

      {/* ── Macro Aspect Heatmap ── */}
      <div style={{
        background: 'var(--navy2)', border: '1px solid var(--dash-border)',
        borderRadius: 10, padding: '1.2rem 1.4rem',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.25)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            Macro Environment
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            {[['Bearish', '#e87070'], ['Neutral', '#e09845'], ['Bullish', '#4eca99']].map(([l, c]) => (
              <div key={l} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: c }} />
                <span style={{ fontSize: '0.58rem', color: 'rgba(232,226,217,0.3)' }}>{l}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          {macroScores
            .sort((a, b) => b.score - a.score)
            .map(m => {
              const meta  = ASPECT_META[m.aspect]
              const color = scoreToColor(m.score)
              const bar   = scoreToBar(m.score)
              const context = m.score > 0
                ? meta?.bullish
                : m.score < 0
                  ? meta?.bearish
                  : 'Neutral conditions'

              return (
                <div key={m.aspect}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.85rem' }}>{meta?.icon}</span>
                      <span style={{ fontSize: '0.78rem', color: 'var(--cream)', fontWeight: 500 }}>
                        {meta?.label ?? m.aspect}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <span style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.35)', fontStyle: 'italic' }}>
                        {context}
                      </span>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color, fontFamily: 'monospace', minWidth: '2.5rem', textAlign: 'right' }}>
                        {m.score > 0 ? '+' : ''}{m.score.toFixed(1)}
                      </span>
                    </div>
                  </div>
                  {/* Bar — center is neutral (50%) */}
                  <div style={{ position: 'relative', height: 5, background: 'rgba(255,255,255,0.05)', borderRadius: 3 }}>
                    {/* Centre line */}
                    <div style={{
                      position: 'absolute', left: '50%', top: 0, bottom: 0,
                      width: 1, background: 'rgba(255,255,255,0.1)',
                    }} />
                    {/* Score bar */}
                    {m.score >= 0
                      ? <div style={{
                          position: 'absolute', left: '50%', top: 0, bottom: 0,
                          width: `${(m.score / 10) * 50}%`,
                          background: color, borderRadius: '0 3px 3px 0', opacity: 0.8,
                        }} />
                      : <div style={{
                          position: 'absolute', right: `${50}%`, top: 0, bottom: 0,
                          width: `${(Math.abs(m.score) / 10) * 50}%`,
                          background: color, borderRadius: '3px 0 0 3px', opacity: 0.8,
                        }} />
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
