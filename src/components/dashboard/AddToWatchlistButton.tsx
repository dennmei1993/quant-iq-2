'use client'
// src/components/dashboard/AddToWatchlistButton.tsx
//
// Shown on ticker detail pages.
// Lets user add this ticker to the watchlist of a specific portfolio.

import { useState, useEffect } from 'react'

interface Portfolio { id: string; name: string }

interface Props {
  ticker: string
  name?:  string
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.65rem', color: 'rgba(232,226,217,0.45)',
  marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.08em',
}
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '0.45rem 0.65rem',
  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 5, color: 'var(--cream)', fontSize: '0.82rem', outline: 'none',
  boxSizing: 'border-box',
}

export default function AddToWatchlistButton({ ticker, name }: Props) {
  const [open,        setOpen]        = useState(false)
  const [portfolios,  setPortfolios]  = useState<Portfolio[]>([])
  const [portfolioId, setPortfolioId] = useState('')
  const [notes,       setNotes]       = useState('')
  const [saving,      setSaving]      = useState(false)
  const [done,        setDone]        = useState(false)
  const [error,       setError]       = useState('')

  useEffect(() => {
    if (!open) return
    fetch('/api/portfolio')
      .then(r => r.json())
      .then(d => {
        const all: Portfolio[] = d.portfolios ?? (d.portfolio ? [d.portfolio] : [])
        setPortfolios(all)
        if (all.length && !portfolioId) setPortfolioId(all[0].id)
      })
      .catch(() => {})
  }, [open])

  async function handleAdd() {
    if (!portfolioId) { setError('Select a portfolio'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/portfolio/watchlist', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ portfolio_id: portfolioId, ticker, name: name ?? null, notes: notes || null }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Failed')
      setDone(true)
      setTimeout(() => { setOpen(false); setDone(false); setNotes('') }, 1500)
    } catch (e: any) {
      setError(e.message ?? 'Failed')
    } finally {
      setSaving(false)
    }
  }

  function handleClose() {
    setOpen(false); setError(''); setDone(false); setNotes('')
  }

  return (
    <>
      <button onClick={() => setOpen(true)} style={{
        padding: '0.55rem 1.1rem', borderRadius: 7,
        border: '1px solid rgba(200,169,110,0.3)',
        background: 'rgba(200,169,110,0.06)',
        color: 'var(--gold)', fontSize: '0.82rem', fontWeight: 500, cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: '0.5rem', transition: 'all 0.15s',
      }}>
        <span style={{ fontSize: '1rem' }}>☆</span> Add to Watchlist
      </button>

      {open && (
        <>
          <div onClick={handleClose} style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.6)' }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            zIndex: 301, background: 'var(--navy2)', border: '1px solid var(--dash-border)',
            borderRadius: 8, padding: '1.4rem', width: 340,
            boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.1rem' }}>
              <div>
                <div style={{ fontSize: '0.6rem', color: 'rgba(232,226,217,0.40)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>
                  Add to Watchlist
                </div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--gold)', fontFamily: 'var(--font-mono)' }}>{ticker}</div>
                {name && <div style={{ fontSize: '0.68rem', color: 'rgba(232,226,217,0.40)', marginTop: 1 }}>{name}</div>}
              </div>
              <button onClick={handleClose} style={{ background: 'none', border: 'none', color: 'rgba(232,226,217,0.35)', cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1 }}>×</button>
            </div>

            {done ? (
              <div style={{ textAlign: 'center', padding: '1.2rem 0', color: 'var(--gold)', fontSize: '0.88rem', fontWeight: 600 }}>
                ★ Added to watchlist
              </div>
            ) : (
              <>
                <div style={{ marginBottom: '0.75rem' }}>
                  <div style={labelStyle}>Portfolio</div>
                  {portfolios.length === 0 ? (
                    <div style={{ fontSize: '0.75rem', color: 'rgba(232,226,217,0.35)' }}>No portfolios — create one first</div>
                  ) : (
                    <select value={portfolioId} onChange={e => setPortfolioId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                      {portfolios.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  )}
                </div>

                <div style={{ marginBottom: '0.9rem' }}>
                  <div style={labelStyle}>Notes (optional)</div>
                  <input value={notes} onChange={e => setNotes(e.target.value)}
                    placeholder="e.g. Watch for breakout above $200"
                    style={inputStyle} />
                </div>

                {error && <div style={{ fontSize: '0.72rem', color: '#fc5c65', marginBottom: '0.7rem' }}>{error}</div>}

                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                  <button onClick={handleClose} style={{ padding: '0.45rem 1rem', background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(232,226,217,0.40)', borderRadius: 6, cursor: 'pointer', fontSize: '0.78rem' }}>
                    Cancel
                  </button>
                  <button onClick={handleAdd} disabled={saving || portfolios.length === 0} style={{
                    padding: '0.45rem 1.1rem',
                    background: 'rgba(200,169,110,0.12)', border: '1px solid rgba(200,169,110,0.35)',
                    color: 'var(--gold)', fontWeight: 700, borderRadius: 6,
                    cursor: saving || portfolios.length === 0 ? 'not-allowed' : 'pointer',
                    fontSize: '0.78rem', opacity: saving ? 0.6 : 1,
                  }}>
                    {saving ? '…' : '★ Add to Watchlist'}
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </>
  )
}
