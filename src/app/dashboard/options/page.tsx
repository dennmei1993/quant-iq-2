'use client'
// src/app/dashboard/options/page.tsx
// Options Wheel Strategy dashboard
// Reads from: positions, orders, trade_log, scanner_runs, options_watchlist, options_alerts
// Approval workflow: pending orders can be approved/rejected here → FastAPI submits to IB

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

// ─── Types ────────────────────────────────────────────────────────────────────

type OptsState        = 'csp_pending' | 'csp_open' | 'assigned' | 'cc_pending' | 'cc_open' | 'closing' | 'closed'
type ApprovalStatus   = 'pending' | 'approved' | 'rejected' | 'auto_approved'
type OrderStatus      = 'awaiting_approval' | 'submitted' | 'filled' | 'cancelled' | 'rejected' | 'expired'
type OrderAction      = 'buy' | 'sell'

interface Position {
  id:                     string
  symbol:                 string
  opts_state:             OptsState
  shares_qty:             number | null
  shares_cost_basis:      number | null
  option_type:            string | null
  option_symbol:          string | null
  option_strike:          number | null
  option_expiry:          string | null
  option_dte_at_open:     number | null
  option_delta_at_open:   number | null
  premium_collected:      number | null
  total_premium_collected:number
  approval_status:        ApprovalStatus
  approved_at:            string | null
  approved_by:            string | null
  unrealised_pnl:         number | null
  realised_pnl:           number | null
  opened_at:              string
  updated_at:             string
  closed_at:              string | null
  notes:                  string | null
}

interface Order {
  id:                 string
  position_id:        string | null
  symbol:             string
  order_type:         string
  action:             OrderAction
  quantity:           number
  option_symbol:      string | null
  option_strike:      number | null
  option_expiry:      string | null
  option_type:        string | null
  limit_price:        number | null
  fill_price:         number | null
  mid_price_at_submit:number | null
  ib_order_id:        number | null
  approval_status:    ApprovalStatus
  order_status:       OrderStatus
  created_at:         string
  submitted_at:       string | null
  filled_at:          string | null
  expires_at:         string | null
  notes:              string | null
}

interface TradeLog {
  id:             string
  position_id:    string | null
  order_id:       string | null
  symbol:         string
  trade_type:     string
  action:         OrderAction | null
  quantity:       number | null
  option_symbol:  string | null
  option_strike:  number | null
  option_expiry:  string | null
  option_type:    string | null
  fill_price:     number | null
  total_value:    number | null
  commission:     number | null
  pnl:            number | null
  cumulative_pnl: number | null
  iv_at_open:     number | null
  delta_at_open:  number | null
  dte_at_open:    number | null
  logged_at:      string
}

interface ScannerRun {
  id:              string
  run_at:          string
  tickers_scanned: number
  tickers_passed:  number
  candidates:      any[]
  status:          string
  error_msg:       string | null
}

interface WatchlistEntry {
  id:       string
  symbol:   string
  enabled:  boolean
  notes:    string | null
  added_at: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtCurrency(v: number | null) {
  if (v == null) return '—'
  return `${v >= 0 ? '' : '-'}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function daysUntil(dateStr: string | null) {
  if (!dateStr) return null
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000)
}

const STATE_LABEL: Record<OptsState, string> = {
  csp_pending: 'CSP Pending',
  csp_open:    'CSP Open',
  assigned:    'Assigned',
  cc_pending:  'CC Pending',
  cc_open:     'CC Open',
  closing:     'Closing',
  closed:      'Closed',
}

const STATE_COLOR: Record<OptsState, string> = {
  csp_pending: '#e0c97a',
  csp_open:    '#4eca99',
  assigned:    '#7ab4e8',
  cc_pending:  '#e0c97a',
  cc_open:     '#4eca99',
  closing:     '#e87070',
  closed:      'rgba(232,226,217,0.35)',
}

const APPROVAL_COLOR: Record<ApprovalStatus, string> = {
  pending:       '#e0c97a',
  approved:      '#4eca99',
  rejected:      '#e87070',
  auto_approved: 'rgba(78,202,153,0.6)',
}

const ORDER_STATUS_COLOR: Record<OrderStatus, string> = {
  awaiting_approval: '#e0c97a',
  submitted:         '#7ab4e8',
  filled:            '#4eca99',
  cancelled:         'rgba(232,226,217,0.35)',
  rejected:          '#e87070',
  expired:           'rgba(232,226,217,0.35)',
}

const pill = (label: string, color: string) => (
  <span style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color, background: `${color}18`, border: `1px solid ${color}33`, borderRadius: 3, padding: '0.1rem 0.4rem', whiteSpace: 'nowrap' }}>
    {label}
  </span>
)

const T = {
  cream:  'var(--cream)',
  dim:    'rgba(232,226,217,0.55)',
  dimmer: 'rgba(232,226,217,0.35)',
  border: 'var(--dash-border)',
  gold:   'var(--gold)',
}

const labelStyle: React.CSSProperties = {
  fontSize: '0.65rem', color: T.dimmer, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3,
}

// ─── Tab bar ──────────────────────────────────────────────────────────────────

type Tab = 'positions' | 'approvals' | 'tradelog' | 'scanner' | 'watchlist' | 'alerts'

const TABS: [Tab, string][] = [
  ['positions',  'Positions'],
  ['approvals',  'Approvals'],
  ['tradelog',   'Trade Log'],
  ['scanner',    'Scanner'],
  ['watchlist',  'Watchlist'],
  ['alerts',     'Alerts'],
]

// ─── Panel wrapper ────────────────────────────────────────────────────────────

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--navy2)', border: '1px solid var(--dash-border)', borderRadius: 8, overflow: 'hidden', marginBottom: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.65rem 1rem', borderBottom: '1px solid var(--dash-border)' }}>
        <div style={{ fontSize: '0.68rem', fontWeight: 600, color: T.dim, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{title}</div>
        {action}
      </div>
      <div>{children}</div>
    </div>
  )
}

// ─── Positions tab ────────────────────────────────────────────────────────────

function PositionsTab({ positions, onRefresh }: { positions: Position[]; onRefresh: () => void }) {
  const active = positions.filter(p => p.opts_state !== 'closed')
  const closed = positions.filter(p => p.opts_state === 'closed')

  function PositionRow({ p }: { p: Position }) {
    const dte      = daysUntil(p.option_expiry)
    const pnlCol   = p.unrealised_pnl == null ? T.dimmer : p.unrealised_pnl >= 0 ? '#4eca99' : '#e87070'
    const stateCol = STATE_COLOR[p.opts_state] ?? T.dimmer

    return (
      <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1fr 1fr 1fr 1fr', gap: '0.5rem', alignItems: 'center' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ fontWeight: 700, color: T.cream, fontFamily: 'monospace', fontSize: '0.88rem' }}>{p.symbol}</span>
            {pill(STATE_LABEL[p.opts_state], stateCol)}
          </div>
          {p.option_symbol && <div style={{ fontSize: '0.62rem', color: T.dimmer, fontFamily: 'monospace', marginTop: 2 }}>{p.option_symbol}</div>}
          {p.notes && <div style={{ fontSize: '0.62rem', color: T.dimmer, marginTop: 1 }}>{p.notes}</div>}
        </div>

        <div style={{ textAlign: 'right' }}>
          {p.option_strike != null && <div style={{ fontSize: '0.82rem', color: T.cream, fontFamily: 'monospace' }}>${p.option_strike}</div>}
          {p.option_type   && <div style={{ fontSize: '0.6rem', color: T.dimmer, textTransform: 'uppercase' }}>{p.option_type}</div>}
        </div>

        <div style={{ textAlign: 'right' }}>
          {p.option_expiry && <div style={{ fontSize: '0.78rem', color: T.dim, fontFamily: 'monospace' }}>{fmtDate(p.option_expiry)}</div>}
          {dte != null && <div style={{ fontSize: '0.62rem', color: dte <= 7 ? '#e87070' : T.dimmer }}>{dte}d</div>}
        </div>

        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.78rem', color: '#4eca99', fontFamily: 'monospace' }}>{fmtCurrency(p.total_premium_collected)}</div>
          <div style={{ fontSize: '0.6rem', color: T.dimmer }}>premium</div>
        </div>

        <div style={{ textAlign: 'right' }}>
          {p.option_delta_at_open != null && <div style={{ fontSize: '0.78rem', color: T.dim, fontFamily: 'monospace' }}>Δ {p.option_delta_at_open.toFixed(2)}</div>}
          {p.option_dte_at_open   != null && <div style={{ fontSize: '0.6rem', color: T.dimmer }}>{p.option_dte_at_open}d at open</div>}
        </div>

        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 600, color: pnlCol, fontFamily: 'monospace' }}>{fmtCurrency(p.unrealised_pnl)}</div>
          {p.realised_pnl != null && p.realised_pnl !== 0 && (
            <div style={{ fontSize: '0.62rem', color: p.realised_pnl >= 0 ? '#4eca99' : '#e87070' }}>R: {fmtCurrency(p.realised_pnl)}</div>
          )}
        </div>

        <div style={{ textAlign: 'right' }}>
          {pill(p.approval_status.replace('_', ' '), APPROVAL_COLOR[p.approval_status])}
          <div style={{ fontSize: '0.6rem', color: T.dimmer, marginTop: 3 }}>{fmtDate(p.opened_at)}</div>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', padding: '0.75rem 1rem', borderBottom: '1px solid var(--dash-border)', marginBottom: '0.5rem' }}>
        {[
          { label: 'Active',         value: String(active.length) },
          { label: 'Total Premium',  value: fmtCurrency(positions.reduce((s, p) => s + p.total_premium_collected, 0)) },
          { label: 'Unrealised P&L', value: fmtCurrency(positions.reduce((s, p) => s + (p.unrealised_pnl ?? 0), 0)) },
          { label: 'Realised P&L',   value: fmtCurrency(positions.reduce((s, p) => s + (p.realised_pnl ?? 0), 0)) },
        ].map(({ label, value }) => (
          <div key={label}>
            <div style={{ fontSize: '0.58rem', color: T.dimmer, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: T.cream, marginTop: 2, fontFamily: 'monospace' }}>{value}</div>
          </div>
        ))}
      </div>

      <Section title={`Active Positions · ${active.length}`}>
        {active.length === 0
          ? <div style={{ padding: '1rem', color: T.dimmer, fontSize: '0.82rem' }}>No active positions</div>
          : <>
              {/* Header */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1fr 1fr 1fr 1fr', gap: '0.5rem', padding: '0.35rem 1rem', fontSize: '0.58rem', color: T.dimmer, textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <span>Symbol / State</span><span style={{ textAlign: 'right' }}>Strike</span><span style={{ textAlign: 'right' }}>Expiry</span><span style={{ textAlign: 'right' }}>Premium</span><span style={{ textAlign: 'right' }}>Greeks</span><span style={{ textAlign: 'right' }}>P&L</span><span style={{ textAlign: 'right' }}>Status</span>
              </div>
              {active.map(p => <PositionRow key={p.id} p={p} />)}
            </>
        }
      </Section>

      {closed.length > 0 && (
        <Section title={`Closed Positions · ${closed.length}`}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1fr 1fr 1fr 1fr', gap: '0.5rem', padding: '0.35rem 1rem', fontSize: '0.58rem', color: T.dimmer, textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <span>Symbol</span><span style={{ textAlign: 'right' }}>Strike</span><span style={{ textAlign: 'right' }}>Expiry</span><span style={{ textAlign: 'right' }}>Premium</span><span style={{ textAlign: 'right' }}>Greeks</span><span style={{ textAlign: 'right' }}>Realised</span><span style={{ textAlign: 'right' }}>Closed</span>
          </div>
          {closed.slice(0, 20).map(p => <PositionRow key={p.id} p={p} />)}
        </Section>
      )}
    </>
  )
}

// ─── Approvals tab ────────────────────────────────────────────────────────────

function ApprovalsTab({ orders, onRefresh }: { orders: Order[]; onRefresh: () => void }) {
  const pending   = orders.filter(o => o.order_status === 'awaiting_approval')
  const recent    = orders.filter(o => o.order_status !== 'awaiting_approval').slice(0, 30)
  const [acting,  setActing]  = useState<string | null>(null)
  const [error,   setError]   = useState('')
  const supabase = createClient()

  async function act(orderId: string, action: 'approved' | 'rejected') {
    setActing(orderId); setError('')
    try {
      const { error: err } = await supabase
        .from('orders')
        .update({ approval_status: action, order_status: action === 'approved' ? 'submitted' : 'cancelled' })
        .eq('id', orderId)
      if (err) throw err
      onRefresh()
    } catch (e: any) {
      setError(e.message ?? 'Failed')
    } finally {
      setActing(null)
    }
  }

  function OrderRow({ o, showActions }: { o: Order; showActions?: boolean }) {
    const dte = daysUntil(o.option_expiry)
    return (
      <div style={{ padding: '0.7rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 1fr 0.8fr 0.8fr 0.8fr 0.8fr' + (showActions ? ' 7rem' : ' 6rem'), gap: '0.5rem', alignItems: 'center' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ fontWeight: 700, color: T.cream, fontFamily: 'monospace', fontSize: '0.88rem' }}>{o.symbol}</span>
            {pill(o.action.toUpperCase(), o.action === 'sell' ? '#4eca99' : '#e87070')}
          </div>
          {o.option_symbol && <div style={{ fontSize: '0.62rem', color: T.dimmer, fontFamily: 'monospace', marginTop: 2 }}>{o.option_symbol}</div>}
        </div>
        <div style={{ textAlign: 'right', fontSize: '0.78rem', color: T.dim, fontFamily: 'monospace' }}>{o.order_type}</div>
        <div style={{ textAlign: 'right' }}>
          {o.option_strike && <div style={{ fontSize: '0.82rem', color: T.cream, fontFamily: 'monospace' }}>${o.option_strike} {o.option_type}</div>}
          {o.option_expiry && <div style={{ fontSize: '0.6rem', color: T.dimmer }}>{fmtDate(o.option_expiry)}{dte != null ? ` · ${dte}d` : ''}</div>}
        </div>
        <div style={{ textAlign: 'right', fontSize: '0.78rem', color: T.dim, fontFamily: 'monospace' }}>{o.quantity}</div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.78rem', color: T.cream, fontFamily: 'monospace' }}>{o.limit_price ? `$${o.limit_price}` : '—'}</div>
          {o.mid_price_at_submit && <div style={{ fontSize: '0.6rem', color: T.dimmer }}>mid ${o.mid_price_at_submit}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          {pill(o.order_status.replace(/_/g, ' '), ORDER_STATUS_COLOR[o.order_status])}
        </div>
        <div style={{ textAlign: 'right', fontSize: '0.68rem', color: T.dimmer, fontFamily: 'monospace' }}>{fmtDateTime(o.created_at)}</div>
        {showActions ? (
          <div style={{ display: 'flex', gap: '0.3rem', justifyContent: 'flex-end' }}>
            <button onClick={() => act(o.id, 'approved')} disabled={acting === o.id}
              style={{ padding: '0.3rem 0.65rem', background: 'rgba(78,202,153,0.1)', border: '1px solid rgba(78,202,153,0.35)', color: '#4eca99', borderRadius: 4, cursor: 'pointer', fontSize: '0.68rem', fontWeight: 700, opacity: acting === o.id ? 0.5 : 1 }}>
              ✓ Approve
            </button>
            <button onClick={() => act(o.id, 'rejected')} disabled={acting === o.id}
              style={{ padding: '0.3rem 0.55rem', background: 'rgba(232,112,112,0.08)', border: '1px solid rgba(232,112,112,0.25)', color: '#e87070', borderRadius: 4, cursor: 'pointer', fontSize: '0.68rem', fontWeight: 700, opacity: acting === o.id ? 0.5 : 1 }}>
              ✗
            </button>
          </div>
        ) : (
          <div style={{ textAlign: 'right' }}>
            {pill(o.approval_status.replace('_', ' '), APPROVAL_COLOR[o.approval_status])}
          </div>
        )}
      </div>
    )
  }

  const colHeader = (showActions?: boolean) => (
    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 1fr 0.8fr 0.8fr 0.8fr 0.8fr' + (showActions ? ' 7rem' : ' 6rem'), gap: '0.5rem', padding: '0.35rem 1rem', fontSize: '0.58rem', color: T.dimmer, textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <span>Symbol</span><span style={{ textAlign: 'right' }}>Type</span><span style={{ textAlign: 'right' }}>Contract</span><span style={{ textAlign: 'right' }}>Qty</span><span style={{ textAlign: 'right' }}>Limit</span><span style={{ textAlign: 'right' }}>Status</span><span style={{ textAlign: 'right' }}>Created</span>{showActions ? <span /> : <span style={{ textAlign: 'right' }}>Approval</span>}
    </div>
  )

  return (
    <>
      {error && <div style={{ margin: '0.5rem 0', padding: '0.5rem 1rem', background: 'rgba(232,112,112,0.08)', border: '1px solid rgba(232,112,112,0.2)', borderRadius: 5, fontSize: '0.75rem', color: '#e87070' }}>{error}</div>}

      <Section title={`Awaiting Approval · ${pending.length}`}>
        {pending.length === 0
          ? <div style={{ padding: '1rem', color: T.dimmer, fontSize: '0.82rem' }}>No orders awaiting approval</div>
          : <>{colHeader(true)}{pending.map(o => <OrderRow key={o.id} o={o} showActions />)}</>
        }
      </Section>

      <Section title="Recent Orders">
        {recent.length === 0
          ? <div style={{ padding: '1rem', color: T.dimmer, fontSize: '0.82rem' }}>No orders</div>
          : <>{colHeader()}{recent.map(o => <OrderRow key={o.id} o={o} />)}</>
        }
      </Section>
    </>
  )
}

// ─── Trade Log tab ────────────────────────────────────────────────────────────

function TradeLogTab({ trades }: { trades: TradeLog[] }) {
  const totalPnl = trades.reduce((s, t) => s + (t.pnl ?? 0), 0)
  const totalComm = trades.reduce((s, t) => s + (t.commission ?? 0), 0)

  return (
    <Section title={`Trade Log · ${trades.length} entries`}
      action={<div style={{ display: 'flex', gap: '1.5rem' }}>
        <span style={{ fontSize: '0.68rem', color: T.dimmer }}>Total P&L: <strong style={{ color: totalPnl >= 0 ? '#4eca99' : '#e87070', fontFamily: 'monospace' }}>{fmtCurrency(totalPnl)}</strong></span>
        <span style={{ fontSize: '0.68rem', color: T.dimmer }}>Commission: <strong style={{ color: T.dim, fontFamily: 'monospace' }}>{fmtCurrency(totalComm)}</strong></span>
      </div>}
    >
      {/* Header */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 0.7fr 1.2fr 0.7fr 0.7fr 0.7fr 0.8fr 0.7fr', gap: '0.5rem', padding: '0.35rem 1rem', fontSize: '0.58rem', color: T.dimmer, textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <span>Symbol</span><span>Type</span><span>Contract</span><span style={{ textAlign: 'right' }}>Fill</span><span style={{ textAlign: 'right' }}>Value</span><span style={{ textAlign: 'right' }}>P&L</span><span style={{ textAlign: 'right' }}>Cum P&L</span><span style={{ textAlign: 'right' }}>Date</span>
      </div>
      {trades.slice(0, 50).map(t => (
        <div key={t.id} style={{ display: 'grid', gridTemplateColumns: '1fr 0.7fr 1.2fr 0.7fr 0.7fr 0.7fr 0.8fr 0.7fr', gap: '0.5rem', padding: '0.5rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.03)', alignItems: 'center' }}>
          <div>
            <span style={{ fontWeight: 700, color: T.cream, fontFamily: 'monospace', fontSize: '0.82rem' }}>{t.symbol}</span>
          </div>
          <div style={{ fontSize: '0.72rem' }}>
            {t.action && pill(t.action.toUpperCase(), t.action === 'sell' ? '#4eca99' : '#e87070')}
          </div>
          <div style={{ fontSize: '0.68rem', color: T.dim, fontFamily: 'monospace' }}>
            {t.option_symbol ?? t.trade_type}
            {t.option_strike && <span style={{ color: T.dimmer }}> ${t.option_strike}</span>}
            {t.option_expiry && <span style={{ color: T.dimmer }}> {fmtDate(t.option_expiry)}</span>}
          </div>
          <div style={{ textAlign: 'right', fontSize: '0.75rem', color: T.dim, fontFamily: 'monospace' }}>{t.fill_price ? `$${t.fill_price}` : '—'}</div>
          <div style={{ textAlign: 'right', fontSize: '0.75rem', color: T.dim, fontFamily: 'monospace' }}>{fmtCurrency(t.total_value)}</div>
          <div style={{ textAlign: 'right', fontSize: '0.75rem', fontWeight: 600, color: t.pnl == null ? T.dimmer : t.pnl >= 0 ? '#4eca99' : '#e87070', fontFamily: 'monospace' }}>{fmtCurrency(t.pnl)}</div>
          <div style={{ textAlign: 'right', fontSize: '0.75rem', color: t.cumulative_pnl == null ? T.dimmer : t.cumulative_pnl >= 0 ? '#4eca99' : '#e87070', fontFamily: 'monospace' }}>{fmtCurrency(t.cumulative_pnl)}</div>
          <div style={{ textAlign: 'right', fontSize: '0.65rem', color: T.dimmer, fontFamily: 'monospace' }}>{fmtDateTime(t.logged_at)}</div>
        </div>
      ))}
    </Section>
  )
}

// ─── Scanner tab ──────────────────────────────────────────────────────────────

function ScannerTab({ runs }: { runs: ScannerRun[] }) {
  const latest = runs[0]

  return (
    <>
      {/* Latest run summary */}
      {latest && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', padding: '0.75rem 1rem', background: 'var(--navy2)', border: '1px solid var(--dash-border)', borderRadius: 8, marginBottom: '1rem' }}>
          {[
            { label: 'Last Run',       value: fmtDateTime(latest.run_at) },
            { label: 'Scanned',        value: String(latest.tickers_scanned) },
            { label: 'Passed Filter',  value: String(latest.tickers_passed) },
            { label: 'Status',         value: latest.status },
          ].map(({ label, value }) => (
            <div key={label}>
              <div style={{ fontSize: '0.58rem', color: T.dimmer, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</div>
              <div style={{ fontSize: '0.88rem', fontWeight: 600, color: T.cream, marginTop: 2 }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {latest?.candidates?.length > 0 && (
        <Section title={`Latest Candidates · ${latest.candidates.length}`}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr 1fr', gap: '0.5rem', padding: '0.35rem 1rem', fontSize: '0.58rem', color: T.dimmer, textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <span>Symbol</span><span style={{ textAlign: 'right' }}>Price</span><span style={{ textAlign: 'right' }}>Strike</span><span style={{ textAlign: 'right' }}>Expiry</span><span style={{ textAlign: 'right' }}>Premium</span><span style={{ textAlign: 'right' }}>Delta</span>
          </div>
          {latest.candidates.map((c: any, i: number) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr 1fr', gap: '0.5rem', padding: '0.5rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.03)', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, color: T.gold, fontFamily: 'monospace' }}>{c.symbol ?? c.ticker}</span>
              <span style={{ textAlign: 'right', fontSize: '0.78rem', color: T.dim, fontFamily: 'monospace' }}>{c.price ? `$${c.price}` : '—'}</span>
              <span style={{ textAlign: 'right', fontSize: '0.78rem', color: T.cream, fontFamily: 'monospace' }}>{c.strike ? `$${c.strike}` : '—'}</span>
              <span style={{ textAlign: 'right', fontSize: '0.75rem', color: T.dim, fontFamily: 'monospace' }}>{c.expiry ? fmtDate(c.expiry) : '—'}</span>
              <span style={{ textAlign: 'right', fontSize: '0.78rem', color: '#4eca99', fontFamily: 'monospace' }}>{c.premium ? `$${c.premium}` : '—'}</span>
              <span style={{ textAlign: 'right', fontSize: '0.75rem', color: T.dim, fontFamily: 'monospace' }}>{c.delta ? c.delta.toFixed(2) : '—'}</span>
            </div>
          ))}
        </Section>
      )}

      <Section title={`Scanner History · ${runs.length} runs`}>
        {runs.slice(0, 20).map(r => (
          <div key={r.id} style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', padding: '0.5rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
            <span style={{ fontSize: '0.72rem', color: T.dimmer, fontFamily: 'monospace', minWidth: 130 }}>{fmtDateTime(r.run_at)}</span>
            <span style={{ fontSize: '0.72rem', color: T.dim }}>Scanned <strong style={{ color: T.cream }}>{r.tickers_scanned}</strong></span>
            <span style={{ fontSize: '0.72rem', color: T.dim }}>Passed <strong style={{ color: '#4eca99' }}>{r.tickers_passed}</strong></span>
            {pill(r.status, r.status === 'ok' ? '#4eca99' : '#e87070')}
            {r.error_msg && <span style={{ fontSize: '0.68rem', color: '#e87070' }}>{r.error_msg}</span>}
          </div>
        ))}
      </Section>
    </>
  )
}

// ─── Watchlist tab ────────────────────────────────────────────────────────────

function WatchlistTab({ entries, onRefresh }: { entries: WatchlistEntry[]; onRefresh: () => void }) {
  const [toggling, setToggling] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [newSymbol, setNewSymbol] = useState('')
  const [adding,   setAdding]   = useState(false)
  const supabase = createClient()

  async function toggleEnabled(id: string, current: boolean) {
    setToggling(id)
    await supabase.from('options_watchlist').update({ enabled: !current }).eq('id', id)
    onRefresh(); setToggling(null)
  }

  async function remove(id: string) {
    setRemoving(id)
    await supabase.from('options_watchlist').delete().eq('id', id)
    onRefresh(); setRemoving(null)
  }

  async function addSymbol() {
    if (!newSymbol.trim()) return
    setAdding(true)
    await supabase.from('options_watchlist').insert({ symbol: newSymbol.trim().toUpperCase(), enabled: true })
    setNewSymbol(''); onRefresh(); setAdding(false)
  }

  return (
    <Section title={`Options Watchlist · ${entries.length}`}
      action={
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <input value={newSymbol} onChange={e => setNewSymbol(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && addSymbol()}
            placeholder="AAPL" maxLength={10}
            style={{ width: 80, padding: '0.3rem 0.5rem', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, color: 'var(--cream)', fontSize: '0.75rem', outline: 'none' }} />
          <button onClick={addSymbol} disabled={adding || !newSymbol.trim()}
            style={{ padding: '0.3rem 0.65rem', background: 'rgba(200,169,110,0.1)', border: '1px solid rgba(200,169,110,0.3)', color: 'var(--gold)', borderRadius: 4, cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600 }}>
            + Add
          </button>
        </div>
      }
    >
      {entries.length === 0
        ? <div style={{ padding: '1rem', color: T.dimmer, fontSize: '0.82rem' }}>No symbols on options watchlist. Add a symbol to start scanning for CSP candidates.</div>
        : entries.map(e => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', padding: '0.6rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <button onClick={() => toggleEnabled(e.id, e.enabled)} disabled={toggling === e.id}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', opacity: toggling === e.id ? 0.4 : 1 }}
                title={e.enabled ? 'Disable' : 'Enable'}>
                {e.enabled ? '🟢' : '⚫'}
              </button>
              <a href={`/dashboard/tickers/${e.symbol}`}
                style={{ fontWeight: 700, color: T.gold, fontFamily: 'monospace', fontSize: '0.9rem', textDecoration: 'none', minWidth: 60 }}>
                {e.symbol}
              </a>
              <span style={{ fontSize: '0.72rem', color: T.dimmer, flex: 1 }}>{e.notes ?? ''}</span>
              <span style={{ fontSize: '0.65rem', color: T.dimmer, fontFamily: 'monospace' }}>{fmtDate(e.added_at)}</span>
              <button onClick={() => remove(e.id)} disabled={removing === e.id}
                style={{ background: 'none', border: 'none', color: T.dimmer, cursor: 'pointer', fontSize: '1rem', opacity: removing === e.id ? 0.4 : 1 }}>×</button>
            </div>
          ))
      }
    </Section>
  )
}

// ─── Alerts tab ───────────────────────────────────────────────────────────────

function AlertsTab({ alerts }: { alerts: any[] }) {
  const LEVEL_COLOR: Record<string, string> = { info: '#7ab4e8', warning: '#e0c97a', critical: '#e87070' }

  return (
    <Section title={`Options Alerts · ${alerts.length}`}>
      {alerts.length === 0
        ? <div style={{ padding: '1rem', color: T.dimmer, fontSize: '0.82rem' }}>No alerts</div>
        : alerts.slice(0, 50).map(a => (
            <div key={a.id} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', padding: '0.7rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: LEVEL_COLOR[a.level] ?? T.dimmer, marginTop: 5, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: T.cream }}>{a.title}</div>
                <div style={{ fontSize: '0.72rem', color: T.dim, marginTop: 2, lineHeight: 1.5 }}>{a.body}</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                {pill(a.level, LEVEL_COLOR[a.level] ?? T.dimmer)}
                <div style={{ fontSize: '0.62rem', color: T.dimmer, marginTop: 3 }}>{fmtDateTime(a.created_at)}</div>
                {a.sent && <div style={{ fontSize: '0.6rem', color: '#4eca99', marginTop: 1 }}>✓ sent</div>}
              </div>
            </div>
          ))
      }
    </Section>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function OptionsPage() {
  const [tab,       setTab]       = useState<Tab>('positions')
  const [positions, setPositions] = useState<Position[]>([])
  const [orders,    setOrders]    = useState<Order[]>([])
  const [trades,    setTrades]    = useState<TradeLog[]>([])
  const [scanner,   setScanner]   = useState<ScannerRun[]>([])
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([])
  const [alerts,    setAlerts]    = useState<any[]>([])
  const [loading,   setLoading]   = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const supabase = createClient()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [posRes, ordRes, trdRes, scnRes, wlRes, altRes] = await Promise.all([
        supabase.from('positions').select('*').order('opened_at', { ascending: false }),
        supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(100),
        supabase.from('trade_log').select('*').order('logged_at', { ascending: false }).limit(200),
        supabase.from('scanner_runs').select('*').order('run_at', { ascending: false }).limit(20),
        supabase.from('options_watchlist').select('*').order('added_at', { ascending: false }),
        supabase.from('options_alerts').select('*').order('created_at', { ascending: false }).limit(50),
      ])
      setPositions(posRes.data ?? [])
      setOrders(ordRes.data ?? [])
      setTrades(trdRes.data ?? [])
      setScanner(scnRes.data ?? [])
      setWatchlist(wlRes.data ?? [])
      setAlerts(altRes.data ?? [])
      setLastRefresh(new Date())
    } catch {}
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // Auto-refresh every 30s
  useEffect(() => {
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [load])

  const pendingCount = orders.filter(o => o.order_status === 'awaiting_approval').length

  return (
    <div>
      {/* Page header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: T.cream, margin: 0 }}>Options Wheel</h1>
          <div style={{ fontSize: '0.72rem', color: T.dimmer, marginTop: 3 }}>
            Cash-Secured Put → Assignment → Covered Call · IB Gateway
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '0.65rem', color: T.dimmer, fontFamily: 'monospace' }}>
            Updated {lastRefresh.toLocaleTimeString()}
          </span>
          <button onClick={load} disabled={loading}
            style={{ padding: '0.35rem 0.85rem', background: 'rgba(200,169,110,0.08)', border: '1px solid rgba(200,169,110,0.25)', color: T.gold, borderRadius: 5, cursor: loading ? 'wait' : 'pointer', fontSize: '0.72rem', opacity: loading ? 0.6 : 1 }}>
            {loading ? 'Loading…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--dash-border)', marginBottom: '1.25rem', overflowX: 'auto' }}>
        {TABS.map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '0.45rem 1rem', background: 'transparent', border: 'none', borderBottom: `2px solid ${tab === t ? 'var(--gold)' : 'transparent'}`, color: tab === t ? 'var(--gold)' : T.dimmer, fontSize: '0.78rem', fontWeight: tab === t ? 600 : 400, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s', flexShrink: 0, position: 'relative' }}>
            {label}
            {t === 'approvals' && pendingCount > 0 && (
              <span style={{ position: 'absolute', top: 6, right: 4, background: '#e87070', color: '#fff', borderRadius: 8, fontSize: '0.55rem', fontWeight: 700, padding: '0 4px', lineHeight: '14px', minWidth: 14, textAlign: 'center' }}>
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {loading && positions.length === 0 ? (
        <div style={{ color: T.dimmer, fontSize: '0.82rem', padding: '2rem 0' }}>Loading…</div>
      ) : (
        <>
          {tab === 'positions'  && <PositionsTab positions={positions} onRefresh={load} />}
          {tab === 'approvals'  && <ApprovalsTab orders={orders} onRefresh={load} />}
          {tab === 'tradelog'   && <TradeLogTab trades={trades} />}
          {tab === 'scanner'    && <ScannerTab runs={scanner} />}
          {tab === 'watchlist'  && <WatchlistTab entries={watchlist} onRefresh={load} />}
          {tab === 'alerts'     && <AlertsTab alerts={alerts} />}
        </>
      )}
    </div>
  )
}
