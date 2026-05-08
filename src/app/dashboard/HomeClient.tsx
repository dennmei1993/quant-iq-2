'use client'

// src/app/dashboard/HomeClient.tsx
// Dashboard overview — content area ONLY.
// The sidebar is owned by the app layout (src/app/dashboard/layout.tsx).
// This component renders only the main content: alert bar, metrics,
// holdings table, market context chips, and the slide-over panel.

import { useState } from 'react'
import type {
  Regime,
  MacroSnapshot,
  HomeTheme,
  HomeEvent,
  PortfolioSummary,
  PortfolioAlert,
} from './page'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Portfolio {
  id:   string
  name: string
}

interface Holding {
  id:           string
  ticker:       string
  name:         string | null
  quantity:     number | null
  avg_cost:     number | null
  portfolio_id: string
}

interface Signal {
  ticker:     string
  signal:     string | null
  score:      number | null
  price_usd:  number | null
  change_pct: number | null
}

interface Props {
  regime:      Regime | null
  macro:       MacroSnapshot
  themes:      HomeTheme[]
  events:      HomeEvent[]
  portfolio:   PortfolioSummary
  portfolios:  Portfolio[]          // all user portfolios for switcher
  holdings:    Holding[]
  signals:     Signal[]
  latestAlert: PortfolioAlert | null
  hasHoldings: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined) {
  if (n == null) return '—'
  return `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function fmtPct(n: number | null | undefined) {
  if (n == null) return '—'
  return `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}%`
}

function signClass(n: number | null | undefined) {
  if (n == null) return ''
  return n >= 0 ? 'text-positive' : 'text-negative'
}

function weightDot(weight: number): string {
  if (weight >= 25) return 'var(--text)'
  if (weight >= 15) return 'var(--text-2)'
  if (weight >= 10) return 'var(--text-3)'
  if (weight >= 5)  return 'var(--text-4)'
  return 'var(--border)'
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function HomeClient({
  regime,
  themes,
  portfolio,
  portfolios,
  holdings,
  signals,
  latestAlert,
}: Props) {
  const [alertDismissed,    setAlertDismissed]    = useState(false)
  const [panelOpen,         setPanelOpen]          = useState(false)
  const [activePortfolioId, setActivePortfolioId]  = useState<string>(portfolios[0]?.id ?? '')
  const [switcherOpen,      setSwitcherOpen]        = useState(false)

  const activePortfolio = portfolios.find(p => p.id === activePortfolioId) ?? portfolios[0]
  const signalMap       = new Map(signals.map(s => [s.ticker, s]))
  const totalValue      = portfolio.total_value ?? 0

  // Filter holdings to active portfolio
  const rows = holdings
    .filter(h => h.portfolio_id === activePortfolioId)
    .slice(0, 8)
    .map(h => {
      const sig    = signalMap.get(h.ticker)
      const price  = sig?.price_usd ?? null
      const value  = price && h.quantity ? price * h.quantity : null
      const cost   = h.avg_cost && h.quantity ? h.avg_cost * h.quantity : null
      const ret    = value && cost ? ((value - cost) / cost) * 100 : null
      const weight = value && totalValue > 0 ? (value / totalValue) * 100 : null
      return { ...h, sig, price, value, ret, weight }
    })

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
          <button
            className="alert-bar-close"
            onClick={() => setAlertDismissed(true)}
            aria-label="Dismiss alert"
          >×</button>
        </div>
      )}

      {/* Content */}
      <main className="content">

        {/* Page header */}
        <div className="page-header">

          {/* Portfolio switcher */}
          <div style={{ position: 'relative' }}>
            <button
              className="portfolio-switcher"
              onClick={() => setSwitcherOpen(o => !o)}
              aria-haspopup="listbox"
              aria-expanded={switcherOpen}
            >
              <span className="portfolio-switcher-name">
                {activePortfolio?.name ?? 'My portfolio'}
              </span>
              {portfolios.length > 1 && (
                <i
                  className={`ti ti-chevron-${switcherOpen ? 'up' : 'down'}`}
                  style={{ fontSize: 11, color: 'var(--text-4)' }}
                  aria-hidden
                />
              )}
            </button>

            {/* Dropdown */}
            {switcherOpen && portfolios.length > 1 && (
              <div className="portfolio-dropdown" role="listbox">
                {portfolios.map(p => (
                  <button
                    key={p.id}
                    className={`portfolio-dropdown-item${p.id === activePortfolioId ? ' active' : ''}`}
                    role="option"
                    aria-selected={p.id === activePortfolioId}
                    onClick={() => { setActivePortfolioId(p.id); setSwitcherOpen(false) }}
                  >
                    <i className="ti ti-briefcase" style={{ fontSize: 12 }} aria-hidden />
                    {p.name}
                    {p.id === activePortfolioId && (
                      <i className="ti ti-check" style={{ fontSize: 11, marginLeft: 'auto' }} aria-hidden />
                    )}
                  </button>
                ))}
                <div style={{ height: 1, background: 'var(--border-subtle)', margin: '4px 0' }} />
                <button className="portfolio-dropdown-item" onClick={() => setSwitcherOpen(false)}>
                  <i className="ti ti-plus" style={{ fontSize: 12 }} aria-hidden />
                  New portfolio
                </button>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className="page-date">
              {new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <div className="actions">
              <button className="btn btn-outline">
                <i className="ti ti-chart-radar" aria-hidden /> Risk analysis
              </button>
              <button className="btn btn-dark">
                <i className="ti ti-adjustments-horizontal" aria-hidden /> Rebalance
              </button>
            </div>
          </div>
        </div>

        {/* Metrics */}
        <div className="metrics">
          <div className="metric">
            <div className="metric-label">Total value</div>
            <div className="metric-value">{fmt(portfolio.total_value)}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Total return</div>
            <div className={`metric-value ${signClass(portfolio.total_pnl)}`}>
              {portfolio.total_pnl != null && portfolio.total_pnl >= 0 ? '+' : ''}
              {fmt(portfolio.total_pnl)}
            </div>
            <div className={`metric-sub ${signClass(portfolio.total_pnl_pct)}`}>
              {fmtPct(portfolio.total_pnl_pct)} all time
            </div>
          </div>
          <div className="metric">
            <div className="metric-label">Today</div>
            <div className="metric-value" style={{ color: 'var(--text-4)' }}>—</div>
          </div>
          <div className="metric">
            <div className="metric-label">Positions</div>
            <div className="metric-value">{portfolio.holdings_count}</div>
            <div className="metric-sub">{rows.filter(r => r.sig?.signal === 'buy').length} buy · {rows.filter(r => r.sig?.signal === 'watch').length} watch</div>
          </div>
        </div>

        {/* Holdings table */}
        <div>
          <div className="section-head">
            <span className="section-label">Holdings</span>
            <button className="section-link">View all ↗</button>
          </div>
          <table className="holdings-table" aria-label="Portfolio holdings">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Asset</th>
                <th>Shares</th>
                <th>Price</th>
                <th>Value</th>
                <th>Return</th>
                <th>Weight</th>
                <th>Signal</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id}>
                  <td>
                    <div className="ticker-cell">
                      <div className="ticker-dot" style={{ background: weightDot(row.weight ?? 0) }} />
                      <div>
                        <div className="ticker-name">{row.ticker}</div>
                        {row.name && <div className="ticker-desc">{row.name}</div>}
                      </div>
                    </div>
                  </td>
                  <td>{row.quantity ?? '—'}</td>
                  <td>{fmt(row.price)}</td>
                  <td>{fmt(row.value)}</td>
                  <td className={signClass(row.ret)}>{fmtPct(row.ret)}</td>
                  <td style={{ color: 'var(--text-4)' }}>
                    {row.weight != null ? `${row.weight.toFixed(0)}%` : '—'}
                  </td>
                  <td>
                    {row.sig?.signal === 'buy'   && <span className="signal signal-buy">Buy</span>}
                    {row.sig?.signal === 'watch' && <span className="signal signal-watch">Watch</span>}
                    {row.sig?.signal === 'hold'  && <span className="signal signal-hold">Hold</span>}
                    {(!row.sig?.signal || row.sig.signal === 'avoid') && <span className="signal signal-hold">—</span>}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ color: 'var(--text-4)', padding: '16px 0', textAlign: 'center' }}>
                    No holdings — build a portfolio to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Market context chips */}
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
            <button className="chip">
              <i className="ti ti-trending-up" aria-hidden /> Macro ↗
            </button>
          </div>
        </div>

      </main>

      {/* Market context slide-over panel */}
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
                <div className="tag-row">
                  {regime.style_bias  && <span className="tag">{regime.style_bias}</span>}
                  {regime.cash_bias   && <span className="tag">Cash {regime.cash_bias}</span>}
                  {regime.cycle_phase && <span className="tag">{regime.cycle_phase}-cycle</span>}
                </div>
              </div>
            )}

            {themes.length > 0 && (
              <div>
                <div className="section-label" style={{ marginBottom: 2 }}>Active themes</div>
                {themes.map(t => (
                  <div className="theme-item" key={t.id}>
                    <div>
                      <div className="theme-name">{t.name}</div>
                      <div className="theme-sub">{t.timeframe} · {t.momentum ?? 'neutral'}</div>
                    </div>
                    {t.conviction != null && (
                      <div className="bar-wrap">
                        <div className="bar-bg">
                          <div
                            className="bar-fill"
                            style={{
                              width: `${t.conviction}%`,
                              background: t.conviction < 60 ? 'var(--text-4)' : 'var(--text)',
                            }}
                          />
                        </div>
                        <div className="bar-val">{t.conviction}</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="divider" />
            <button className="btn btn-outline" style={{ width: '100%', justifyContent: 'center' }}>
              Ask about this regime ↗
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
