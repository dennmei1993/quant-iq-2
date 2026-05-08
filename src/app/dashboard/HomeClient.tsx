'use client'

// src/app/dashboard/HomeClient.tsx
// Dashboard overview — portfolio-first, compact monochrome design.
// All colours and typography reference CSS variables defined in globals.css.

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

interface Holding {
  id:        string
  ticker:    string
  name:      string | null
  quantity:  number | null
  avg_cost:  number | null
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
  holdings:    Holding[]
  signals:     Signal[]
  latestAlert: PortfolioAlert | null
  hasHoldings: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, prefix = '$') {
  if (n == null) return '—'
  return `${prefix}${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
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
  if (weight >= 25) return '#111'
  if (weight >= 15) return '#555'
  if (weight >= 10) return '#888'
  if (weight >= 5)  return '#bbb'
  return '#ddd'
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function HomeClient({
  regime,
  themes,
  portfolio,
  holdings,
  signals,
  latestAlert,
}: Props) {
  const [alertDismissed, setAlertDismissed] = useState(false)
  const [panelOpen, setPanelOpen]           = useState(false)
  const [activeNav, setActiveNav]           = useState('overview')

  const signalMap = new Map(signals.map(s => [s.ticker, s]))

  // Compute weight per holding
  const totalValue = portfolio.total_value ?? 0
  const rows = holdings.slice(0, 6).map(h => {
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
    <div className="dashboard" style={{ position: 'relative' }}>

      {/* Alert bar */}
      {latestAlert && !alertDismissed && (
        <div className="alert-bar">
          <i className="ti ti-alert-circle" style={{ fontSize: 11, color: 'var(--color-300)' }} aria-hidden />
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

      <div className="dashboard-body">

        {/* Sidebar */}
        <nav className="sidebar" aria-label="Dashboard navigation">
          <span className="nav-section-label">Portfolio</span>
          <button
            className={`nav-item${activeNav === 'overview' ? ' active' : ''}`}
            onClick={() => setActiveNav('overview')}
          >
            <i className="ti ti-briefcase" aria-hidden />
            Overview
          </button>
          <button className="nav-item" onClick={() => setActiveNav('build')}>
            <i className="ti ti-plus" aria-hidden />
            Build
          </button>
          <button className="nav-item" onClick={() => setActiveNav('rebalance')}>
            <i className="ti ti-adjustments-horizontal" aria-hidden />
            Rebalance
          </button>

          <span className="nav-section-label">Insights</span>
          <button className="nav-item" onClick={() => setPanelOpen(true)}>
            <i className="ti ti-world" aria-hidden />
            Market
          </button>
          <button className="nav-item" onClick={() => setPanelOpen(true)}>
            <i className="ti ti-bulb" aria-hidden />
            Themes
          </button>
          <button className="nav-item">
            <i className="ti ti-bell" aria-hidden />
            Alerts
            {latestAlert && <span className="nav-badge">1</span>}
          </button>

          <span className="nav-section-label">Account</span>
          <button className="nav-item">
            <i className="ti ti-settings" aria-hidden />
            Settings
          </button>
        </nav>

        {/* Main content */}
        <main className="content">

          {/* Page header */}
          <div className="page-header">
            <div className="page-title">My portfolio</div>
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
              <div className="metric-value" style={{ color: 'var(--color-400)' }}>—</div>
            </div>
            <div className="metric">
              <div className="metric-label">Positions</div>
              <div className="metric-value">{portfolio.holdings_count}</div>
            </div>
          </div>

          {/* Holdings table */}
          <div>
            <div className="section-head">
              <span className="label">Holdings</span>
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
                    <td style={{ color: 'var(--color-200)' }}>
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
                    <td colSpan={7} style={{ color: 'var(--color-300)', padding: '16px 0', textAlign: 'center' }}>
                      No holdings yet — build a portfolio to get started.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Market context chips */}
          <div>
            <div className="section-head">
              <span className="label">Market context</span>
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
      </div>

      {/* Market context slide-over panel */}
      <div
        className={`overlay${panelOpen ? ' open' : ''}`}
        onClick={() => setPanelOpen(false)}
      >
        <div className="panel" onClick={e => e.stopPropagation()}>

          <div className="panel-head">
            <span className="panel-title">Market context</span>
            <button className="panel-close" onClick={() => setPanelOpen(false)} aria-label="Close panel">
              <i className="ti ti-x" style={{ fontSize: 13 }} aria-hidden />
            </button>
          </div>

          {/* Regime */}
          {regime && (
            <div className="regime-block">
              <div className="regime-name">{regime.label}</div>
              <div className="regime-sub">
                {regime.risk_bias} · {regime.confidence}% confidence
              </div>
              <div className="tag-row">
                {regime.style_bias     && <span className="tag">{regime.style_bias}</span>}
                {regime.cash_bias      && <span className="tag">Cash {regime.cash_bias}</span>}
                {regime.cycle_phase    && <span className="tag">{regime.cycle_phase}-cycle</span>}
              </div>
            </div>
          )}

          {/* Themes */}
          {themes.length > 0 && (
            <div>
              <div className="label" style={{ marginBottom: 2 }}>Active themes</div>
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
                            background: t.conviction < 60 ? 'var(--color-300)' : 'var(--color-black)',
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

          <button
            className="btn btn-outline"
            style={{ width: '100%', justifyContent: 'center', fontSize: 10 }}
          >
            Ask about this regime ↗
          </button>

        </div>
      </div>
    </div>
  )
}
