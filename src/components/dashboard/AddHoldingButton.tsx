'use client'
// src/components/dashboard/AddHoldingButton.tsx
//
// Replaces WatchlistButton on ticker detail pages.
// Shows a modal with: portfolio selector, type (buy/watch), qty, price, date, fees.
// Calls /api/portfolio/transaction to record the buy, or just adds a draft holding.

import { useState, useEffect } from 'react'

interface Portfolio {
  id:   string
  name: string
}

interface Props {
  ticker: string
  name?:  string
  price?: number | null
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

export default function AddHoldingButton({ ticker, name, price }: Props) {
  const [open,       setOpen]       = useState(false)
  const [portfolios, setPortfolios] = useState<Portfolio[]>([])
  const [portfolioId, setPortfolioId] = useState<string>('')
  const [type,       setType]       = useState<'buy' | 'watch'>('buy')
  const [qty,        setQty]        = useState('')
  const [priceVal,   setPriceVal]   = useState(price ? price.toFixed(2) : '')
  const [date,       setDate]       = useState(new Date().toISOString().split('T')[0])
  const [fees,       setFees]       = useState('')
  const [saving,     setSaving]     = useState(false)
  const [done,       setDone]       = useState(false)
  const [error,      setError]      = useState('')

  // Load portfolios when modal opens
  useEffect(() => {
    if (!open) return
    fetch('/api/portfolio')
      .then(r => r.json())
      .then(d => {
        const all: Portfolio[] = d.portfolios ?? (d.portfolio ? [d.portfolio] : [])
        setPortfolios(all)
        if (all.length > 0 && !portfolioId) setPortfolioId(all[0].id)
      })
      .catch(() => {})
  }, [open])

  async function handleSubmit() {
    if (!portfolioId) { setError('Select a portfolio'); return }
    setSaving(true); setError('')

    try {
      if (type === 'buy') {
        const qtyNum   = parseFloat(qty)
        const priceNum = parseFloat(priceVal)
        if (isNaN(qtyNum)   || qtyNum   <= 0) { setError('Enter a valid quantity'); setSaving(false); return }
        if (isNaN(priceNum) || priceNum <= 0) { setError('Enter a valid price');    setSaving(false); return }

        const res = await fetch('/api/portfolio/transaction', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            portfolio_id: portfolioId,
            ticker,
            type:         'buy',
            quantity:     qtyNum,
            price:        priceNum,
            fees:         parseFloat(fees) || 0,
            executed_at:  new Date(date).toISOString(),
          }),
        })
        const d = await res.json()
        if (!res.ok) throw new Error(d.error ?? 'Failed to record buy')
      } else {
        // Watch — add as draft holding (no qty/price required)
        const res = await fetch('/api/portfolio', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action:       'add_holding',
            portfolio_id: portfolioId,
            ticker,
          }),
        })
        const d = await res.json()
        if (!res.ok) throw new Error(d.error ?? 'Failed to add to watch')
      }

      setDone(true)
      setTimeout(() => { setOpen(false); setDone(false) }, 1500)
    } catch (e: any) {
      setError(e.message ?? 'Failed')
    } finally {
      setSaving(false)
    }
  }

  function handleClose() {
    setOpen(false); setError(''); setDone(false)
    setQty(''); setFees(''); setType('buy')
    setPriceVal(price ? price.toFixed(2) : '')
    setDate(new Date().toISOString().split('T')[0])
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          padding: '0.4rem 1rem',
          background: 'rgba(78,255,145,0.08)',
          border: '1px solid rgba(78,255,145,0.25)',
          color: 'var(--green)',
          borderRadius: 6, cursor: 'pointer',
          fontSize: '0.78rem', fontWeight: 600,
          display: 'flex', alignItems: 'center', gap: '0.4rem',
        }}
      >
        + Add Holding
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div onClick={handleClose}
            style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.6)' }} />

          {/* Modal */}
          <div style={{
            position: 'fixed', top: '50%', left: '50%',
            transform: 'translate(-50%,-50%)',
            zIndex: 301, background: 'var(--navy2)',
            border: '1px solid var(--dash-border)',
            borderRadius: 8, padding: '1.4rem', width: 380,
            boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <div>
                <div style={{ fontSize: '0.6rem', color: 'rgba(232,226,217,0.40)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>
                  Add Holding
                </div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--gold)', fontFamily: 'var(--font-mono)' }}>{ticker}</div>
                {name && <div style={{ fontSize: '0.68rem', color: 'rgba(232,226,217,0.40)', marginTop: 1 }}>{name}</div>}
              </div>
              <button onClick={handleClose}
                style={{ background: 'none', border: 'none', color: 'rgba(232,226,217,0.35)', cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1 }}>×</button>
            </div>

            {done ? (
              <div style={{ textAlign: 'center', padding: '1.5rem 0', color: '#4eca99', fontSize: '0.88rem', fontWeight: 600 }}>
                ✓ {type === 'buy' ? 'Buy recorded' : 'Added to portfolio'}
              </div>
            ) : (
              <>
                {/* Portfolio selector */}
                <div style={{ marginBottom: '0.8rem' }}>
                  <div style={labelStyle}>Portfolio</div>
                  {portfolios.length === 0 ? (
                    <div style={{ fontSize: '0.75rem', color: 'rgba(232,226,217,0.35)' }}>No portfolios found — create one first</div>
                  ) : (
                    <select value={portfolioId} onChange={e => setPortfolioId(e.target.value)}
                      style={{ ...inputStyle, cursor: 'pointer' }}>
                      {portfolios.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Buy / Watch toggle */}
                <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.9rem' }}>
                  {(['buy', 'watch'] as const).map(t => (
                    <button key={t} onClick={() => { setType(t); setError('') }}
                      style={{
                        flex: 1, padding: '0.4rem',
                        border: `1px solid ${type === t ? (t === 'buy' ? 'rgba(78,255,145,0.4)' : 'rgba(240,180,41,0.4)') : 'rgba(255,255,255,0.08)'}`,
                        background: type === t ? (t === 'buy' ? 'rgba(78,255,145,0.08)' : 'rgba(240,180,41,0.08)') : 'none',
                        color: type === t ? (t === 'buy' ? 'var(--green)' : '#f0b429') : 'rgba(232,226,217,0.40)',
                        borderRadius: 5, cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600,
                        textTransform: 'uppercase', letterSpacing: '0.06em',
                      }}>
                      {t === 'buy' ? '↑ Buy' : '◎ Watch'}
                    </button>
                  ))}
                </div>

                {type === 'buy' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', marginBottom: '0.9rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                      <div>
                        <div style={labelStyle}>Quantity</div>
                        <input value={qty} onChange={e => setQty(e.target.value)} type="number" placeholder="100" style={inputStyle} />
                      </div>
                      <div>
                        <div style={labelStyle}>Price ($)</div>
                        <input value={priceVal} onChange={e => setPriceVal(e.target.value)} type="number" placeholder="0.00" style={inputStyle} />
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                      <div>
                        <div style={labelStyle}>Date</div>
                        <input value={date} onChange={e => setDate(e.target.value)} type="date" style={inputStyle} />
                      </div>
                      <div>
                        <div style={labelStyle}>Fees ($)</div>
                        <input value={fees} onChange={e => setFees(e.target.value)} type="number" placeholder="0.00" style={inputStyle} />
                      </div>
                    </div>
                    {qty && priceVal && (
                      <div style={{ fontSize: '0.72rem', color: 'rgba(232,226,217,0.45)', padding: '0.4rem 0.65rem', background: 'rgba(255,255,255,0.03)', borderRadius: 5, border: '1px solid rgba(255,255,255,0.06)' }}>
                        Total: <strong style={{ color: 'var(--cream)' }}>
                          ${(parseFloat(qty || '0') * parseFloat(priceVal || '0') + parseFloat(fees || '0')).toFixed(2)}
                        </strong>
                      </div>
                    )}
                  </div>
                )}

                {type === 'watch' && (
                  <div style={{ fontSize: '0.72rem', color: 'rgba(232,226,217,0.40)', marginBottom: '0.9rem', padding: '0.5rem 0.65rem', background: 'rgba(255,255,255,0.02)', borderRadius: 5, border: '1px solid rgba(255,255,255,0.05)' }}>
                    Adds {ticker} as a draft holding to monitor. Record a buy transaction when you're ready to invest.
                  </div>
                )}

                {error && <div style={{ fontSize: '0.72rem', color: '#fc5c65', marginBottom: '0.7rem' }}>{error}</div>}

                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                  <button onClick={handleClose}
                    style={{ padding: '0.45rem 1rem', background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(232,226,217,0.40)', borderRadius: 6, cursor: 'pointer', fontSize: '0.78rem' }}>
                    Cancel
                  </button>
                  <button onClick={handleSubmit} disabled={saving || portfolios.length === 0}
                    style={{
                      padding: '0.45rem 1.1rem',
                      background: type === 'buy' ? 'rgba(78,255,145,0.12)' : 'rgba(240,180,41,0.1)',
                      border: `1px solid ${type === 'buy' ? 'rgba(78,255,145,0.35)' : 'rgba(240,180,41,0.3)'}`,
                      color: type === 'buy' ? 'var(--green)' : '#f0b429',
                      fontWeight: 700, borderRadius: 6,
                      cursor: saving || portfolios.length === 0 ? 'not-allowed' : 'pointer',
                      fontSize: '0.78rem', opacity: saving ? 0.6 : 1,
                    }}>
                    {saving ? '…' : type === 'buy' ? 'Record Buy' : 'Add to Watch'}
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
