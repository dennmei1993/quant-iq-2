'use client'
// src/components/ConditionalOrderModal.tsx
// Create a conditional order that executes when market conditions are met

import { useState } from 'react'

interface Props {
  ticker:      string
  currentPrice: number
  onClose:     () => void
  onCreated:   () => void
}

export default function ConditionalOrderModal({ ticker, currentPrice, onClose, onCreated }: Props) {
  const [side,          setSide]          = useState<'BUY'|'SELL'>('BUY')
  const [qty,           setQty]           = useState('1')
  const [orderType,     setOrderType]     = useState<'LIMIT'|'MARKET'>('LIMIT')
  const [limitPrice,    setLimitPrice]    = useState('')
  const [priceAbove,    setPriceAbove]    = useState('')
  const [priceBelow,    setPriceBelow]    = useState('')
  const [notBeforeTime, setNotBeforeTime] = useState('10:00')
  const [expiresIn,     setExpiresIn]     = useState('1d')
  const [notes,         setNotes]         = useState('')
  const [saving,        setSaving]        = useState(false)
  const [error,         setError]         = useState('')

  const expiresAt = (() => {
    const d = new Date()
    if (expiresIn === '1d') d.setDate(d.getDate() + 1)
    else if (expiresIn === '3d') d.setDate(d.getDate() + 3)
    else if (expiresIn === '1w') d.setDate(d.getDate() + 7)
    else if (expiresIn === '1m') d.setMonth(d.getMonth() + 1)
    else return null
    return d.toISOString()
  })()

  async function create() {
    if (!qty || parseInt(qty) < 1) { setError('Enter valid quantity'); return }
    if (orderType === 'LIMIT' && !limitPrice) { setError('Enter limit price'); return }
    if (!priceAbove && !priceBelow) { setError('Set at least one price condition'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/orders/conditional', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker,
          side,
          qty:             parseInt(qty),
          order_type:      orderType,
          limit_price:     limitPrice ? parseFloat(limitPrice) : null,
          price_above:     priceAbove ? parseFloat(priceAbove) : null,
          price_below:     priceBelow ? parseFloat(priceBelow) : null,
          not_before_time: notBeforeTime,
          expires_at:      expiresAt,
          notes:           notes || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to create'); return }
      onCreated(); onClose()
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  const inSt: React.CSSProperties = {
    padding: '5px 8px', background: 'var(--bg-subtle)', border: '1px solid var(--border)',
    borderRadius: 'var(--r-md)', color: 'var(--text)', fontSize: 'var(--fs-sm)',
    fontFamily: 'inherit', width: '100%', outline: 'none', boxSizing: 'border-box',
  }
  const lbSt: React.CSSProperties = {
    fontSize: 9, fontWeight: 500, color: 'var(--text-4)', textTransform: 'uppercase',
    letterSpacing: '0.07em', display: 'block', marginBottom: 3,
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.5)' }} />
      <div onClick={e => e.stopPropagation()} style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 401, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '1.2rem', width: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', maxHeight: '90vh', overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
              Conditional Order
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 600 }}>{ticker}</div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', marginTop: 1 }}>
              Current price: ${currentPrice.toFixed(2)} · Monitors every minute during market hours
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: '1.2rem' }}>×</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Side */}
          <div style={{ display: 'flex', gap: 4 }}>
            {(['BUY','SELL'] as const).map(s => (
              <button key={s} onClick={() => setSide(s)} style={{ flex: 1, padding: '5px', borderRadius: 'var(--r-md)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 'var(--fs-sm)', background: side === s ? (s === 'BUY' ? 'rgba(21,128,61,0.1)' : 'rgba(185,28,28,0.1)') : 'none', border: `1px solid ${side === s ? (s === 'BUY' ? 'rgba(21,128,61,0.4)' : 'rgba(185,28,28,0.4)') : 'var(--border)'}`, color: side === s ? (s === 'BUY' ? 'var(--signal-bull)' : 'var(--signal-bear)') : 'var(--text-4)' }}>
                {s}
              </button>
            ))}
          </div>

          {/* Qty + Order type */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={lbSt}>Quantity</label>
              <input value={qty} onChange={e => setQty(e.target.value)} type="number" min="1" style={inSt} />
            </div>
            <div>
              <label style={lbSt}>Order type</label>
              <select value={orderType} onChange={e => setOrderType(e.target.value as any)} style={inSt}>
                <option value="LIMIT">Limit</option>
                <option value="MARKET">Market</option>
              </select>
            </div>
          </div>

          {/* Limit price */}
          {orderType === 'LIMIT' && (
            <div>
              <label style={lbSt}>Limit price ($)</label>
              <input value={limitPrice} onChange={e => setLimitPrice(e.target.value)} type="number" step="0.01" placeholder={currentPrice.toFixed(2)} style={inSt} />
            </div>
          )}

          {/* Divider */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 500, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              Execute when ALL conditions are met
            </div>

            {/* Price conditions */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <div>
                <label style={lbSt}>Price rises above ($)</label>
                <input value={priceAbove} onChange={e => setPriceAbove(e.target.value)} type="number" step="0.01" placeholder="Optional" style={inSt} />
              </div>
              <div>
                <label style={lbSt}>Price drops below ($)</label>
                <input value={priceBelow} onChange={e => setPriceBelow(e.target.value)} type="number" step="0.01" placeholder="Optional" style={inSt} />
              </div>
            </div>

            {/* Time gate */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={lbSt}>Not before (ET time)</label>
                <select value={notBeforeTime} onChange={e => setNotBeforeTime(e.target.value)} style={inSt}>
                  <option value="09:30">09:30 (market open)</option>
                  <option value="10:00">10:00 (30 min after open)</option>
                  <option value="10:30">10:30 (1 hr after open)</option>
                  <option value="11:00">11:00</option>
                  <option value="12:00">12:00 (noon)</option>
                  <option value="14:00">14:00</option>
                  <option value="15:00">15:00 (1 hr before close)</option>
                  <option value="15:30">15:30 (30 min before close)</option>
                </select>
              </div>
              <div>
                <label style={lbSt}>Expires in</label>
                <select value={expiresIn} onChange={e => setExpiresIn(e.target.value)} style={inSt}>
                  <option value="1d">1 day</option>
                  <option value="3d">3 days</option>
                  <option value="1w">1 week</option>
                  <option value="1m">1 month</option>
                  <option value="never">Never</option>
                </select>
              </div>
            </div>
          </div>

          {/* Summary */}
          <div style={{ padding: '8px 10px', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', fontSize: 'var(--fs-xs)', color: 'var(--text-3)', lineHeight: 1.7 }}>
            <strong style={{ color: 'var(--text)' }}>Summary: </strong>
            {side} {qty} {ticker} {orderType === 'LIMIT' ? `@ $${limitPrice || '?'}` : 'at market'}
            {priceBelow ? ` when price drops below $${priceBelow}` : ''}
            {priceAbove ? ` when price rises above $${priceAbove}` : ''}
            {` · not before ${notBeforeTime} ET`}
            {expiresIn !== 'never' ? ` · expires in ${expiresIn}` : ''}
          </div>

          {/* Notes */}
          <div>
            <label style={lbSt}>Notes (optional)</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Buy the dip after earnings" style={inSt} />
          </div>

          {error && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--signal-bear)', padding: '6px 8px', background: 'rgba(185,28,28,0.05)', border: '1px solid rgba(185,28,28,0.15)', borderRadius: 'var(--r-md)' }}>{error}</div>}

          <button onClick={create} disabled={saving}
            style={{ padding: '7px', fontWeight: 600, fontFamily: 'inherit', fontSize: 'var(--fs-sm)', borderRadius: 'var(--r-md)', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.5 : 1, background: side === 'BUY' ? 'rgba(21,128,61,0.1)' : 'rgba(185,28,28,0.1)', border: `1px solid ${side === 'BUY' ? 'rgba(21,128,61,0.35)' : 'rgba(185,28,28,0.35)'}`, color: side === 'BUY' ? 'var(--signal-bull)' : 'var(--signal-bear)' }}>
            {saving ? 'Creating…' : `Create conditional ${side} order`}
          </button>
        </div>
      </div>
    </>
  )
}
