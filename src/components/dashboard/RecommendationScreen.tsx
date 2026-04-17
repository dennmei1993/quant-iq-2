'use client'
// src/components/dashboard/RecommendationScreen.tsx
//
// Step 4 of portfolio builder — shows recommendations from portfolio_build_tickers.
// Persists to DB: when user reaches this screen, run status → 'recommendations'.
// When "Add to Holdings" is clicked, ticker is marked was_confirmed=true + added_at.
// Can also be loaded standalone from portfolio page to show the active recommendation.

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RecommendationTicker {
  id:                string   // portfolio_build_tickers.id
  ticker:            string
  name:              string
  signal:            'BUY' | 'WATCH'
  weight:            number
  price:             number | null
  rationale:         string
  theme_name:        string
  fundamental_score: number | null
  technical_score:   number | null
  was_confirmed:     boolean
  added_at:          string | null
}

export interface RecommendationRun {
  id:           string   // portfolio_build_runs.id
  mode:         string
  status:       string
  strategy:     any
  created_at:   string
  portfolio_build_tickers: RecommendationTicker[]
}

interface Props {
  portfolioId:     string
  totalCapital:    number
  cashReservePct:  number
  // Provided when coming from builder (step 4)
  runId?:          string
  recommendations?: RecommendationTicker[]
  onBack?:         () => void
  onDone:          () => void
  // Standalone mode — loads from DB
  standalone?:     boolean
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const T = {
  cream:  'var(--cream)',
  gold:   'var(--gold)',
  navy2:  'var(--navy2)',
  border: 'var(--dash-border)',
  dim:    'rgba(232,226,217,0.45)',
  dimmer: 'rgba(232,226,217,0.30)',
} as const

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.65rem', color: 'rgba(232,226,217,0.45)',
  marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.08em',
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '0.45rem 0.65rem',
  background: 'rgba(255,255,255,0.05)', border: '1px solid var(--dash-border)',
  borderRadius: 5, color: 'var(--cream)', fontSize: '0.82rem', outline: 'none',
  boxSizing: 'border-box',
}

function fmtCurrency(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(1)}K`
  return `$${v.toFixed(0)}`
}

function ScoreBar({ label, value, color }: { label: string; value: number | null; color: string }) {
  if (value == null) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
      <span style={{ fontSize: '0.58rem', color: T.dim, width: '1rem', flexShrink: 0 }}>{label}</span>
      <div style={{ width: 40, height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${value}%`, background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: '0.62rem', color, minWidth: '1.6rem' }}>{value}</span>
    </div>
  )
}

// ─── Add Holding Modal ────────────────────────────────────────────────────────

function AddHoldingModal({
  portfolioId,
  rec,
  onClose,
  onAdded,
}: {
  portfolioId: string
  rec:         RecommendationTicker
  onClose:     () => void
  onAdded:     () => void
}) {
  const [qty,    setQty]    = useState('')
  const [price,  setPrice]  = useState(rec.price ? rec.price.toFixed(2) : '')
  const [date,   setDate]   = useState(new Date().toISOString().split('T')[0])
  const [fees,   setFees]   = useState('')
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  async function handleAdd() {
    const qtyNum   = parseFloat(qty)
    const priceNum = parseFloat(price)
    if (isNaN(qtyNum)   || qtyNum   <= 0) { setError('Enter a valid quantity'); return }
    if (isNaN(priceNum) || priceNum <= 0) { setError('Enter a valid price');    return }
    setSaving(true); setError('')
    try {
      // 1. Record buy transaction → FIFO position recalculation runs
      const res = await fetch('/api/portfolio/transaction', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          portfolio_id: portfolioId,
          ticker:       rec.ticker,
          type:         'buy',
          quantity:     qtyNum,
          price:        priceNum,
          fees:         parseFloat(fees) || 0,
          executed_at:  new Date(date).toISOString(),
          notes:        `[${rec.theme_name}] ${rec.rationale}`.slice(0, 200),
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Failed')

      // 2. Mark ticker as added in recommendation DB
      await fetch('/api/portfolio/builder/recommendation', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ run_id: rec.id.split(':')[0], ticker_id: rec.id }),
        // Note: rec.id is portfolio_build_tickers.id — but we need run_id separately
        // This is handled in the parent component
      })

      onAdded()
    } catch (e: any) {
      setError(e.message ?? 'Failed to add')
      setSaving(false)
    }
  }

  const total = parseFloat(qty || '0') * parseFloat(price || '0') + parseFloat(fees || '0')

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.6)' }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 301, background: 'var(--navy2)', border: '1px solid var(--dash-border)', borderRadius: 8, padding: '1.4rem', width: 380, boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
          <div>
            <div style={{ fontSize: '0.6rem', color: T.dim, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>Add to Holdings</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--gold)', fontFamily: 'var(--font-mono)' }}>{rec.ticker}</div>
            <div style={{ fontSize: '0.68rem', color: T.dim, marginTop: 1 }}>{rec.name}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: T.dimmer, cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1 }}>×</button>
        </div>

        {/* Recommendation context */}
        <div style={{ background: 'rgba(200,169,110,0.06)', border: '1px solid rgba(200,169,110,0.15)', borderRadius: 6, padding: '0.6rem 0.8rem', marginBottom: '1rem', fontSize: '0.7rem', color: T.dim, lineHeight: 1.5 }}>
          <div style={{ marginBottom: 3 }}><span style={{ color: 'var(--gold)', fontWeight: 600 }}>Recommended: </span>{rec.weight}% of portfolio</div>
          <div style={{ color: 'rgba(232,226,217,0.35)', fontStyle: 'italic' }}>{rec.rationale}</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem', marginBottom: '0.75rem' }}>
          <div>
            <div style={labelStyle}>Quantity</div>
            <input value={qty} onChange={e => setQty(e.target.value)} placeholder="100" type="number" style={inputStyle} autoFocus />
          </div>
          <div>
            <div style={labelStyle}>Buy price ($)</div>
            <input value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" type="number" style={inputStyle} />
          </div>
          <div>
            <div style={labelStyle}>Date</div>
            <input value={date} onChange={e => setDate(e.target.value)} type="date" style={inputStyle} />
          </div>
          <div>
            <div style={labelStyle}>Fees ($)</div>
            <input value={fees} onChange={e => setFees(e.target.value)} placeholder="0.00" type="number" style={inputStyle} />
          </div>
        </div>

        {qty && price && (
          <div style={{ fontSize: '0.72rem', color: T.dim, marginBottom: '0.8rem', padding: '0.45rem 0.7rem', background: 'rgba(255,255,255,0.03)', borderRadius: 5, border: '1px solid rgba(255,255,255,0.06)' }}>
            Total cost: <strong style={{ color: 'var(--cream)' }}>${total.toFixed(2)}</strong>
          </div>
        )}

        {error && <div style={{ fontSize: '0.72rem', color: '#e87070', marginBottom: '0.8rem' }}>{error}</div>}

        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '0.45rem 0.9rem', background: 'none', border: '1px solid var(--dash-border)', color: T.dim, borderRadius: 5, cursor: 'pointer', fontSize: '0.8rem' }}>Cancel</button>
          <button onClick={handleAdd} disabled={saving || !qty || !price}
            style={{ padding: '0.45rem 1.1rem', background: 'rgba(78,255,145,0.12)', border: '1px solid rgba(78,255,145,0.3)', color: 'var(--green)', fontWeight: 700, borderRadius: 5, cursor: saving || !qty || !price ? 'not-allowed' : 'pointer', fontSize: '0.8rem', opacity: saving || !qty || !price ? 0.5 : 1 }}>
            {saving ? 'Adding…' : 'Add Holding'}
          </button>
        </div>
      </div>
    </>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function RecommendationScreen({
  portfolioId,
  totalCapital,
  cashReservePct,
  runId: propRunId,
  recommendations: propRecs,
  onBack,
  onDone,
  standalone = false,
}: Props) {
  const [runId,      setRunId]      = useState<string | null>(propRunId ?? null)
  const [recs,       setRecs]       = useState<RecommendationTicker[]>(propRecs ?? [])
  const [addingRec,  setAddingRec]  = useState<RecommendationTicker | null>(null)
  const [loading,    setLoading]    = useState(standalone)
  const [createdAt,  setCreatedAt]  = useState<string | null>(null)
  const [mode,       setMode]       = useState<string | null>(null)

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // Standalone: load from DB
  useEffect(() => {
    if (!standalone) return
    async function load() {
      setLoading(true)
      try {
        const res  = await fetch(`/api/portfolio/builder/recommendation?portfolio_id=${portfolioId}`)
        const data = await res.json()
        if (data.recommendation) {
          const run = data.recommendation as RecommendationRun
          setRunId(run.id)
          setCreatedAt(run.created_at)
          setMode(run.mode)
          setRecs(run.portfolio_build_tickers.filter((t: any) => t.included !== false) as RecommendationTicker[])
        }
      } catch {}
      finally { setLoading(false) }
    }
    load()
  }, [standalone, portfolioId])

  // Transition run status to 'recommendations' when we arrive at this screen
  useEffect(() => {
    if (!propRunId || standalone) return
    fetch('/api/portfolio/builder/recommendation', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ run_id: propRunId }),
    })
    setRunId(propRunId)
  }, [propRunId, standalone])

  async function handleAdded(rec: RecommendationTicker) {
    // Mark in DB
    if (runId) {
      await fetch('/api/portfolio/builder/recommendation', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ run_id: runId, ticker_id: rec.id }),
      })
    }
    // Mark locally
    setRecs(prev => prev.map(r => r.id === rec.id ? { ...r, was_confirmed: true, added_at: new Date().toISOString() } : r))
    setAddingRec(null)
  }

  const investable = totalCapital * (1 - cashReservePct / 100)
  const buys       = recs.filter(r => r.signal === 'BUY')
  const watches    = recs.filter(r => r.signal === 'WATCH')
  const addedCount = recs.filter(r => r.was_confirmed).length

  if (loading) return (
    <div style={{ padding: '3rem', textAlign: 'center', color: T.dim, fontSize: '0.82rem' }}>
      Loading recommendations…
    </div>
  )

  if (standalone && recs.length === 0) return (
    <div style={{ padding: '2rem', textAlign: 'center', color: T.dim, fontSize: '0.82rem' }}>
      No active recommendations. Use <strong style={{ color: 'var(--gold)' }}>✦ Build portfolio</strong> to generate one.
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* Header card */}
      <div style={{ background: 'var(--navy2)', border: '1px solid var(--dash-border)', borderRadius: 10, padding: '1rem 1.3rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
          <div>
            <div style={{ fontSize: '0.62rem', color: 'rgba(200,169,110,0.55)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              Portfolio Recommendations
              {mode && (
                <span style={{ fontSize: '0.58rem', background: 'rgba(200,169,110,0.1)', color: 'rgba(200,169,110,0.65)', border: '1px solid rgba(200,169,110,0.2)', borderRadius: 3, padding: '0px 5px' }}>
                  {mode === 'llm' ? '✦ LLM' : '◈ Data'}
                </span>
              )}
            </div>
            <div style={{ fontSize: '0.78rem', color: T.dim, lineHeight: 1.5 }}>
              These are advisory recommendations — you decide which to act on.
              Each "Add to Holdings" opens a buy transaction with the recommended ticker pre-filled.
            </div>
            {createdAt && (
              <div style={{ fontSize: '0.62rem', color: 'rgba(232,226,217,0.28)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                Generated {new Date(createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </div>
            )}
          </div>
          {addedCount > 0 && (
            <span style={{ fontSize: '0.72rem', background: 'rgba(78,255,145,0.1)', color: 'var(--green)', border: '1px solid rgba(78,255,145,0.25)', borderRadius: 20, padding: '0.2rem 0.75rem', whiteSpace: 'nowrap', marginLeft: 12, flexShrink: 0 }}>
              {addedCount} added
            </span>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.8rem' }}>
          {[
            { label: 'BUY signals',  value: `${buys.length} tickers`            },
            { label: 'WATCH',        value: `${watches.length} tickers`          },
            { label: 'Investable',   value: fmtCurrency(investable)              },
            { label: 'Added',        value: `${addedCount} of ${buys.length}`    },
          ].map(({ label, value }) => (
            <div key={label}>
              <div style={{ fontSize: '0.58rem', color: T.dimmer, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</div>
              <div style={{ fontSize: '0.88rem', fontWeight: 600, color: T.cream, marginTop: 2 }}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* BUY recommendations */}
      {buys.length > 0 && (
        <div>
          <div style={{ fontSize: '0.62rem', color: 'rgba(78,202,153,0.6)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.6rem' }}>
            BUY — {buys.length} positions recommended
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {buys.map(rec => {
              const isAdded      = rec.was_confirmed
              const suggestedCap = rec.price && rec.weight
                ? ((rec.weight / 100) * investable)
                : null

              return (
                <div key={rec.id} style={{ background: isAdded ? 'rgba(78,255,145,0.03)' : 'var(--navy2)', border: `1px solid ${isAdded ? 'rgba(78,255,145,0.2)' : 'var(--dash-border)'}`, borderRadius: 8, padding: '0.9rem 1.1rem', display: 'flex', alignItems: 'flex-start', gap: '1rem', transition: 'all 0.2s' }}>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.9rem', color: T.cream, fontFamily: 'var(--font-mono)' }}>{rec.ticker}</span>
                      <span style={{ fontSize: '0.65rem', color: T.dim }}>{rec.name}</span>
                      <span style={{ fontSize: '0.6rem', background: 'rgba(78,202,153,0.1)', color: '#4eca99', border: '1px solid rgba(78,202,153,0.25)', borderRadius: 4, padding: '0.05rem 0.4rem', fontWeight: 700 }}>BUY</span>
                      {rec.theme_name && (
                        <span style={{ fontSize: '0.6rem', background: 'rgba(200,169,110,0.08)', color: 'rgba(200,169,110,0.7)', border: '1px solid rgba(200,169,110,0.18)', borderRadius: 4, padding: '0.05rem 0.4rem' }}>{rec.theme_name}</span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: T.dim, lineHeight: 1.5, marginBottom: '0.4rem' }}>{rec.rationale}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                      {(rec.fundamental_score != null || rec.technical_score != null) && (
                        <div style={{ display: 'flex', gap: '0.6rem' }}>
                          <ScoreBar label="F" value={rec.fundamental_score} color="rgba(200,169,110,0.8)" />
                          <ScoreBar label="T" value={rec.technical_score}   color="rgba(99,179,237,0.8)" />
                        </div>
                      )}
                      {rec.price && <span style={{ fontSize: '0.7rem', color: T.dim, fontFamily: 'var(--font-mono)' }}>${rec.price.toFixed(2)}</span>}
                      {suggestedCap && <span style={{ fontSize: '0.68rem', color: 'rgba(99,179,237,0.7)' }}>{fmtCurrency(suggestedCap)} suggested ({rec.weight}%)</span>}
                      {isAdded && rec.added_at && (
                        <span style={{ fontSize: '0.62rem', color: 'rgba(78,202,153,0.5)', fontFamily: 'var(--font-mono)' }}>
                          added {new Date(rec.added_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.3rem' }}>
                    {isAdded ? (
                      <span style={{ fontSize: '0.72rem', color: '#4eca99', display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.35rem 0.8rem', border: '1px solid rgba(78,202,153,0.25)', borderRadius: 5, background: 'rgba(78,202,153,0.06)' }}>
                        ✓ Added
                      </span>
                    ) : (
                      <button onClick={() => setAddingRec(rec)}
                        style={{ padding: '0.4rem 0.9rem', background: 'rgba(78,255,145,0.08)', border: '1px solid rgba(78,255,145,0.3)', color: 'var(--green)', borderRadius: 5, cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        + Add to Holdings
                      </button>
                    )}
                    <div style={{ fontSize: '0.6rem', color: T.dimmer, textAlign: 'right' }}>{rec.weight}% weight</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* WATCH list */}
      {watches.length > 0 && (
        <div>
          <div style={{ fontSize: '0.62rem', color: 'rgba(240,180,41,0.6)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.6rem' }}>
            WATCH — monitor these, add when signal strengthens
          </div>
          <div style={{ background: 'var(--navy2)', border: '1px solid var(--dash-border)', borderRadius: 8, overflow: 'hidden' }}>
            {watches.map((rec, i) => (
              <div key={rec.id} style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', padding: '0.7rem 1rem', borderBottom: i < watches.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                <span style={{ fontWeight: 700, fontSize: '0.82rem', color: T.cream, fontFamily: 'var(--font-mono)', minWidth: 60 }}>{rec.ticker}</span>
                <span style={{ fontSize: '0.62rem', background: 'rgba(240,180,41,0.08)', color: '#f0b429', border: '1px solid rgba(240,180,41,0.2)', borderRadius: 4, padding: '0.05rem 0.35rem', fontWeight: 700, flexShrink: 0 }}>WATCH</span>
                <span style={{ fontSize: '0.68rem', color: T.dim, flex: 1 }}>{rec.name}</span>
                {rec.theme_name && <span style={{ fontSize: '0.65rem', color: T.dimmer, flexShrink: 0 }}>{rec.theme_name}</span>}
                {rec.price && <span style={{ fontSize: '0.68rem', color: T.dim, fontFamily: 'var(--font-mono)', flexShrink: 0 }}>${rec.price.toFixed(2)}</span>}
                <button onClick={() => setAddingRec(rec)}
                  style={{ padding: '0.25rem 0.6rem', background: rec.was_confirmed ? 'rgba(78,202,153,0.06)' : 'none', border: `1px solid ${rec.was_confirmed ? 'rgba(78,202,153,0.25)' : 'rgba(240,180,41,0.2)'}`, color: rec.was_confirmed ? '#4eca99' : '#f0b429', borderRadius: 4, cursor: 'pointer', fontSize: '0.65rem', flexShrink: 0 }}>
                  {rec.was_confirmed ? '✓' : '+ Add'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.5rem' }}>
        {onBack ? (
          <button onClick={onBack} style={{ padding: '0.5rem 1rem', background: 'transparent', border: '1px solid var(--dash-border)', color: T.dim, borderRadius: 6, cursor: 'pointer', fontSize: '0.8rem' }}>
            ← Back to allocation
          </button>
        ) : <div />}
        <button onClick={onDone}
          style={{ padding: '0.55rem 1.4rem', background: 'var(--gold)', color: 'var(--navy)', fontWeight: 700, borderRadius: 7, border: 'none', fontSize: '0.85rem', cursor: 'pointer' }}>
          {standalone ? 'Close' : 'Done →'}
        </button>
      </div>

      {/* Add Holding Modal */}
      {addingRec && (
        <AddHoldingModal
          portfolioId={portfolioId}
          rec={addingRec}
          onClose={() => setAddingRec(null)}
          onAdded={() => handleAdded(addingRec)}
        />
      )}
    </div>
  )
}
