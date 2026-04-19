'use client'
// src/components/dashboard/AddHoldingButton.tsx
//
// Records a buy transaction. Used from the portfolio page Holdings tab.
// Shows: portfolio selector (optional), ticker search (optional), qty, price, date, fees.

import { useState, useEffect, useRef } from 'react'

interface Portfolio  { id: string; name: string }
interface AssetMatch { ticker: string; name: string; asset_type: string }

interface Props {
  portfolioId?: string    // pre-selected — hides portfolio selector
  ticker?:      string    // pre-filled  — hides ticker search
  name?:        string
  price?:       number | null
  onDone?:      () => void
  label?:       string
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

function TickerSearch({ value, onChange, onSelect }: {
  value: string; onChange: (v: string) => void; onSelect: (a: AssetMatch) => void
}) {
  const [results, setResults] = useState<AssetMatch[]>([])
  const [open,    setOpen]    = useState(false)
  const debounce  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapRef   = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    if (!value.trim()) { setResults([]); setOpen(false); return }
    debounce.current = setTimeout(async () => {
      try {
        const res  = await fetch(`/api/assets/search?q=${encodeURIComponent(value)}&limit=6`)
        const data = await res.json()
        setResults(data.assets ?? [])
        setOpen((data.assets ?? []).length > 0)
      } catch {}
    }, 200)
  }, [value])

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={labelStyle}>Ticker</div>
      <input value={value} onChange={e => onChange(e.target.value.toUpperCase())}
        placeholder="Search AAPL, MSFT…" autoComplete="off" style={inputStyle} />
      {open && results.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: 'var(--navy2)', border: '1px solid var(--dash-border)', borderRadius: 6, marginTop: 2, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
          {results.map(a => (
            <div key={a.ticker} onMouseDown={() => { onSelect(a); setOpen(false) }}
              style={{ padding: '0.5rem 0.75rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.6rem', borderBottom: '1px solid rgba(255,255,255,0.04)', background: 'transparent' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              <span style={{ fontWeight: 700, color: 'var(--gold)', fontFamily: 'monospace', minWidth: 52 }}>{a.ticker}</span>
              <span style={{ fontSize: '0.75rem', color: 'rgba(232,226,217,0.55)', flex: 1 }}>{a.name}</span>
              <span style={{ fontSize: '0.6rem', color: 'rgba(232,226,217,0.35)', textTransform: 'uppercase' }}>{a.asset_type}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function AddHoldingButton({
  portfolioId: propPortfolioId, ticker: propTicker,
  name: propName, price: propPrice, onDone, label,
}: Props) {
  const [open,        setOpen]        = useState(false)
  const [portfolios,  setPortfolios]  = useState<Portfolio[]>([])
  const [portfolioId, setPortfolioId] = useState(propPortfolioId ?? '')
  const [ticker,      setTicker]      = useState(propTicker ?? '')
  const [qty,         setQty]         = useState('')
  const [priceVal,    setPriceVal]    = useState(propPrice ? propPrice.toFixed(2) : '')
  const [date,        setDate]        = useState(new Date().toISOString().split('T')[0])
  const [fees,        setFees]        = useState('')
  const [saving,      setSaving]      = useState(false)
  const [done,        setDone]        = useState(false)
  const [error,       setError]       = useState('')

  // Load portfolios when modal opens (only if not pre-selected)
  useEffect(() => {
    if (!open || propPortfolioId) return
    fetch('/api/portfolio')
      .then(r => r.json())
      .then(d => {
        const all: Portfolio[] = d.portfolios ?? (d.portfolio ? [d.portfolio] : [])
        setPortfolios(all)
        if (all.length && !portfolioId) setPortfolioId(all[0].id)
      })
      .catch(() => {})
  }, [open])

  function reset() {
    setQty(''); setFees(''); setError('')
    if (!propTicker) setTicker('')
    if (!propPrice)  setPriceVal('')
    setDate(new Date().toISOString().split('T')[0])
  }

  function handleClose() { setOpen(false); setDone(false); reset() }

  async function handleSubmit() {
    if (!portfolioId)    { setError('Select a portfolio'); return }
    if (!ticker.trim())  { setError('Enter a ticker');     return }
    const qtyNum   = parseFloat(qty)
    const priceNum = parseFloat(priceVal)
    if (isNaN(qtyNum)   || qtyNum   <= 0) { setError('Enter a valid quantity'); return }
    if (isNaN(priceNum) || priceNum <= 0) { setError('Enter a valid price');    return }

    setSaving(true); setError('')
    try {
      const res = await fetch('/api/portfolio/transaction', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portfolio_id: portfolioId,
          ticker:       ticker.trim().toUpperCase(),
          type:         'buy',
          quantity:     qtyNum,
          price:        priceNum,
          fees:         parseFloat(fees) || 0,
          executed_at:  new Date(date).toISOString(),
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Failed')
      setDone(true)
      setTimeout(() => { handleClose(); onDone?.() }, 1500)
    } catch (e: any) {
      setError(e.message ?? 'Failed')
    } finally {
      setSaving(false)
    }
  }

  const total = parseFloat(qty || '0') * parseFloat(priceVal || '0') + parseFloat(fees || '0')

  return (
    <>
      <button onClick={() => setOpen(true)} style={{
        padding: '0.4rem 1rem',
        background: 'rgba(78,255,145,0.08)', border: '1px solid rgba(78,255,145,0.25)',
        color: 'var(--green)', borderRadius: 6, cursor: 'pointer',
        fontSize: '0.78rem', fontWeight: 600,
        display: 'flex', alignItems: 'center', gap: '0.4rem',
      }}>
        {label ?? '+ Add Holding'}
      </button>

      {open && (
        <>
          <div onClick={handleClose} style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.6)' }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            zIndex: 301, background: 'var(--navy2)', border: '1px solid var(--dash-border)',
            borderRadius: 8, padding: '1.4rem', width: 400,
            boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.1rem' }}>
              <div>
                <div style={{ fontSize: '0.6rem', color: 'rgba(232,226,217,0.40)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>
                  Add Holding
                </div>
                {propTicker ? (
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>
                    {propTicker} {propName && <span style={{ fontSize: '0.68rem', color: 'rgba(232,226,217,0.40)', fontFamily: 'sans-serif', fontWeight: 400 }}>{propName}</span>}
                  </div>
                ) : (
                  <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--cream)' }}>Record a buy transaction</div>
                )}
              </div>
              <button onClick={handleClose} style={{ background: 'none', border: 'none', color: 'rgba(232,226,217,0.35)', cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1 }}>×</button>
            </div>

            {done ? (
              <div style={{ textAlign: 'center', padding: '1.5rem 0', color: '#4eca99', fontSize: '0.88rem', fontWeight: 600 }}>
                ✓ Holding added
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem', marginBottom: '0.9rem' }}>

                  {/* Portfolio selector */}
                  {!propPortfolioId && (
                    <div>
                      <div style={labelStyle}>Portfolio</div>
                      {portfolios.length === 0
                        ? <div style={{ fontSize: '0.75rem', color: 'rgba(232,226,217,0.35)' }}>No portfolios — create one first</div>
                        : <select value={portfolioId} onChange={e => setPortfolioId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                            {portfolios.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                      }
                    </div>
                  )}

                  {/* Ticker search */}
                  {!propTicker && (
                    <TickerSearch value={ticker} onChange={setTicker} onSelect={a => setTicker(a.ticker)} />
                  )}

                  {/* Qty + Price */}
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

                  {/* Date + Fees */}
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
                      Total: <strong style={{ color: 'var(--cream)' }}>${total.toFixed(2)}</strong>
                    </div>
                  )}
                </div>

                {error && <div style={{ fontSize: '0.72rem', color: '#fc5c65', marginBottom: '0.7rem' }}>{error}</div>}

                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                  <button onClick={handleClose} style={{ padding: '0.45rem 1rem', background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(232,226,217,0.40)', borderRadius: 6, cursor: 'pointer', fontSize: '0.78rem' }}>
                    Cancel
                  </button>
                  <button onClick={handleSubmit} disabled={saving} style={{
                    padding: '0.45rem 1.1rem',
                    background: 'rgba(78,255,145,0.12)', border: '1px solid rgba(78,255,145,0.35)',
                    color: 'var(--green)', fontWeight: 700, borderRadius: 6,
                    cursor: saving ? 'not-allowed' : 'pointer',
                    fontSize: '0.78rem', opacity: saving ? 0.6 : 1,
                  }}>
                    {saving ? '…' : 'Record Buy'}
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
