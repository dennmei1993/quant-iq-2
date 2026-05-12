'use client'

// src/app/dashboard/HomeClient.tsx
// Overview page — content area only (sidebar owned by layout).
// Fetches portfolio data client-side so it stays live.
// Full detail at /dashboard/portfolio.

import { useState, useEffect, useCallback } from 'react'
import { PortfolioPerformanceChart } from '@/components/dashboard/PortfolioPerformanceChart'
import { useRouter } from 'next/navigation'
import {
  computeCapitalMetrics,
  type PortfolioCapitalMetrics,
} from '@/types/portfolio-preferences'
import type {
  Regime,
  HomeTheme,
  PortfolioAlert,
} from './page'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Portfolio {
  id:            string
  name:          string
  total_capital: number
  cash_pct:      number
  universe:      string[]
}

interface Holding {
  id:            string
  ticker:        string
  name:          string | null
  quantity:      number | null
  avg_cost:      number | null
  realised_gain: number
  signal: {
    signal:     string
    price_usd:  number | null
    change_pct: number | null
  } | null
}

interface Props {
  regime:      Regime | null
  themes:      HomeTheme[]
  portfolios:  Portfolio[]
  latestAlert: PortfolioAlert | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCurrency(v: number): string {
  const sign = v < 0 ? '-' : ''
  const abs  = Math.abs(v)
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(1)}K`
  return `${sign}$${abs.toFixed(0)}`
}

function fmtPct(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

function signCol(v: number | null): string {
  if (v == null) return 'var(--text-4)'
  return v >= 0 ? 'var(--signal-bull)' : 'var(--signal-bear)'
}

const SIG_COLOR: Record<string, string> = {
  buy:   'var(--signal-bull)',
  watch: 'var(--signal-neut)',
  hold:  'var(--text-4)',
  avoid: 'var(--signal-bear)',
}

// ── Inline transaction history ────────────────────────────────────────────────
// Renders open by default (controlled externally by Hist button).
// Has its own − toggle to collapse without closing the whole panel.

interface TxRow {
  id:           string
  type:         string
  quantity:     number
  price:        number
  total_amount: number
  fees:         number
  executed_at:  string
  notes:        string | null
}

function InlineTransactionHistory({
  portfolioId, ticker, avgCost, onDelete, onClose,
}: {
  portfolioId: string
  ticker:      string
  avgCost:     number | null
  onDelete:    () => void
  onClose:     () => void
}) {
  const [rows,     setRows]     = useState<TxRow[]>([])
  const [loading,  setLoading]  = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/portfolio/transaction?portfolio_id=${portfolioId}&ticker=${ticker}&limit=50`)
      .then(r => r.json())
      .then(d => { setRows(d.transactions ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [portfolioId, ticker])

  async function handleDelete(txId: string) {
    setDeleting(txId)
    await fetch(`/api/portfolio/transaction?id=${txId}`, { method: 'DELETE' })
    setRows(prev => prev.filter(r => r.id !== txId))
    setDeleting(null)
    onDelete()
  }

  const typeCol = (t: string) => t === 'buy' ? 'var(--signal-bull)' : 'var(--signal-bear)'

  return (
    <tr>
      <td colSpan={9} style={{ padding: 0, background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ padding: '8px 14px' }}>

          {/* Header row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 'var(--fs-label)', fontWeight: 500, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Transaction history — {ticker}
            </span>
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-4)', fontSize: 14, lineHeight: 1, padding: '0 2px' }}
              title="Close"
            >−</button>
          </div>

          {loading ? (
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-4)', padding: '4px 0' }}>Loading…</div>
            ) : rows.length === 0 ? (
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-4)', padding: '4px 0' }}>No transactions recorded.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Type', 'Qty', 'Price', 'Total', 'Fees', 'Date', 'Notes', ''].map((h, i) => (
                      <th key={i} style={{ fontSize: 'var(--fs-label)', fontWeight: 500, color: 'var(--text-4)', textAlign: i === 0 ? 'left' : 'right', padding: '2px 6px 5px', letterSpacing: '0.04em', textTransform: 'uppercase', borderBottom: '1px solid var(--border)' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '5px 6px', fontSize: 'var(--fs-sm)', fontWeight: 600, color: typeCol(r.type), textTransform: 'uppercase' }}>{r.type}</td>
                      <td style={{ padding: '5px 6px', fontSize: 'var(--fs-sm)', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{Number(r.quantity).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                      <td style={{ padding: '5px 6px', fontSize: 'var(--fs-sm)', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>${Number(r.price).toFixed(2)}</td>
                      <td style={{ padding: '5px 6px', fontSize: 'var(--fs-sm)', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>${Number(r.total_amount).toFixed(2)}</td>
                      <td style={{ padding: '5px 6px', fontSize: 'var(--fs-sm)', textAlign: 'right', color: 'var(--text-4)' }}>{r.fees > 0 ? `$${r.fees.toFixed(2)}` : '—'}</td>
                      <td style={{ padding: '5px 6px', fontSize: 'var(--fs-sm)', textAlign: 'right', color: 'var(--text-3)' }}>
                        {new Date(r.executed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
                      </td>
                      <td style={{ padding: '5px 6px', fontSize: 'var(--fs-sm)', textAlign: 'right', color: 'var(--text-4)' }}>{r.notes ?? '—'}</td>
                      <td style={{ padding: '5px 6px', textAlign: 'right' }}>
                        <button
                          onClick={() => handleDelete(r.id)}
                          disabled={deleting === r.id}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-4)', fontSize: 12, opacity: deleting === r.id ? 0.4 : 1 }}
                          title="Delete transaction"
                        >×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </div>
      </td>
    </tr>
  )
}

// ── Portfolio settings modal ──────────────────────────────────────────────────

type PortfolioPrefs = {
  name:                  string
  total_capital:         number
  cash_pct:              number
  risk_appetite:         string
  investment_horizon:    string
  benchmark:             string
  target_holdings:       number
  preferred_assets:      string[]
  universe:              string[]
  sector_exclude:        string[]
  options_enabled:       boolean
  options_capital_pct:   number
  options_strategies:    string[]
  moomoo_account:        string | null
  moomoo_password:       string | null
}

function PortfolioSettingsModal({ portfolioId, onClose }: { portfolioId: string; onClose: () => void }) {
  const [prefs,   setPrefs]   = useState<PortfolioPrefs | null>(null)
  const [local,   setLocal]   = useState<Partial<PortfolioPrefs>>({})
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/portfolio?portfolio_id=${portfolioId}`)
      .then(r => r.json())
      .then(d => {
        const p = d.portfolio ?? d.portfolios?.[0]
        if (p) setPrefs(p)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [portfolioId])

  const current = prefs ? { ...prefs, ...local } : null
  const isDirty = Object.keys(local).length > 0

  function set<K extends keyof PortfolioPrefs>(key: K, value: PortfolioPrefs[K]) {
    setLocal(prev => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  async function save() {
    if (!isDirty) return
    setSaving(true)
    await fetch('/api/portfolio', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ portfolio_id: portfolioId, ...local }),
    })
    setPrefs(p => p ? { ...p, ...local } : p)
    setLocal({})
    setSaving(false)
    onClose()
  }

  const pill = (active: boolean): React.CSSProperties => ({
    padding: '3px 10px',
    background: active ? 'var(--bg-subtle)' : 'none',
    border: `1px solid ${active ? 'var(--text-3)' : 'var(--border)'}`,
    color: active ? 'var(--text)' : 'var(--text-4)',
    borderRadius: 'var(--r-pill)', fontSize: 'var(--fs-sm)',
    fontWeight: active ? 500 : 400, cursor: 'pointer',
    transition: 'all 0.1s', fontFamily: 'inherit',
  })

  const labelStyle: React.CSSProperties = {
    fontSize: 'var(--fs-label)', color: 'var(--text-4)',
    textTransform: 'uppercase', letterSpacing: '0.08em',
    display: 'block', marginBottom: 5,
  }

  const inputStyle: React.CSSProperties = {
    padding: '5px 8px', background: 'var(--bg-subtle)',
    border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
    color: 'var(--text)', fontSize: 'var(--fs-sm)', outline: 'none',
    width: '100%', fontFamily: 'inherit',
  }

  const ASSET_TYPES  = ['equities', 'etf', 'crypto', 'commodities', 'bonds', 'fx', 'options']
  const UNIVERSE_IDS = [
    { id: 'mag7',                label: 'Mag 7',            group: 'index' },
    { id: 'sp500',               label: 'S&P 500',          group: 'index' },
    { id: 'nasdaq100',           label: 'Nasdaq 100',       group: 'index' },
    { id: 'asx200',              label: 'ASX 200',          group: 'index' },
    { id: 'berkshire',           label: 'Berkshire',        group: 'institutional' },
    { id: 'dividend_aristocrats',label: 'Div. Aristocrats', group: 'institutional' },
    { id: '13F',                 label: '13F Filings',      group: 'institutional' },
    { id: 'POLITICIAN',          label: 'Politician trades',group: 'institutional' },
  ]
  const OPTIONS_STRATEGIES = [
    { id: 'wheel',    label: 'Wheel',     desc: 'Sell CSP → take assignment → sell CC' },
    { id: 'pmcc',     label: 'PMCC',      desc: 'Poor Mans Covered Call' },
    { id: 'csp',      label: 'Cash-secured put', desc: 'Sell puts on stocks you want to own' },
    { id: 'cc',       label: 'Covered call',     desc: 'Sell calls against existing shares' },
    { id: 'strangle', label: 'Strangle',  desc: 'Sell OTM call + OTM put' },
    { id: 'iron_condor', label: 'Iron condor', desc: 'Defined-risk range-bound strategy' },
    { id: 'jade_lizard', label: 'Jade lizard', desc: 'Short put + short call spread' },
    { id: 'leaps',       label: 'LEAPs',       desc: 'Long-dated options as stock replacement' },
  ]
  const SECTORS = ['Technology','Healthcare','Financials','Energy','Industrials','Consumer','Materials','Utilities','Real Estate','Communications','Defence']

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.4)' }} />
      <div onClick={e => e.stopPropagation()} style={{
        position: 'fixed', top: '50%', left: '50%',
        transform: 'translate(-50%,-50%)',
        zIndex: 201, background: 'var(--bg)',
        border: '1px solid var(--border)', borderRadius: 8,
        padding: '1.4rem', width: 580, maxHeight: '85vh',
        overflowY: 'auto', boxShadow: '0 16px 48px rgba(0,0,0,0.15)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.2rem' }}>
          <div>
            <div style={{ ...labelStyle, marginBottom: 2 }}>Portfolio settings</div>
            <div style={{ fontSize: 'var(--fs-heading)', fontWeight: 500, color: 'var(--text)' }}>
              {current?.name ?? '—'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1 }}>×</button>
        </div>

        {loading || !current ? (
          <div style={{ color: 'var(--text-4)', fontSize: 'var(--fs-sm)', padding: '1rem 0' }}>Loading…</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

            {/* Name */}
            <div>
              <label style={labelStyle}>Portfolio name</label>
              <input value={current.name} onChange={e => set('name', e.target.value)} style={inputStyle} />
            </div>

            {/* Capital + Cash reserve */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
              <div>
                <label style={labelStyle}>Total capital ($)</label>
                <input
                  value={current.total_capital || ''}
                  onChange={e => set('total_capital', parseFloat(e.target.value) || 0)}
                  type="number" placeholder="50000" style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Min cash reserve</label>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {[0, 5, 10, 15, 20].map(n => (
                    <button key={n} onClick={() => set('cash_pct', n)} style={pill(current.cash_pct === n)}>{n}%</button>
                  ))}
                </div>
              </div>
            </div>

            {/* Risk + Horizon */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
              <div>
                <label style={labelStyle}>Risk appetite</label>
                <div style={{ display: 'flex', gap: 4 }}>
                  {(['aggressive','moderate','conservative'] as const).map(a => (
                    <button key={a} onClick={() => set('risk_appetite', a)} style={pill(current.risk_appetite === a)}>
                      {a.charAt(0).toUpperCase() + a.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label style={labelStyle}>Horizon</label>
                <div style={{ display: 'flex', gap: 4 }}>
                  {(['short','medium','long'] as const).map(h => (
                    <button key={h} onClick={() => set('investment_horizon', h)} style={pill(current.investment_horizon === h)}>
                      {h.charAt(0).toUpperCase() + h.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Benchmark + Target holdings */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
              <div>
                <label style={labelStyle}>Benchmark</label>
                <div style={{ display: 'flex', gap: 4 }}>
                  {['SPY','QQQ','AXJO'].map(b => (
                    <button key={b} onClick={() => set('benchmark', b)} style={pill(current.benchmark === b)}>{b}</button>
                  ))}
                </div>
              </div>
              <div>
                <label style={labelStyle}>Target holdings</label>
                <div style={{ display: 'flex', gap: 4 }}>
                  {[10,15,20,30].map(n => (
                    <button key={n} onClick={() => set('target_holdings', n)} style={pill(current.target_holdings === n)}>{n}</button>
                  ))}
                </div>
              </div>
            </div>

            {/* Asset types */}
            <div>
              <label style={labelStyle}>Preferred asset types</label>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {ASSET_TYPES.map(a => {
                  const active = current.preferred_assets?.includes(a)
                  const next   = active ? current.preferred_assets.filter(x => x !== a) : [...(current.preferred_assets ?? []), a]
                  return <button key={a} onClick={() => set('preferred_assets', next)} style={pill(!!active)}>{a.charAt(0).toUpperCase() + a.slice(1)}</button>
                })}
              </div>
            </div>

            {/* Universe */}
            <div>
              <label style={labelStyle}>Stock universe</label>
              <div style={{ marginBottom: 4 }}>
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)' }}>Index</span>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 3 }}>
                  {UNIVERSE_IDS.filter(u => u.group === 'index').map(({ id, label }) => {
                    const active = current.universe?.includes(id)
                    const next   = active ? current.universe.filter(x => x !== id) : [...(current.universe ?? []), id]
                    return <button key={id} onClick={() => set('universe', next)} style={pill(!!active)}>{label}</button>
                  })}
                </div>
              </div>
              <div style={{ marginTop: 6 }}>
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)' }}>Institutional / smart money</span>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 3 }}>
                  {UNIVERSE_IDS.filter(u => u.group === 'institutional').map(({ id, label }) => {
                    const active = current.universe?.includes(id)
                    const next   = active ? current.universe.filter(x => x !== id) : [...(current.universe ?? []), id]
                    return <button key={id} onClick={() => set('universe', next)} style={pill(!!active)}>{label}</button>
                  })}
                </div>
              </div>
            </div>

            {/* Excluded sectors */}
            <div>
              <label style={labelStyle}>Excluded sectors</label>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {SECTORS.map(s => {
                  const active = current.sector_exclude?.includes(s)
                  const next   = active ? current.sector_exclude.filter(x => x !== s) : [...(current.sector_exclude ?? []), s]
                  return <button key={s} onClick={() => set('sector_exclude', next)} style={pill(!!active)}>{s}</button>
                })}
              </div>
            </div>

            {/* Options trading */}
            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
              {/* Options header toggle */}
              <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: current.options_enabled ? 'var(--bg-subtle)' : 'var(--bg)' }}>
                <div>
                  <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 500, color: 'var(--text)' }}>Options trading</div>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', marginTop: 1 }}>Allocate capital and select strategies</div>
                </div>
                <button
                  onClick={() => set('options_enabled', !current.options_enabled)}
                  style={{
                    width: 36, height: 20, borderRadius: 99,
                    background: current.options_enabled ? 'var(--accent)' : 'var(--border)',
                    border: 'none', cursor: 'pointer', position: 'relative', transition: 'background 0.2s',
                    flexShrink: 0,
                  }}
                >
                  <span style={{
                    position: 'absolute', top: 2,
                    left: current.options_enabled ? 18 : 2,
                    width: 16, height: 16, borderRadius: '50%',
                    background: 'white', transition: 'left 0.2s',
                  }} />
                </button>
              </div>

              {current.options_enabled && (
                <div style={{ padding: '12px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>

                  {/* Capital allocation */}
                  <div>
                    <label style={labelStyle}>Capital allocation for options</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="range" min={0} max={50} step={5}
                        value={current.options_capital_pct ?? 10}
                        onChange={e => set('options_capital_pct', parseInt(e.target.value))}
                        style={{ flex: 1, accentColor: 'var(--accent)' }}
                      />
                      <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 500, color: 'var(--text)', minWidth: 32, textAlign: 'right' }}>
                        {current.options_capital_pct ?? 10}%
                      </span>
                    </div>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', marginTop: 3 }}>
                      {current.total_capital > 0
                        ? `$${((current.total_capital * (current.options_capital_pct ?? 10)) / 100).toLocaleString()} of total capital`
                        : 'Set total capital to see amount'}
                    </div>
                  </div>

                  {/* Strategies */}
                  <div>
                    <label style={labelStyle}>Preferred strategies</label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {OPTIONS_STRATEGIES.map(({ id, label, desc }) => {
                        const active = current.options_strategies?.includes(id)
                        const next   = active
                          ? (current.options_strategies ?? []).filter(x => x !== id)
                          : [...(current.options_strategies ?? []), id]
                        return (
                          <button
                            key={id}
                            onClick={() => set('options_strategies', next)}
                            style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              padding: '6px 10px', borderRadius: 'var(--r-md)', cursor: 'pointer',
                              background: active ? 'var(--bg-subtle)' : 'none',
                              border: `1px solid ${active ? 'var(--text-3)' : 'var(--border)'}`,
                              transition: 'all 0.1s', fontFamily: 'inherit', textAlign: 'left',
                            }}
                          >
                            <div>
                              <span style={{ fontSize: 'var(--fs-sm)', fontWeight: active ? 500 : 400, color: active ? 'var(--text)' : 'var(--text-3)' }}>{label}</span>
                              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', marginLeft: 8 }}>{desc}</span>
                            </div>
                            {active && <span style={{ fontSize: 10, color: 'var(--accent)' }}>✓</span>}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Moomoo integration */}
            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
              <div style={{ padding: '8px 12px', background: current.moomoo_account ? 'rgba(21,128,61,0.04)' : 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 500, color: 'var(--text)' }}>Moomoo account</div>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', marginTop: 1 }}>
                    {current.moomoo_account
                      ? `Connected — account ${current.moomoo_account}`
                      : 'Not linked — holdings managed manually'}
                  </div>
                </div>
                {current.moomoo_account && (
                  <span style={{ fontSize: 'var(--fs-xs)', padding: '1px 7px', borderRadius: 'var(--r-pill)', background: 'rgba(21,128,61,0.1)', border: '1px solid rgba(21,128,61,0.25)', color: 'var(--signal-bull)', fontWeight: 500 }}>
                    ● Linked
                  </span>
                )}
              </div>
              <div style={{ padding: '12px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <label style={labelStyle}>Account number</label>
                    <input
                      value={current.moomoo_account ?? ''}
                      onChange={e => set('moomoo_account', e.target.value || null)}
                      placeholder="e.g. 123456"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Password / PIN</label>
                    <input
                      type="password"
                      value={current.moomoo_password ?? ''}
                      onChange={e => set('moomoo_password', e.target.value || null)}
                      placeholder="Trading password"
                      style={inputStyle}
                    />
                  </div>
                </div>
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', lineHeight: 1.5 }}>
                  When linked, holdings are synced from your Moomoo account automatically. Leave blank to manage holdings manually.
                </div>
                {current.moomoo_account && (
                  <button
                    onClick={async () => {
                      if (!portfolioId) return
                      try {
                        const res  = await fetch(`/api/portfolio/sync?portfolio_id=${portfolioId}`, { method: 'POST' })
                        const data = await res.json()
                        alert(data.message ?? 'Sync complete')
                      } catch {
                        alert('Sync failed — check broker bridge is running')
                      }
                    }}
                    style={{ padding: '5px 14px', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-3)', fontSize: 'var(--fs-sm)', cursor: 'pointer', fontFamily: 'inherit', alignSelf: 'flex-start' }}
                  >
                    Sync now ↗
                  </button>
                )}
              </div>
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border)', marginTop: '0.25rem' }}>
              <button onClick={save} disabled={!isDirty || saving} className="btn btn-dark"
                style={{ opacity: !isDirty || saving ? 0.5 : 1, cursor: !isDirty ? 'default' : 'pointer' }}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
              {isDirty && !saving && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)' }}>Unsaved changes</span>}
              {saved && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--signal-bull)' }}>✓ Saved</span>}
              <button onClick={onClose} className="btn btn-outline" style={{ marginLeft: 'auto' }}>Close</button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function HomeClient({
  regime,
  themes,
  portfolios: initialPortfolios,
  latestAlert,
}: Props) {
  const router = useRouter()

  const [alertDismissed,   setAlertDismissed]   = useState(false)
  const [panelOpen,        setPanelOpen]         = useState(false)
  const [portfolios,       setPortfolios]        = useState<Portfolio[]>(initialPortfolios)
  const [activeId,         setActiveId]          = useState<string>(() => {
    if (typeof window === 'undefined') return initialPortfolios[0]?.id ?? ''
    const saved = sessionStorage.getItem('quant_iq_selected_portfolio')
    return (saved && initialPortfolios.find(p => p.id === saved)) ? saved : (initialPortfolios[0]?.id ?? '')
  })
  const [holdings,         setHoldings]          = useState<Holding[]>([])
  const [transactions,     setTransactions]      = useState<Array<{ type: string; total_amount: number; fees: number }>>([])
  const [loading,          setLoading]           = useState(false)

  // Transaction modal
  const [txModal,  setTxModal]  = useState<{ holdingId: string; ticker: string; currentQty: number } | null>(null)
  const [txType,   setTxType]   = useState<'buy' | 'sell'>('sell')
  const [txQty,    setTxQty]    = useState('')
  const [txPrice,  setTxPrice]  = useState('')
  const [txDate,   setTxDate]   = useState(new Date().toISOString().split('T')[0])
  const [txFees,   setTxFees]   = useState('')
  const [txNotes,  setTxNotes]  = useState('')
  const [txSaving, setTxSaving] = useState(false)
  const [txError,  setTxError]  = useState('')
  const [histOpen,     setHistOpen]     = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mounted,      setMounted]      = useState(false)

  // Broker state
  const [broker, setBroker] = useState<{
    connected: boolean
    mode: string
    auto_trading: boolean
    cash: number | null
    portfolio_value: number | null
    open_orders: number | null
  } | null>(null)

  const activePortfolio = portfolios.find(p => p.id === activeId) ?? portfolios[0] ?? null

  const loadPortfolioData = useCallback(async (portfolioId: string) => {
    setLoading(true)
    try {
      const [pRes, tRes] = await Promise.all([
        fetch(`/api/portfolio?portfolio_id=${portfolioId}`),
        fetch(`/api/portfolio/transaction?portfolio_id=${portfolioId}&limit=500`),
      ])
      const [pData, tData] = await Promise.all([pRes.json(), tRes.json()])
      setHoldings(pData.holdings ?? [])
      setTransactions(tData.transactions ?? [])
    } catch {
      setHoldings([])
      setTransactions([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeId) loadPortfolioData(activeId)
  }, [activeId, loadPortfolioData])

  // Set mounted after hydration to prevent SSR mismatch
  useEffect(() => { setMounted(true) }, [])

  // Poll broker bridge status every 30s — only when bridge is reachable
  useEffect(() => {
    async function fetchBroker() {
      try {
        const res  = await fetch('/api/broker/status', { signal: AbortSignal.timeout(3000) })
        const data = await res.json()
        // 503 = bridge offline (expected when not running) — show nothing
        // 500 = Vercel can't reach localhost — show nothing
        if (res.ok && !data.error) setBroker(data)
        else setBroker(null)
      } catch {
        // Bridge not running or unreachable — silently hide the status bar
        setBroker(null)
      }
    }
    fetchBroker()
    const interval = setInterval(fetchBroker, 30_000)
    return () => clearInterval(interval)
  }, [])

  // Sync when shell sidebar switches portfolio
  useEffect(() => {
    function onPortfolioChange() {
      const saved = sessionStorage.getItem('quant_iq_selected_portfolio')
      if (saved && saved !== activeId && portfolios.find(p => p.id === saved)) {
        setActiveId(saved)
      }
    }
    window.addEventListener('portfolio-changed', onPortfolioChange)
    return () => window.removeEventListener('portfolio-changed', onPortfolioChange)
  }, [activeId, portfolios])

  async function handleTransaction() {
    if (!txModal || !activeId) return
    const qty   = parseFloat(txQty)
    const price = parseFloat(txPrice)
    if (isNaN(qty) || qty <= 0)    { setTxError('Enter a valid quantity'); return }
    if (isNaN(price) || price < 0) { setTxError('Enter a valid price');    return }
    if (txType === 'sell' && qty > txModal.currentQty) {
      setTxError(`Cannot sell ${qty} — only ${txModal.currentQty} held`); return
    }
    setTxSaving(true); setTxError('')
    const res = await fetch('/api/portfolio/transaction', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        portfolio_id: activeId,
        ticker:       txModal.ticker,
        type:         txType,
        quantity:     qty,
        price,
        fees:         parseFloat(txFees) || 0,
        executed_at:  new Date(txDate).toISOString(),
        notes:        txNotes || undefined,
      }),
    })
    const d = await res.json()
    if (!res.ok) { setTxError(d.error ?? 'Failed'); setTxSaving(false); return }
    await loadPortfolioData(activeId)
    setTxModal(null)
    setTxQty(''); setTxPrice(''); setTxFees(''); setTxNotes('')
    setTxDate(new Date().toISOString().split('T')[0])
    setTxSaving(false)
  }


  const metrics: PortfolioCapitalMetrics | null = activePortfolio
    ? computeCapitalMetrics(
        activePortfolio.total_capital,
        holdings.map(h => ({
          ticker:        h.ticker,
          quantity:      h.quantity ?? 0,
          avg_cost:      h.avg_cost ?? 0,
          price_usd:     h.signal?.price_usd ?? null,
          realised_gain: (h as any).realised_gain ?? 0,
        })),
        transactions,
      )
    : null

  const investedPct = metrics && metrics.total_capital > 0
    ? (metrics.invested / metrics.total_capital) * 100
    : 0

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column' }}>

      {/* Alert bar */}
      {latestAlert && !alertDismissed && (
        <div className="alert-bar">
          <i className="ti ti-alert-circle" style={{ fontSize: 11 }} aria-hidden />
          <span>
            <strong>{latestAlert.title}</strong>
            {latestAlert.body ? ` — ${latestAlert.body}` : ''}
          </span>
          <button className="alert-bar-close" onClick={() => setAlertDismissed(true)} aria-label="Dismiss">×</button>
        </div>
      )}

      <main className="content">

        {/* ── Page header ── */}
        <div className="page-header">
          <div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Overview</div>
            <div className="page-title">{activePortfolio?.name ?? '—'}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className="page-date">
              {new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <div className="actions">
              <button
                className="btn btn-outline"
                onClick={() => router.push(`/dashboard/portfolio?tab=recommendations&portfolio_id=${activeId}`)}
              >
                <i className="ti ti-adjustments-horizontal" aria-hidden /> Build ↗
              </button>
              <button
                className="btn btn-outline"
                onClick={() => router.push(`/dashboard/watchlist`)}
              >
                <i className="ti ti-bookmark" aria-hidden /> Watchlist
              </button>
              <button
                className="btn btn-outline"
                onClick={() => setSettingsOpen(true)}
              >
                <i className="ti ti-settings" aria-hidden /> Portfolio settings
              </button>
            </div>
          </div>
        </div>

        {/* ── Broker status bar ── */}
        {mounted && broker !== null && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '6px 12px',
            background: broker.connected ? 'rgba(21,128,61,0.04)' : 'var(--bg-subtle)',
            border: `1px solid ${broker.connected ? 'rgba(21,128,61,0.15)' : 'var(--border)'}`,
            borderRadius: 'var(--r-lg)', fontSize: 'var(--fs-sm)',
          }}>
            {/* Status dot */}
            <span style={{
              width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
              background: broker.connected ? 'var(--signal-bull)' : 'var(--text-4)',
              boxShadow: broker.connected ? '0 0 4px rgba(21,128,61,0.5)' : 'none',
            }} />
            <span style={{ color: broker.connected ? 'var(--signal-bull)' : 'var(--text-4)', fontWeight: 500 }}>
              {broker.connected ? `Moomoo ${broker.mode}` : 'Broker offline'}
            </span>
            {broker.connected && (
              <>
                <span style={{ color: 'var(--border)', userSelect: 'none' }}>│</span>
                <span style={{ color: 'var(--text-3)' }}>
                  Cash <strong style={{ color: 'var(--text)' }}>{fmtCurrency(broker.cash ?? 0)}</strong>
                </span>
                <span style={{ color: 'var(--border)', userSelect: 'none' }}>│</span>
                <span style={{ color: 'var(--text-3)' }}>
                  Portfolio <strong style={{ color: 'var(--text)' }}>{fmtCurrency(broker.portfolio_value ?? 0)}</strong>
                </span>
                {(broker.open_orders ?? 0) > 0 && (
                  <>
                    <span style={{ color: 'var(--border)', userSelect: 'none' }}>│</span>
                    <span style={{ color: 'var(--signal-neut)', fontWeight: 500 }}>
                      {broker.open_orders} open order{broker.open_orders !== 1 ? 's' : ''}
                    </span>
                  </>
                )}
                <span style={{ color: 'var(--border)', userSelect: 'none' }}>│</span>
                <span style={{
                  fontSize: 'var(--fs-xs)', padding: '1px 7px', borderRadius: 'var(--r-pill)',
                  background: broker.auto_trading ? 'rgba(21,128,61,0.1)' : 'var(--bg-subtle)',
                  border: `1px solid ${broker.auto_trading ? 'rgba(21,128,61,0.3)' : 'var(--border)'}`,
                  color: broker.auto_trading ? 'var(--signal-bull)' : 'var(--text-4)',
                  fontWeight: 500,
                }}>
                  {broker.auto_trading ? '⚡ Auto-trading ON' : 'Manual'}
                </span>
              </>
            )}
            <button
              onClick={() => router.push('/dashboard/orders')}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-4)', fontSize: 'var(--fs-xs)', cursor: 'pointer', padding: 0 }}
            >
              Orders ↗
            </button>
          </div>
        )}

        {/* ── Capital metrics — full width single row ── */}
        {metrics && metrics.total_capital > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="metrics" style={{ gridTemplateColumns: 'repeat(7, 1fr)' }}>
              <div className="metric">
                <div className="metric-label">Total capital</div>
                <div className="metric-value">{fmtCurrency(metrics.total_capital)}</div>
              </div>
              <div className="metric">
                <div className="metric-label">Invested</div>
                <div className="metric-value">{fmtCurrency(metrics.invested)}</div>
                <div className="metric-sub">{investedPct.toFixed(0)}% deployed</div>
              </div>
              <div className="metric">
                <div className="metric-label">Cash available</div>
                <div className="metric-value" style={{ color: 'var(--color-info)' }}>
                  {fmtCurrency(metrics.cash_available)}
                </div>
              </div>
              <div className="metric">
                <div className="metric-label">Current value</div>
                <div className="metric-value">{fmtCurrency(metrics.current_value)}</div>
              </div>
              <div className="metric">
                <div className="metric-label">Unrealised P&L</div>
                <div className="metric-value" style={{ color: signCol(metrics.unrealised_gain) }}>
                  {metrics.unrealised_gain >= 0 ? '+' : ''}{fmtCurrency(metrics.unrealised_gain)}
                </div>
                <div className="metric-sub" style={{ color: signCol(metrics.unrealised_gain) }}>
                  {fmtPct(metrics.unrealised_pct)}
                </div>
              </div>
              <div className="metric">
                <div className="metric-label">Realised P&L</div>
                <div className="metric-value" style={{ color: signCol(metrics.realised_gain) }}>
                  {metrics.realised_gain >= 0 ? '+' : ''}{fmtCurrency(metrics.realised_gain)}
                </div>
              </div>
              <div className="metric">
                <div className="metric-label">Total return</div>
                <div className="metric-value" style={{ color: signCol(metrics.total_gain) }}>
                  {metrics.total_gain >= 0 ? '+' : ''}{fmtCurrency(metrics.total_gain)}
                </div>
                <div className="metric-sub" style={{ color: signCol(metrics.return_pct) }}>
                  {fmtPct(metrics.return_pct)} on capital
                </div>
              </div>
            </div>
            {/* Invested progress bar */}
            <div style={{ height: 2, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${Math.min(100, investedPct)}%`,
                background: 'var(--text)', borderRadius: 99, transition: 'width 0.4s',
              }} />
            </div>
          </div>
        ) : (
          <div style={{ border: '1px solid var(--border)', borderRadius: 5, padding: '14px 16px', background: 'var(--bg-subtle)' }}>
            <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>
              Set your portfolio capital to get started
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-4)', marginBottom: 10 }}>
              Capital is needed to generate portfolio recommendations and track performance.
            </div>
            <button className="btn btn-outline" onClick={() => router.push(`/dashboard/portfolio?portfolio_id=${activeId}`)}>
              Set capital ↗
            </button>
          </div>
        )}

        {/* ── Two-column: Holdings · Performance ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)', alignItems: 'start' }}>

          {/* Col 1: Holdings */}
          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
            <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="section-label">Holdings {loading ? '…' : `(${holdings.length})`}</span>
              <button className="section-link" onClick={() => router.push(`/dashboard/portfolio?portfolio_id=${activeId}`)}>
                Full portfolio ↗
              </button>
            </div>
            <div style={{ padding: '0 14px' }}>
              {holdings.length > 0 ? (
                <table className="holdings-table" aria-label="Portfolio holdings">
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Asset</th>
                      <th>Qty</th>
                      <th>Avg cost</th>
                      <th>Price</th>
                      <th>Mkt value</th>
                      <th>Unrealised</th>
                      <th>Day chg</th>
                      <th>Signal</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {holdings.slice(0, 10).map(h => {
                      const sig        = h.signal
                      const livePrice  = sig?.price_usd  ?? null
                      const chg        = sig?.change_pct ?? null
                      const qty        = h.quantity ?? 0
                      const cost       = h.avg_cost ?? 0
                      const mktVal     = livePrice != null ? qty * livePrice : null
                      const costBase   = qty * cost
                      const unrealised = mktVal != null ? mktVal - costBase : null
                      const sc         = sig?.signal ?? 'hold'
                      const histIsOpen = histOpen === h.ticker
                      return (
                        <>
                          <tr key={h.id}>
                            <td>
                              <div className="ticker-cell">
                                <button
                                  onClick={() => router.push(`/dashboard/tickers/${h.ticker}`)}
                                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
                                >
                                  <div className="ticker-name" style={{ color: 'var(--accent)' }}>{h.ticker}</div>
                                  {h.name && <div className="ticker-desc">{h.name}</div>}
                                </button>
                              </div>
                            </td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>
                              {qty > 0 ? qty.toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—'}
                            </td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>
                              {cost > 0 ? `$${cost.toFixed(2)}` : '—'}
                            </td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>
                              {livePrice != null ? `$${livePrice.toFixed(2)}` : '—'}
                            </td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>
                              {mktVal != null ? fmtCurrency(mktVal) : '—'}
                            </td>
                            <td style={{ fontSize: 10.5, fontWeight: 500, color: signCol(unrealised) }}>
                              {unrealised != null ? `${unrealised >= 0 ? '+' : ''}${fmtCurrency(unrealised)}` : '—'}
                            </td>
                            <td style={{ fontSize: 10.5, fontWeight: 500, color: signCol(chg) }}>
                              {chg != null ? `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%` : '—'}
                            </td>
                            <td>
                              <span style={{
                                fontSize: 9.5, fontWeight: 500,
                                color: SIG_COLOR[sc] ?? 'var(--text-4)',
                                background: `${SIG_COLOR[sc] ?? 'var(--text-4)'}18`,
                                padding: '1px 5px', borderRadius: 3,
                              }}>
                                {sc}
                              </span>
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                                <button
                                  onClick={() => setHistOpen(histIsOpen ? null : h.ticker)}
                                  style={{ fontSize: 9.5, padding: '1px 6px', background: histIsOpen ? 'var(--bg-subtle)' : 'none', border: '1px solid var(--border)', color: histIsOpen ? 'var(--text)' : 'var(--text-4)', borderRadius: 3, cursor: 'pointer', fontWeight: 500 }}
                                >Hist</button>
                                <button
                                  onClick={() => { setTxModal({ holdingId: h.id, ticker: h.ticker, currentQty: qty }); setTxType('buy') }}
                                  style={{ fontSize: 9.5, padding: '1px 6px', background: 'rgba(21,128,61,0.08)', border: '1px solid rgba(21,128,61,0.25)', color: 'var(--signal-bull)', borderRadius: 3, cursor: 'pointer', fontWeight: 500 }}
                                >Buy</button>
                                <button
                                  onClick={() => { setTxModal({ holdingId: h.id, ticker: h.ticker, currentQty: qty }); setTxType('sell') }}
                                  style={{ fontSize: 9.5, padding: '1px 6px', background: 'rgba(185,28,28,0.07)', border: '1px solid rgba(185,28,28,0.2)', color: 'var(--signal-bear)', borderRadius: 3, cursor: 'pointer', fontWeight: 500 }}
                                >Sell</button>
                              </div>
                            </td>
                          </tr>
                          {histIsOpen && (
                            <InlineTransactionHistory
                              key={`tx-${h.id}`}
                              portfolioId={activeId}
                              ticker={h.ticker}
                              avgCost={h.avg_cost}
                              onDelete={() => loadPortfolioData(activeId)}
                              onClose={() => setHistOpen(null)}
                            />
                          )}
                        </>
                      )
                    })}
                  </tbody>
                </table>
              ) : loading ? (
                <div style={{ color: 'var(--text-4)', fontSize: 10.5, padding: '12px 0' }}>Loading holdings…</div>
              ) : (
                <div style={{ color: 'var(--text-4)', fontSize: 10.5, padding: '12px 0' }}>
                  No holdings yet.{' '}
                  <button className="section-link" style={{ display: 'inline', fontSize: 10.5 }}
                    onClick={() => router.push(`/dashboard/portfolio?portfolio_id=${activeId}`)}>
                    Add holdings ↗
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Col 2: Performance */}
          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
            <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)' }}>
              <span className="section-label">Performance</span>
            </div>
            <div style={{ padding: '12px 14px' }}>
              {activeId ? (
                <PortfolioPerformanceChart
                  portfolioId={activeId}
                  totalCapital={activePortfolio?.total_capital ?? 0}
                />
              ) : (
                <div style={{ color: 'var(--text-4)', fontSize: 'var(--fs-sm)', padding: '20px 0', textAlign: 'center' }}>
                  Select a portfolio
                </div>
              )}
            </div>
          </div>


        </div>{/* end three-column grid */}

        {/* ── Market context chips ── */}
        <div>
          <div className="section-head">
            <span className="section-label">Market context</span>
          </div>
          <div className="context-row">
            <button className="chip" onClick={() => setPanelOpen(true)}>
              <span className="regime-dot" />
              {regime?.label ?? 'No regime data'}
            </button>
            <button className="chip" onClick={() => setPanelOpen(true)}>
              <i className="ti ti-bulb" aria-hidden /> Themes
            </button>
            <button className="chip" onClick={() => setPanelOpen(true)}>
              <i className="ti ti-news" aria-hidden /> Events
            </button>
            <button className="chip" onClick={() => router.push('/dashboard/events')}>
              <i className="ti ti-trending-up" aria-hidden /> Event feed ↗
            </button>
          </div>
        </div>

      </main>

      {/* ── Portfolio settings modal ── */}
      {settingsOpen && activeId && (
        <PortfolioSettingsModal
          portfolioId={activeId}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* ── Transaction modal ── */}
      {txModal && (
        <>
          <div onClick={() => setTxModal(null)} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.4)' }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 201, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '1.4rem', width: 360, boxShadow: '0 16px 48px rgba(0,0,0,0.15)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <div>
                <div style={{ fontSize: 'var(--fs-label)', color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>Record transaction</div>
                <div style={{ fontSize: 'var(--fs-heading)', fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{txModal.ticker}</div>
              </div>
              <button onClick={() => setTxModal(null)} style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1 }}>×</button>
            </div>

            {/* Buy / Sell toggle */}
            <div style={{ display: 'flex', gap: 4, marginBottom: '1rem' }}>
              {(['buy', 'sell'] as const).map(t => (
                <button key={t} onClick={() => { setTxType(t); setTxError('') }} style={{
                  flex: 1, padding: '0.4rem',
                  border: `1px solid ${txType === t ? (t === 'buy' ? 'rgba(21,128,61,0.4)' : 'rgba(185,28,28,0.4)') : 'var(--border)'}`,
                  background: txType === t ? (t === 'buy' ? 'rgba(21,128,61,0.08)' : 'rgba(185,28,28,0.08)') : 'none',
                  color: txType === t ? (t === 'buy' ? 'var(--signal-bull)' : 'var(--signal-bear)') : 'var(--text-3)',
                  borderRadius: 'var(--r-md)', cursor: 'pointer', fontSize: 'var(--fs-sm)',
                  fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
                }}>{t}</button>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '0.9rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div>
                  <div style={{ fontSize: 'var(--fs-label)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>
                    Quantity{txType === 'sell' ? ` (max ${txModal.currentQty})` : ''}
                  </div>
                  <input value={txQty} onChange={e => setTxQty(e.target.value)} placeholder="0" type="number"
                    style={{ width: '100%', padding: '0.4rem 0.6rem', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text)', fontSize: 'var(--fs-sm)', outline: 'none' }} />
                </div>
                <div>
                  <div style={{ fontSize: 'var(--fs-label)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>Price ($)</div>
                  <input value={txPrice} onChange={e => setTxPrice(e.target.value)} placeholder="0.00" type="number"
                    style={{ width: '100%', padding: '0.4rem 0.6rem', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text)', fontSize: 'var(--fs-sm)', outline: 'none' }} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div>
                  <div style={{ fontSize: 'var(--fs-label)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>Date</div>
                  <input value={txDate} onChange={e => setTxDate(e.target.value)} type="date"
                    style={{ width: '100%', padding: '0.4rem 0.6rem', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text)', fontSize: 'var(--fs-sm)', outline: 'none' }} />
                </div>
                <div>
                  <div style={{ fontSize: 'var(--fs-label)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>Fees ($)</div>
                  <input value={txFees} onChange={e => setTxFees(e.target.value)} placeholder="0.00" type="number"
                    style={{ width: '100%', padding: '0.4rem 0.6rem', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text)', fontSize: 'var(--fs-sm)', outline: 'none' }} />
                </div>
              </div>
              <div>
                <div style={{ fontSize: 'var(--fs-label)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>Notes (optional)</div>
                <input value={txNotes} onChange={e => setTxNotes(e.target.value)} placeholder="e.g. Earnings play"
                  style={{ width: '100%', padding: '0.4rem 0.6rem', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text)', fontSize: 'var(--fs-sm)', outline: 'none' }} />
              </div>
            </div>

            {txQty && txPrice && (
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-3)', marginBottom: '0.8rem', padding: '0.4rem 0.6rem', background: 'var(--bg-subtle)', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
                Total: <strong style={{ color: 'var(--text)' }}>${(parseFloat(txQty || '0') * parseFloat(txPrice || '0') + parseFloat(txFees || '0')).toFixed(2)}</strong>
                {txType === 'sell' && txQty && txModal.currentQty > 0 && (
                  <span style={{ marginLeft: 10, color: 'var(--text-4)' }}>
                    Remaining: {Math.max(0, txModal.currentQty - parseFloat(txQty || '0')).toFixed(2)} shares
                  </span>
                )}
              </div>
            )}

            {txError && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--signal-bear)', marginBottom: '0.8rem' }}>{txError}</div>}

            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setTxModal(null)} className="btn btn-outline">Cancel</button>
              <button onClick={handleTransaction} disabled={txSaving} style={{
                padding: '4px 12px',
                background: txType === 'buy' ? 'rgba(21,128,61,0.1)' : 'rgba(185,28,28,0.1)',
                border: `1px solid ${txType === 'buy' ? 'rgba(21,128,61,0.3)' : 'rgba(185,28,28,0.3)'}`,
                color: txType === 'buy' ? 'var(--signal-bull)' : 'var(--signal-bear)',
                fontWeight: 600, borderRadius: 'var(--r-md)', cursor: txSaving ? 'not-allowed' : 'pointer',
                fontSize: 'var(--fs-sm)', opacity: txSaving ? 0.6 : 1,
              }}>
                {txSaving ? '…' : txType === 'buy' ? 'Record Buy' : 'Record Sell'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Market context panel ── */}
      {panelOpen && (
        <div className="overlay open" onClick={() => setPanelOpen(false)}>
          <div className="panel" onClick={e => e.stopPropagation()}>
            <div className="panel-head">
              <span className="panel-title">Market context</span>
              <button className="panel-close" onClick={() => setPanelOpen(false)} aria-label="Close">
                <i className="ti ti-x" style={{ fontSize: 13 }} aria-hidden />
              </button>
            </div>

            {regime && (
              <div className="regime-block">
                <div className="regime-name">{regime.label}</div>
                <div className="regime-sub">{regime.risk_bias} · {regime.confidence}% confidence</div>
                {regime.rationale && (
                  <div style={{ fontSize: 10, color: 'var(--text-3)', margin: '6px 0 8px', lineHeight: 1.5 }}>
                    {regime.rationale}
                  </div>
                )}
                <div className="tag-row">
                  {regime.style_bias  && <span className="tag">{regime.style_bias}</span>}
                  {regime.cash_bias   && <span className="tag">Cash {regime.cash_bias}</span>}
                  {regime.cycle_phase && <span className="tag">{regime.cycle_phase}-cycle</span>}
                  {(regime.favoured_sectors ?? []).slice(0, 2).map(s => (
                    <span key={s} className="tag" style={{ color: 'var(--signal-bull)', borderColor: 'var(--accent-border)' }}>
                      ↑ {s}
                    </span>
                  ))}
                  {(regime.avoid_sectors ?? []).slice(0, 2).map(s => (
                    <span key={s} className="tag" style={{ color: 'var(--signal-bear)' }}>
                      ↓ {s}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {themes.length > 0 && (
              <div>
                <div className="section-label" style={{ marginBottom: 4 }}>Active themes</div>
                {themes.map(t => (
                  <div className="theme-item" key={t.id}>
                    <div>
                      <div className="theme-name">{t.name}</div>
                      <div className="theme-sub">{t.timeframe} · {t.momentum ?? 'neutral'}</div>
                    </div>
                    {t.conviction != null && (
                      <div className="bar-wrap">
                        <div className="bar-bg">
                          <div className="bar-fill" style={{
                            width: `${t.conviction}%`,
                            background: t.conviction < 60 ? 'var(--text-4)' : 'var(--text)',
                          }} />
                        </div>
                        <div className="bar-val">{t.conviction}</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="divider" />

            <button
              className="btn btn-outline"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={() => router.push('/dashboard/themes')}
            >
              View all themes ↗
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
