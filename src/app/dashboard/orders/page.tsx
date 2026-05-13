'use client'
// src/app/dashboard/orders/page.tsx
// Live order management — open orders, history, place/cancel.
// Talks to the broker bridge via /api/broker/*.

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

// ── Types ─────────────────────────────────────────────────────────────────────

interface BrokerStatus {
  connected:       boolean
  mode:            string
  auto_trading:    boolean
  cash:            number | null
  portfolio_value: number | null
  open_orders:     number | null
  uptime_seconds:  number | null
}

interface Order {
  order_id:    string
  symbol:      string
  side:        string
  order_type:  string
  qty:         number
  limit_price: number | null
  stop_price:  number | null
  status:      string
  fill_price:  number | null
  fill_time:   string | null
  created_at:  string
  commission:  number
  slippage:    number
  notes:       string
}

interface Position {
  symbol:           string
  qty:              number
  avg_cost:         number
  market_price:     number
  market_value:     number
  cost_basis:       number
  unrealised_pnl:   number
  'unrealised_pnl%': number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number) => `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
const signCol = (n: number) => n >= 0 ? 'var(--signal-bull)' : 'var(--signal-bear)'

const STATUS_COLOR: Record<string, string> = {
  PENDING:   'var(--signal-neut)',
  FILLED:    'var(--signal-bull)',
  CANCELLED: 'var(--text-4)',
  REJECTED:  'var(--signal-bear)',
  FILLING:   'var(--signal-neut)',
}

const SIDE_COLOR: Record<string, string> = {
  BUY:  'var(--signal-bull)',
  SELL: 'var(--signal-bear)',
}

const ls: React.CSSProperties = {
  fontSize: '8.5px', fontWeight: 500, color: 'var(--text-4)',
  textTransform: 'uppercase', letterSpacing: '0.07em', display: 'block', marginBottom: 4,
}

const inputSt: React.CSSProperties = {
  padding: '5px 8px', background: 'var(--bg-subtle)',
  border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
  color: 'var(--text)', fontSize: 'var(--fs-sm)', outline: 'none',
  fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
}

// ── Place order modal ─────────────────────────────────────────────────────────

function PlaceOrderModal({ cash, onClose, onPlaced }: {
  cash:     number
  onClose:  () => void
  onPlaced: () => void
}) {
  const [symbol,     setSymbol]     = useState('')
  const [side,       setSide]       = useState<'BUY' | 'SELL'>('BUY')
  const [orderType,  setOrderType]  = useState<'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT'>('MARKET')
  const [qty,        setQty]        = useState('')
  const [limitPrice, setLimitPrice] = useState('')
  const [stopPrice,  setStopPrice]  = useState('')
  const [notes,      setNotes]      = useState('')
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState('')
  const [preview,    setPreview]    = useState<any>(null)
  const [previewing, setPreviewing] = useState(false)

  async function fetchPreview() {
    if (!symbol || !qty) return
    setPreviewing(true)
    try {
      const res  = await fetch(
        `/api/broker/auto/execute-recommendation?symbol=US.${symbol.toUpperCase()}&side=${side}&qty=${qty}&order_type=${orderType}${limitPrice ? `&limit_price=${limitPrice}` : ''}`
      )
      const data = await res.json()
      setPreview(data)
    } catch {}
    finally { setPreviewing(false) }
  }

  async function handlePlace() {
    if (!symbol || !qty) { setError('Symbol and quantity required'); return }
    setSaving(true); setError('')
    try {
      const body: any = {
        symbol:     `US.${symbol.toUpperCase()}`,
        side,
        qty:        parseInt(qty),
        order_type: orderType,
      }
      if (limitPrice) body.limit_price = parseFloat(limitPrice)
      if (stopPrice)  body.stop_price  = parseFloat(stopPrice)
      if (notes)      body.notes       = notes

      // Send to real Moomoo account
      const res  = await fetch('/api/broker/orders/moomoo', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.detail ?? 'Failed'); setSaving(false); return }
      onPlaced()
      onClose()
    } catch (e: any) {
      setError(e.message)
      setSaving(false)
    }
  }

  const needsLimit = orderType === 'LIMIT' || orderType === 'STOP_LIMIT'
  const needsStop  = orderType === 'STOP'  || orderType === 'STOP_LIMIT'

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.4)' }} />
      <div onClick={e => e.stopPropagation()} style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        zIndex: 201, background: 'var(--bg)', border: '1px solid var(--border)',
        borderRadius: 8, padding: '1.4rem', width: 400,
        boxShadow: '0 16px 48px rgba(0,0,0,0.15)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div>
            <div style={{ ...ls, marginBottom: 2 }}>Place order</div>
            <div style={{ fontSize: 'var(--fs-heading)', fontWeight: 500, color: 'var(--text)' }}>Simulated broker</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* Symbol */}
          <div>
            <label style={ls}>Ticker (US market)</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-4)', fontWeight: 500 }}>US.</span>
              <input value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())}
                placeholder="AAPL" style={{ ...inputSt, flex: 1 }} onBlur={fetchPreview} />
            </div>
          </div>

          {/* Side + Order type */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={ls}>Side</label>
              <div style={{ display: 'flex', gap: 4 }}>
                {(['BUY', 'SELL'] as const).map(s => (
                  <button key={s} onClick={() => setSide(s)} style={{
                    flex: 1, padding: '5px 0', borderRadius: 'var(--r-md)', cursor: 'pointer',
                    background: side === s ? (s === 'BUY' ? 'rgba(21,128,61,0.1)' : 'rgba(185,28,28,0.1)') : 'none',
                    border: `1px solid ${side === s ? (s === 'BUY' ? 'rgba(21,128,61,0.4)' : 'rgba(185,28,28,0.4)') : 'var(--border)'}`,
                    color: side === s ? SIDE_COLOR[s] : 'var(--text-4)',
                    fontSize: 'var(--fs-sm)', fontWeight: 600, fontFamily: 'inherit',
                  }}>{s}</button>
                ))}
              </div>
            </div>
            <div>
              <label style={ls}>Order type</label>
              <select value={orderType} onChange={e => setOrderType(e.target.value as any)}
                style={{ ...inputSt }}>
                <option value="MARKET">Market</option>
                <option value="LIMIT">Limit</option>
                <option value="STOP">Stop</option>
                <option value="STOP_LIMIT">Stop-Limit</option>
              </select>
            </div>
          </div>

          {/* Qty */}
          <div>
            <label style={ls}>Quantity (shares)</label>
            <input value={qty} onChange={e => setQty(e.target.value)} type="number"
              placeholder="10" style={inputSt} onBlur={fetchPreview} />
          </div>

          {/* Conditional price fields */}
          {(needsLimit || needsStop) && (
            <div style={{ display: 'grid', gridTemplateColumns: needsLimit && needsStop ? '1fr 1fr' : '1fr', gap: 8 }}>
              {needsLimit && (
                <div>
                  <label style={ls}>Limit price ($)</label>
                  <input value={limitPrice} onChange={e => setLimitPrice(e.target.value)} type="number"
                    placeholder="0.00" style={inputSt} />
                </div>
              )}
              {needsStop && (
                <div>
                  <label style={ls}>Stop price ($)</label>
                  <input value={stopPrice} onChange={e => setStopPrice(e.target.value)} type="number"
                    placeholder="0.00" style={inputSt} />
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          <div>
            <label style={ls}>Notes (optional)</label>
            <input value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Breakout play" style={inputSt} />
          </div>

          {/* Preview */}
          {preview && (
            <div style={{ padding: '8px 10px', background: 'var(--bg-subtle)', border: `1px solid ${preview.allowed ? 'var(--border)' : 'rgba(185,28,28,0.3)'}`, borderRadius: 'var(--r-md)', fontSize: 'var(--fs-sm)' }}>
              {preview.allowed ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-3)' }}>Est. fill</span>
                    <strong>{preview.estimated_fill_price ? `$${preview.estimated_fill_price.toFixed(2)}` : '—'}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-3)' }}>Est. total</span>
                    <strong>{preview.estimated_total ? fmt(preview.estimated_total) : '—'}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-3)' }}>Cash available</span>
                    <strong>{preview.cash_available ? fmt(preview.cash_available) : '—'}</strong>
                  </div>
                  {!preview.market_open && <div style={{ color: 'var(--signal-neut)', fontSize: 'var(--fs-xs)' }}>⚠ Market is currently closed</div>}
                </div>
              ) : (
                <div style={{ color: 'var(--signal-bear)' }}>🛡 {preview.blocked_reason}</div>
              )}
            </div>
          )}

          {error && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--signal-bear)' }}>{error}</div>}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button onClick={fetchPreview} disabled={previewing || !symbol || !qty}
              style={{ padding: '5px 12px', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-3)', fontSize: 'var(--fs-sm)', cursor: 'pointer', fontFamily: 'inherit', opacity: !symbol || !qty ? 0.4 : 1 }}>
              {previewing ? '…' : 'Preview'}
            </button>
            <button onClick={handlePlace} disabled={saving || !symbol || !qty}
              style={{
                flex: 1, padding: '5px 12px', fontWeight: 600, fontFamily: 'inherit',
                borderRadius: 'var(--r-md)', fontSize: 'var(--fs-sm)',
                cursor: saving || !symbol || !qty ? 'not-allowed' : 'pointer',
                opacity: saving || !symbol || !qty ? 0.5 : 1,
                background: side === 'BUY' ? 'rgba(21,128,61,0.1)' : 'rgba(185,28,28,0.1)',
                border: `1px solid ${side === 'BUY' ? 'rgba(21,128,61,0.35)' : 'rgba(185,28,28,0.35)'}`,
                color: side === 'BUY' ? 'var(--signal-bull)' : 'var(--signal-bear)',
              }}>
              {saving ? '…' : `Place ${side} order`}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function OrdersPage() {
  const router = useRouter()

  const [status,    setStatus]    = useState<BrokerStatus | null>(null)
  const [orders,    setOrders]    = useState<Order[]>([])
  const [positions, setPositions] = useState<Position[]>([])
  const [tab,       setTab]       = useState<'open' | 'history' | 'positions'>('open')
  const [loading,   setLoading]   = useState(true)
  const [orderModal,setOrderModal] = useState(false)
  const [cancelling,setCancelling] = useState<string | null>(null)
  const [toggling,  setToggling]  = useState(false)
  const [isLocal,   setIsLocal]   = useState(false)
  const [useMoomoo, setUseMoomoo]  = useState(true)  // true = real account, false = simulator

  const load = useCallback(async () => {
    // Never call broker on Vercel — bridge only runs locally
    if (typeof window !== 'undefined') {
      const h = window.location.hostname
      const local = h === 'localhost' || h === '127.0.0.1'
      setIsLocal(local)
      if (!local) {
        setStatus(null)
        setLoading(false)
        return
      }
    }
    try {
      // Check status first — if bridge is offline (503) skip other calls
      const statusRes = await fetch('/api/broker/status', { signal: AbortSignal.timeout(4000) })
      if (!statusRes.ok) {
        setStatus(null)
        setLoading(false)
        return
      }
      const statusData = await statusRes.json()
      if (statusData.error) { setStatus(null); setLoading(false); return }
      setStatus(statusData)

      // Bridge is online — fetch from real account + simulator
      const [moomooOrdersRes, simOrdersRes, posRes] = await Promise.all([
        fetch('/api/broker/orders/moomoo'),   // real Moomoo account
        fetch('/api/broker/orders'),           // simulator
        fetch('/api/broker/account/positions'), // real positions
      ])
      if (moomooOrdersRes.ok) {
        const d = await moomooOrdersRes.json()
        // Normalise Moomoo order shape to match simulator shape
        const moomooOrders = (d.orders ?? []).map((o: any) => ({
          order_id:   o.order_id   ?? o.orderid ?? '',
          symbol:     o.code       ?? o.symbol  ?? '',
          side:       o.trd_side   ?? o.side     ?? '',
          order_type: o.order_type ?? 'LIMIT',
          qty:        parseInt(o.qty ?? o.quantity ?? 0),
          limit_price:parseFloat(o.price ?? 0) || null,
          stop_price: null,
          status:     o.order_status ?? o.status ?? '',
          fill_price: parseFloat(o.dealt_avg_price ?? 0) || null,
          fill_time:  o.updated_time ?? null,
          created_at: o.create_time  ?? new Date().toISOString(),
          commission: 0,
          slippage:   0,
          notes:      o.remark ?? '',
          source:     'moomoo',
        }))
        setOrders(moomooOrders)
      }
      if (simOrdersRes.ok) {
        // Merge simulator orders (tagged with source)
        // const d = await simOrdersRes.json()
        // setSimOrders(d.orders ?? [])
      }
      if (posRes.ok) { const d = await posRes.json(); setPositions(d.positions ?? []) }
    } catch {
      setStatus(null)
    }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, 10_000) // refresh every 10s
    return () => clearInterval(interval)
  }, [load])

  async function cancelOrder(orderId: string, source = 'moomoo') {
    setCancelling(orderId)
    try {
      const endpoint = source === 'moomoo'
        ? `/api/broker/orders/moomoo/${orderId}`
        : `/api/broker/orders/${orderId}`
      await fetch(endpoint, { method: 'DELETE' })
      await load()
    } catch {}
    finally { setCancelling(null) }
  }

  async function toggleAutoTrading() {
    if (!status) return
    setToggling(true)
    try {
      const endpoint = status.auto_trading ? '/api/broker/auto/disable' : '/api/broker/auto/enable'
      await fetch(endpoint, { method: 'POST' })
      await load()
    } catch {}
    finally { setToggling(false) }
  }

  const openOrders    = orders.filter(o => o.status === 'PENDING')
  const filledOrders  = orders.filter(o => o.status === 'FILLED')
  const otherOrders   = orders.filter(o => !['PENDING','FILLED'].includes(o.status))
  const totalPnl      = positions.reduce((s, p) => s + p.unrealised_pnl, 0)

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!isLocal && !loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
        <div className="page-header">
          <div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Broker</div>
            <div className="page-title">Orders</div>
          </div>
        </div>
        <div style={{ padding: '20px', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', background: 'var(--bg-subtle)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 500, color: 'var(--text)' }}>Broker bridge not available on this device</div>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-3)', lineHeight: 1.6 }}>
            The broker bridge runs locally alongside OpenD on your trading machine.
          </div>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-3)', lineHeight: 1.6 }}>
            To access Orders:
          </div>
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 'var(--fs-sm)', color: 'var(--text-3)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <li>Start OpenD on your Windows machine</li>
            <li>Run <code style={{ background: 'var(--bg)', padding: '1px 5px', borderRadius: 3, fontSize: 'var(--fs-xs)', border: '1px solid var(--border)' }}>python broker_service.py</code></li>
            <li>Visit <strong>localhost:3000/dashboard/orders</strong></li>
          </ol>
        </div>
      </div>
    )
  }

  if (loading) {
    return <div style={{ color: 'var(--text-4)', fontSize: 'var(--fs-sm)', padding: '2rem 0' }}>Loading…</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>

      {/* Page header */}
      <div className="page-header">
        <div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Broker</div>
          <div className="page-title">Orders</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {status?.connected && (
            <button
              onClick={toggleAutoTrading}
              disabled={toggling}
              style={{
                padding: '4px 12px', borderRadius: 'var(--r-pill)', cursor: 'pointer',
                fontSize: 'var(--fs-sm)', fontWeight: 500, fontFamily: 'inherit',
                background: status.auto_trading ? 'rgba(21,128,61,0.1)' : 'var(--bg)',
                border: `1px solid ${status.auto_trading ? 'rgba(21,128,61,0.35)' : 'var(--border)'}`,
                color: status.auto_trading ? 'var(--signal-bull)' : 'var(--text-3)',
                opacity: toggling ? 0.5 : 1,
              }}
            >
              {status.auto_trading ? '⚡ Auto-trading ON' : 'Auto-trading OFF'}
            </button>
          )}
          <button
            className="btn btn-dark"
            onClick={() => setOrderModal(true)}
            disabled={!status?.connected}
            style={{ opacity: !status?.connected ? 0.4 : 1 }}
          >
            <i className="ti ti-plus" aria-hidden /> Place order
          </button>
        </div>
      </div>

      {/* Broker status card */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
        {[
          { label: 'Status', value: status?.connected ? `${status.mode} ●` : 'Offline', col: status?.connected ? 'var(--signal-bull)' : 'var(--text-4)' },
          { label: 'Cash', value: status?.cash != null ? fmt(status.cash) : '—', col: 'var(--color-info)' },
          { label: 'Portfolio value', value: status?.portfolio_value != null ? fmt(status.portfolio_value) : '—', col: 'var(--text)' },
          { label: 'Unrealised P&L', value: positions.length ? `${totalPnl >= 0 ? '+' : ''}${fmt(totalPnl)}` : '—', col: positions.length ? signCol(totalPnl) : 'var(--text-4)' },
        ].map((m, i) => (
          <div key={i} style={{ padding: '8px 14px', borderLeft: i > 0 ? '1px solid var(--border)' : 'none', background: 'var(--bg)' }}>
            <div className="metric-label">{m.label}</div>
            <div style={{ fontSize: 'var(--fs-metric)', fontWeight: 500, color: m.col, marginTop: 2 }}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* Offline notice */}
      {!status?.connected && (
        <div style={{ padding: '12px 16px', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', fontSize: 'var(--fs-sm)', color: 'var(--text-3)' }}>
          Broker bridge is offline. Start it with: <code style={{ background: 'var(--bg)', padding: '1px 5px', borderRadius: 3, fontSize: 'var(--fs-xs)' }}>python broker_service.py</code>
        </div>
      )}

      {/* Offline notice — shown on Vercel */}
      {!isLocal && !loading && (
        <div style={{ padding: '20px 16px', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', background: 'var(--bg-subtle)', fontSize: 'var(--fs-sm)', color: 'var(--text-3)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontWeight: 500, color: 'var(--text)' }}>Broker bridge not available</div>
          <div>The broker bridge only runs on your local machine alongside OpenD. To use the Orders page:</div>
          <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <li>Start OpenD on your machine</li>
            <li>Run <code style={{ background: 'var(--bg)', padding: '1px 5px', borderRadius: 3, fontSize: 'var(--fs-xs)' }}>python broker_service.py</code></li>
            <li>Open <strong>localhost:3000/dashboard/orders</strong></li>
          </ol>
        </div>
      )}

      {/* Tabs */}
      {isLocal && <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
        {([
          ['open',      `Open orders (${openOrders.length})`],
          ['history',   `History (${filledOrders.length + otherOrders.length})`],
          ['positions', `Positions (${positions.length})`],
        ] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            padding: '6px 14px', background: 'transparent', border: 'none',
            borderBottom: `2px solid ${tab === key ? 'var(--text)' : 'transparent'}`,
            color: tab === key ? 'var(--text)' : 'var(--text-4)',
            fontSize: 'var(--fs-sm)', fontWeight: tab === key ? 500 : 400,
            cursor: 'pointer', marginBottom: -1, fontFamily: 'inherit',
          }}>{label}</button>
        ))}
      </div>}

      {/* ── Tab content (local only) ── */}
      {isLocal && <>

      {/* ── Open orders ── */}
      {tab === 'open' && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
          {openOrders.length === 0 ? (
            <div style={{ padding: '20px 16px', color: 'var(--text-4)', fontSize: 'var(--fs-sm)', textAlign: 'center' }}>
              No open orders
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Symbol','Side','Type','Qty','Limit','Stop','Placed',''].map((h, i) => (
                    <th key={i} style={{ fontSize: 'var(--fs-label)', fontWeight: 500, color: 'var(--text-4)', textAlign: i === 0 ? 'left' : 'right', padding: '6px 12px 6px', letterSpacing: '0.04em', textTransform: 'uppercase', borderBottom: '1px solid var(--border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {openOrders.map(o => (
                  <tr key={o.order_id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 600, fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{o.symbol}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 'var(--fs-sm)', fontWeight: 600, color: SIDE_COLOR[o.side] }}>{o.side}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 'var(--fs-sm)', color: 'var(--text-3)' }}>{o.order_type}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-mono)' }}>{o.qty}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>{o.limit_price ? `$${o.limit_price}` : '—'}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>{o.stop_price ? `$${o.stop_price}` : '—'}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 'var(--fs-xs)', color: 'var(--text-4)' }}>
                      {new Date(o.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                      <button
                        onClick={() => cancelOrder(o.order_id, (o as any).source ?? 'moomoo')}
                        disabled={cancelling === o.order_id}
                        style={{ fontSize: 'var(--fs-xs)', padding: '2px 8px', background: 'rgba(185,28,28,0.07)', border: '1px solid rgba(185,28,28,0.2)', color: 'var(--signal-bear)', borderRadius: 3, cursor: 'pointer', fontFamily: 'inherit', opacity: cancelling === o.order_id ? 0.4 : 1 }}
                      >
                        {cancelling === o.order_id ? '…' : 'Cancel'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── History ── */}
      {tab === 'history' && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
          {filledOrders.length === 0 && otherOrders.length === 0 ? (
            <div style={{ padding: '20px 16px', color: 'var(--text-4)', fontSize: 'var(--fs-sm)', textAlign: 'center' }}>No order history</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Symbol','Side','Type','Qty','Fill price','Total','Status','Time','Slippage'].map((h, i) => (
                    <th key={i} style={{ fontSize: 'var(--fs-label)', fontWeight: 500, color: 'var(--text-4)', textAlign: i === 0 ? 'left' : 'right', padding: '6px 12px', letterSpacing: '0.04em', textTransform: 'uppercase', borderBottom: '1px solid var(--border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...filledOrders, ...otherOrders].map(o => (
                  <tr key={o.order_id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '7px 12px', fontWeight: 600, fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{o.symbol}</td>
                    <td style={{ padding: '7px 12px', textAlign: 'right', fontSize: 'var(--fs-sm)', fontWeight: 600, color: SIDE_COLOR[o.side] }}>{o.side}</td>
                    <td style={{ padding: '7px 12px', textAlign: 'right', fontSize: 'var(--fs-sm)', color: 'var(--text-3)' }}>{o.order_type}</td>
                    <td style={{ padding: '7px 12px', textAlign: 'right', fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-mono)' }}>{o.qty}</td>
                    <td style={{ padding: '7px 12px', textAlign: 'right', fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-mono)' }}>{o.fill_price ? `$${o.fill_price.toFixed(4)}` : '—'}</td>
                    <td style={{ padding: '7px 12px', textAlign: 'right', fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-mono)' }}>
                      {o.fill_price ? fmt(o.fill_price * o.qty) : '—'}
                    </td>
                    <td style={{ padding: '7px 12px', textAlign: 'right' }}>
                      <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: STATUS_COLOR[o.status], textTransform: 'uppercase' }}>{o.status}</span>
                    </td>
                    <td style={{ padding: '7px 12px', textAlign: 'right', fontSize: 'var(--fs-xs)', color: 'var(--text-4)' }}>
                      {o.fill_time ? new Date(o.fill_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
                    </td>
                    <td style={{ padding: '7px 12px', textAlign: 'right', fontSize: 'var(--fs-xs)', color: 'var(--text-4)', fontFamily: 'var(--font-mono)' }}>
                      {o.slippage > 0 ? `$${o.slippage.toFixed(4)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Positions ── */}
      {tab === 'positions' && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
          {positions.length === 0 ? (
            <div style={{ padding: '20px 16px', color: 'var(--text-4)', fontSize: 'var(--fs-sm)', textAlign: 'center' }}>No open positions</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Symbol','Qty','Avg cost','Market price','Mkt value','Unrealised P&L','%'].map((h, i) => (
                    <th key={i} style={{ fontSize: 'var(--fs-label)', fontWeight: 500, color: 'var(--text-4)', textAlign: i === 0 ? 'left' : 'right', padding: '6px 12px', letterSpacing: '0.04em', textTransform: 'uppercase', borderBottom: '1px solid var(--border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {positions.map(p => (
                  <tr key={p.symbol} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 600, fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{p.symbol}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-mono)' }}>{p.qty.toLocaleString()}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>${p.avg_cost.toFixed(4)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>${p.market_price.toFixed(4)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-mono)' }}>{fmt(p.market_value)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 'var(--fs-sm)', fontWeight: 500, color: signCol(p.unrealised_pnl) }}>
                      {p.unrealised_pnl >= 0 ? '+' : ''}{fmt(p.unrealised_pnl)}
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: 'var(--fs-sm)', fontWeight: 500, color: signCol(p['unrealised_pnl%']) }}>
                      {fmtPct(p['unrealised_pnl%'])}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      </>}

      {/* Place order modal */}
      {orderModal && status?.connected && (
        <PlaceOrderModal
          cash={status.cash ?? 0}
          onClose={() => setOrderModal(false)}
          onPlaced={load}
        />
      )}
    </div>
  )
}
