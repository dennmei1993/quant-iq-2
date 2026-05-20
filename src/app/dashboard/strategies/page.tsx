'use client'
// src/app/dashboard/strategies/page.tsx

import { useState, useEffect } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Strategy {
  id:               string
  type:             string
  ticker:           string
  status:           string
  notes:            string | null
  leg1_order_id:    string | null
  leg1_order_ref:   string | null
  leg1_code:        string | null
  leg1_strike:      number | null
  leg1_expiry:      string | null
  leg1_delta_target: number | null
  leg1_iv_max:      number | null
  leg1_fill_price:  number | null
  leg1_filled_at:   string | null
  leg2_order_id:    string | null
  leg2_order_ref:   string | null
  leg2_code:        string | null
  leg2_strike:      number | null
  leg2_expiry:      string | null
  leg2_delta_target: number | null
  leg2_iv_min:      number | null
  leg2_premium_min: number | null
  leg2_fill_price:  number | null
  leg2_filled_at:   string | null
  roll_count:       number
  last_rolled_at:   string | null
  pnl_snapshot:     number | null
  pnl_updated_at:   string | null
  closed_at:        string | null
  created_at:       string
}

interface Alert {
  id:          string
  strategy_id: string
  type:        string
  message:     string
  is_read:     boolean
  created_at:  string
}

interface ConditionalOrder {
  id:             string
  ticker:         string
  side:           string
  status:         string
  is_active:      boolean
  leg_num:        number | null
  notes:          string | null
  iv_rank_below:  number | null
  iv_rank_above:  number | null
  premium_above:  number | null
  not_before_time: string | null
  expires_at:     string | null
  created_at:     string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function dte(expiry: string | null): number | null {
  if (!expiry) return null
  return Math.round((new Date(expiry.slice(0, 10)).getTime() - Date.now()) / 86400000)
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d.slice(0, 10)).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' })
}

function fmtTime(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function statusColor(status: string) {
  switch (status) {
    case 'active':      return { bg: 'rgba(21,128,61,0.08)',  border: 'rgba(21,128,61,0.3)',   text: '#16a34a' }
    case 'leg1_filled': return { bg: 'rgba(37,99,235,0.08)',  border: 'rgba(37,99,235,0.3)',   text: '#2563eb' }
    case 'leg1_placed': return { bg: 'rgba(234,179,8,0.08)',  border: 'rgba(234,179,8,0.3)',   text: '#ca8a04' }
    case 'rolling':     return { bg: 'rgba(139,92,246,0.08)', border: 'rgba(139,92,246,0.3)',  text: '#8b5cf6' }
    case 'pending':     return { bg: 'rgba(100,116,139,0.08)', border: 'rgba(100,116,139,0.3)', text: '#64748b' }
    case 'closed':      return { bg: 'rgba(100,116,139,0.06)', border: 'rgba(100,116,139,0.2)', text: '#94a3b8' }
    default:            return { bg: 'var(--bg-subtle)',      border: 'var(--border)',          text: 'var(--text-4)' }
  }
}

function statusLabel(status: string) {
  switch (status) {
    case 'pending':     return 'Pending — waiting for conditions'
    case 'leg1_placed': return 'LEG1 placed — awaiting fill'
    case 'leg1_filled': return 'LEG1 filled — LEG2 active'
    case 'active':      return 'Active'
    case 'rolling':     return 'Rolling — short expired'
    case 'closed':      return 'Closed'
    default:            return status
  }
}

// ── Strategy Card ─────────────────────────────────────────────────────────────

function StrategyCard({ strat, orders, onRefresh }: { strat: Strategy; orders: ConditionalOrder[]; onRefresh: () => void }) {
  const sc    = statusColor(strat.status)
  const leg1  = orders.find(o => o.id === strat.leg1_order_id)
  const leg2  = orders.find(o => o.id === strat.leg2_order_id)
  const dte2  = dte(strat.leg2_expiry)
  const dte1  = dte(strat.leg1_expiry)
  const pnl   = strat.pnl_snapshot
  const [closing, setClosing] = useState(false)

  async function closeStrategy() {
    if (!confirm(`Close PMCC ${strat.ticker}? This will cancel any pending conditional orders.`)) return
    setClosing(true)
    try {
      await fetch(`/api/strategies/option?id=${strat.id}`, { method: 'DELETE' })
      onRefresh()
    } finally { setClosing(false) }
  }

  const cs: React.CSSProperties = { fontSize: 9, fontWeight: 500, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }
  const vs: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-mono)' }

  return (
    <div style={{ background: 'var(--bg)', border: `1px solid ${sc.border}`, borderRadius: 10, overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: sc.bg }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700 }}>
            {strat.type.toUpperCase()} · {strat.ticker}
          </div>
          <span style={{ fontSize: 9, fontWeight: 600, color: sc.text, background: sc.bg, border: `1px solid ${sc.border}`, padding: '2px 8px', borderRadius: 10 }}>
            {statusLabel(strat.status)}
          </span>
          {strat.roll_count > 0 && (
            <span style={{ fontSize: 9, color: '#8b5cf6', background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)', padding: '2px 7px', borderRadius: 10 }}>
              {strat.roll_count}× rolled
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {pnl !== null && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: pnl >= 0 ? 'var(--signal-bull)' : 'var(--signal-bear)' }}>
              {pnl >= 0 ? '+' : ''}${pnl}
            </div>
          )}
          <div style={{ fontSize: 9, color: 'var(--text-4)' }}>{fmtDate(strat.created_at)}</div>
        </div>
      </div>

      {/* Legs */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>

        {/* LEG 1 — LEAP */}
        <div style={{ padding: '12px 14px', borderRight: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--signal-bull)', background: 'rgba(21,128,61,0.08)', padding: '1px 7px', borderRadius: 8 }}>LEG 1 — BUY LEAP</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <div>
              <div style={cs}>Strike</div>
              <div style={vs}>{strat.leg1_strike ? `$${strat.leg1_strike}` : leg1 ? 'TBD' : '—'}</div>
            </div>
            <div>
              <div style={cs}>Expiry</div>
              <div style={vs}>{strat.leg1_expiry ? `${fmtDate(strat.leg1_expiry)} (${dte1}d)` : leg1 ? 'TBD' : '—'}</div>
            </div>
            <div>
              <div style={cs}>Fill price</div>
              <div style={{ ...vs, color: strat.leg1_fill_price ? 'var(--text)' : 'var(--text-4)' }}>
                {strat.leg1_fill_price ? `$${strat.leg1_fill_price}` : '—'}
              </div>
            </div>
          </div>
          {leg1 && (
            <div style={{ marginTop: 8, padding: '5px 8px', background: 'var(--bg-subtle)', borderRadius: 'var(--r-md)', fontSize: 9, color: 'var(--text-4)', lineHeight: 1.5 }}>
              {strat.status === 'pending'
                ? <>Waiting: {leg1.iv_rank_below != null ? `IVR ≤ ${leg1.iv_rank_below}` : 'conditions not set'} · δ target {strat.leg1_delta_target}</>
                : strat.status === 'leg1_placed'
                ? `Order #${strat.leg1_order_ref} — awaiting broker fill confirmation`
                : strat.leg1_filled_at
                ? `Filled ${fmtTime(strat.leg1_filled_at)}`
                : 'Order active'}
            </div>
          )}
        </div>

        {/* LEG 2 — Short Call */}
        <div style={{ padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--signal-bear)', background: 'rgba(185,28,28,0.08)', padding: '1px 7px', borderRadius: 8 }}>LEG 2 — SELL SHORT CALL</span>
            {dte2 !== null && dte2 <= 7 && dte2 >= 0 && (
              <span style={{ fontSize: 9, fontWeight: 600, color: '#f59e0b', background: 'rgba(245,158,11,0.1)', padding: '1px 7px', borderRadius: 8 }}>⚠ {dte2}d to expiry</span>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <div>
              <div style={cs}>Strike</div>
              <div style={vs}>{strat.leg2_strike ? `$${strat.leg2_strike}` : leg2 ? 'TBD' : '—'}</div>
            </div>
            <div>
              <div style={cs}>Expiry</div>
              <div style={{ ...vs, color: dte2 !== null && dte2 <= 7 ? '#f59e0b' : 'var(--text)' }}>
                {strat.leg2_expiry ? `${fmtDate(strat.leg2_expiry)} (${dte2}d)` : leg2 ? 'TBD' : '—'}
              </div>
            </div>
            <div>
              <div style={cs}>Fill price</div>
              <div style={{ ...vs, color: strat.leg2_fill_price ? 'var(--text)' : 'var(--text-4)' }}>
                {strat.leg2_fill_price ? `$${strat.leg2_fill_price}` : '—'}
              </div>
            </div>
          </div>
          {leg2 && (
            <div style={{ marginTop: 8, padding: '5px 8px', background: 'var(--bg-subtle)', borderRadius: 'var(--r-md)', fontSize: 9, color: 'var(--text-4)', lineHeight: 1.5 }}>
              {!leg2.is_active && strat.status !== 'active'
                ? `Inactive — activates when LEG1 fills`
                : leg2.status === 'triggered'
                ? `Order #${strat.leg2_order_ref} — awaiting broker fill`
                : leg2.iv_rank_above != null || leg2.premium_above != null
                ? `Waiting: ${leg2.iv_rank_above ? `IVR ≥ ${leg2.iv_rank_above}` : ''} ${leg2.premium_above ? `· bid ≥ $${leg2.premium_above}` : ''} · δ target ${strat.leg2_delta_target}`
                : strat.leg2_filled_at
                ? `Filled ${fmtTime(strat.leg2_filled_at)}`
                : 'Order active'}
            </div>
          )}
        </div>
      </div>

      {/* P&L row for active strategies */}
      {strat.status === 'active' && strat.leg1_fill_price && strat.leg2_fill_price && (
        <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border)', background: 'var(--bg-subtle)', display: 'flex', gap: 24, alignItems: 'center' }}>
          <div>
            <span style={{ fontSize: 9, color: 'var(--text-4)', marginRight: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Net debit</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--signal-bear)', fontWeight: 600 }}>
              ${((strat.leg1_fill_price - strat.leg2_fill_price) * 100).toFixed(0)}/contract
            </span>
          </div>
          {strat.leg1_strike && strat.leg2_strike && (
            <div>
              <span style={{ fontSize: 9, color: 'var(--text-4)', marginRight: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Max profit</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--signal-bull)', fontWeight: 600 }}>
                ${((strat.leg2_strike - strat.leg1_strike - strat.leg1_fill_price + strat.leg2_fill_price) * 100).toFixed(0)}/contract
              </span>
            </div>
          )}
          {pnl !== null && (
            <div>
              <span style={{ fontSize: 9, color: 'var(--text-4)', marginRight: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Unrealised P&L</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: pnl >= 0 ? 'var(--signal-bull)' : 'var(--signal-bear)' }}>
                {pnl >= 0 ? '+' : ''}${pnl}
              </span>
            </div>
          )}
          {strat.pnl_updated_at && (
            <div style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--text-4)' }}>
              Updated {fmtTime(strat.pnl_updated_at)}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border)', display: 'flex', gap: 6, alignItems: 'center' }}>
        {strat.status === 'rolling' && (
          <a href={`/dashboard/workspace?ticker=${strat.ticker}`}
            style={{ fontSize: 10, fontWeight: 600, padding: '4px 10px', borderRadius: 'var(--r-md)', background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.3)', color: '#8b5cf6', textDecoration: 'none', cursor: 'pointer' }}>
            Roll short call →
          </a>
        )}
        {dte2 !== null && dte2 <= 7 && strat.status === 'active' && (
          <a href={`/dashboard/workspace?ticker=${strat.ticker}`}
            style={{ fontSize: 10, fontWeight: 600, padding: '4px 10px', borderRadius: 'var(--r-md)', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b', textDecoration: 'none', cursor: 'pointer' }}>
            ⚠ Roll due →
          </a>
        )}
        <a href={`/dashboard/workspace?ticker=${strat.ticker}`}
          style={{ fontSize: 10, padding: '4px 10px', borderRadius: 'var(--r-md)', background: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-3)', textDecoration: 'none' }}>
          View chain
        </a>
        {strat.status !== 'closed' && (
          <button onClick={closeStrategy} disabled={closing}
            style={{ fontSize: 10, padding: '4px 10px', borderRadius: 'var(--r-md)', background: 'none', border: '1px solid var(--border)', color: 'var(--text-4)', cursor: 'pointer', marginLeft: 'auto', opacity: closing ? 0.5 : 1 }}>
            {closing ? 'Closing…' : 'Close strategy'}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Alert Banner ──────────────────────────────────────────────────────────────

function AlertBanner({ alerts, onDismiss }: { alerts: Alert[]; onDismiss: (id: string) => void }) {
  const unread = alerts.filter(a => !a.is_read)
  if (!unread.length) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
      {unread.map(a => (
        <div key={a.id} style={{
          padding: '8px 12px', borderRadius: 'var(--r-md)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          background: a.type === 'roll_due' ? 'rgba(245,158,11,0.06)' : a.type.includes('filled') ? 'rgba(21,128,61,0.06)' : 'var(--bg-subtle)',
          border: `1px solid ${a.type === 'roll_due' ? 'rgba(245,158,11,0.25)' : a.type.includes('filled') ? 'rgba(21,128,61,0.25)' : 'var(--border)'}`,
        }}>
          <div style={{ fontSize: 10, color: a.type === 'roll_due' ? '#f59e0b' : a.type.includes('filled') ? 'var(--signal-bull)' : 'var(--text-3)' }}>
            {a.type === 'roll_due' ? '⚠ ' : a.type.includes('filled') ? '✓ ' : 'ℹ '}{a.message}
          </div>
          <button onClick={() => onDismiss(a.id)} style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}>×</button>
        </div>
      ))}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function StrategiesPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [orders,     setOrders]     = useState<ConditionalOrder[]>([])
  const [alerts,     setAlerts]     = useState<Alert[]>([])
  const [loading,    setLoading]    = useState(true)
  const [filter,     setFilter]     = useState<'all' | 'active' | 'pending' | 'closed'>('all')

  async function load() {
    setLoading(true)
    try {
      const [stratRes, orderRes, alertRes] = await Promise.all([
        fetch('/api/strategies/option'),
        fetch('/api/orders/conditional?limit=200'),
        fetch('/api/strategies/alerts'),
      ])
      const [stratData, orderData, alertData] = await Promise.all([
        stratRes.json(), orderRes.json(), alertRes.json(),
      ])
      setStrategies(stratData.strategies ?? [])
      setOrders(orderData.orders ?? [])
      setAlerts(alertData.alerts ?? [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function dismissAlert(id: string) {
    await fetch(`/api/strategies/alerts?id=${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_read: true }) })
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, is_read: true } : a))
  }

  const filtered = strategies.filter(s => {
    if (filter === 'active')  return ['active', 'leg1_placed', 'leg1_filled', 'rolling'].includes(s.status)
    if (filter === 'pending') return s.status === 'pending'
    if (filter === 'closed')  return s.status === 'closed'
    return true
  })

  const counts = {
    active:  strategies.filter(s => ['active', 'leg1_placed', 'leg1_filled', 'rolling'].includes(s.status)).length,
    pending: strategies.filter(s => s.status === 'pending').length,
    closed:  strategies.filter(s => s.status === 'closed').length,
  }

  const unreadAlerts = alerts.filter(a => !a.is_read).length

  return (
    <div style={{ padding: '24px', maxWidth: 960, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 9, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Option Strategies</div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>Strategy Monitor</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {unreadAlerts > 0 && (
            <div style={{ fontSize: 10, fontWeight: 600, color: '#f59e0b', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', padding: '4px 10px', borderRadius: 10 }}>
              {unreadAlerts} alert{unreadAlerts > 1 ? 's' : ''}
            </div>
          )}
          <button onClick={load} style={{ fontSize: 10, padding: '5px 12px', borderRadius: 'var(--r-md)', background: 'var(--bg-subtle)', border: '1px solid var(--border)', color: 'var(--text-3)', cursor: 'pointer', fontFamily: 'inherit' }}>
            Refresh
          </button>
          <a href="/dashboard/workspace" style={{ fontSize: 10, fontWeight: 600, padding: '5px 12px', borderRadius: 'var(--r-md)', background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.3)', color: '#8b5cf6', textDecoration: 'none' }}>
            + New strategy
          </a>
        </div>
      </div>

      {/* Alerts */}
      <AlertBanner alerts={alerts} onDismiss={dismissAlert} />

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 20 }}>
        {[
          { label: 'Total', value: strategies.length, color: 'var(--text)' },
          { label: 'Active', value: counts.active,  color: '#16a34a' },
          { label: 'Pending', value: counts.pending, color: '#64748b' },
          { label: 'Closed', value: counts.closed,  color: '#94a3b8' },
        ].map(s => (
          <div key={s.label} style={{ padding: '10px 14px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 9, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {(['all', 'active', 'pending', 'closed'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ fontSize: 10, fontWeight: filter === f ? 600 : 400, padding: '4px 12px', borderRadius: 'var(--r-md)', cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize', background: filter === f ? 'var(--bg-accent)' : 'none', border: `1px solid ${filter === f ? 'var(--border-accent)' : 'var(--border)'}`, color: filter === f ? 'var(--text)' : 'var(--text-4)' }}>
            {f} {f !== 'all' && `(${counts[f] ?? strategies.length})`}
          </button>
        ))}
      </div>

      {/* Strategy list */}
      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--text-4)', padding: 40, fontSize: 12 }}>Loading strategies…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--text-4)', padding: 40, fontSize: 12 }}>
          {filter === 'all' ? (
            <>No strategies yet. <a href="/dashboard/workspace" style={{ color: 'var(--color-info)' }}>Stage a PMCC →</a></>
          ) : `No ${filter} strategies.`}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filtered.map(s => (
            <StrategyCard key={s.id} strat={s} orders={orders} onRefresh={load} />
          ))}
        </div>
      )}
    </div>
  )
}
