'use client'

// src/app/dashboard/HomeClient.tsx
// Overview page — content area only (sidebar owned by layout).
// Fetches portfolio data client-side so it stays live.
// Full detail at /dashboard/portfolio.

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
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

interface CapitalMetrics {
  total_capital:   number
  invested:        number
  cash_available:  number
  current_value:   number
  unrealised_gain: number
  unrealised_pct:  number
  realised_gain:   number
  total_gain:      number
  return_pct:      number
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

function computeMetrics(portfolio: Portfolio, holdings: Holding[]): CapitalMetrics {
  let invested        = 0
  let current_value   = 0
  let realised_gain   = 0

  for (const h of holdings) {
    const qty   = h.quantity ?? 0
    const cost  = h.avg_cost ?? 0
    const price = h.signal?.price_usd ?? null
    invested      += qty * cost
    current_value += price != null ? qty * price : qty * cost
    realised_gain += h.realised_gain ?? 0
  }

  const unrealised_gain = current_value - invested
  const unrealised_pct  = invested > 0 ? (unrealised_gain / invested) * 100 : 0
  const cash_available  = portfolio.total_capital - invested + realised_gain
  const total_gain      = unrealised_gain + realised_gain
  const return_pct      = portfolio.total_capital > 0 ? (total_gain / portfolio.total_capital) * 100 : 0

  return {
    total_capital: portfolio.total_capital,
    invested,
    cash_available,
    current_value,
    unrealised_gain,
    unrealised_pct,
    realised_gain,
    total_gain,
    return_pct,
  }
}

const SIG_COLOR: Record<string, string> = {
  buy:   'var(--signal-bull)',
  watch: 'var(--signal-neut)',
  hold:  'var(--text-4)',
  avoid: 'var(--signal-bear)',
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
  const [switcherOpen,     setSwitcherOpen]      = useState(false)
  const [portfolios,       setPortfolios]        = useState<Portfolio[]>(initialPortfolios)
  const [activeId,         setActiveId]          = useState<string>(() => {
    if (typeof window === 'undefined') return initialPortfolios[0]?.id ?? ''
    const saved = sessionStorage.getItem('quant_iq_selected_portfolio')
    return (saved && initialPortfolios.find(p => p.id === saved)) ? saved : (initialPortfolios[0]?.id ?? '')
  })
  const [holdings,         setHoldings]          = useState<Holding[]>([])
  const [loading,          setLoading]           = useState(false)

  const activePortfolio = portfolios.find(p => p.id === activeId) ?? portfolios[0] ?? null

  const loadHoldings = useCallback(async (portfolioId: string) => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/portfolio?portfolio_id=${portfolioId}`)
      const data = await res.json()
      setHoldings(data.holdings ?? [])
    } catch {
      setHoldings([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeId) loadHoldings(activeId)
  }, [activeId, loadHoldings])

  useEffect(() => {
    if (activeId) sessionStorage.setItem('quant_iq_selected_portfolio', activeId)
  }, [activeId])

  const metrics = activePortfolio ? computeMetrics(activePortfolio, holdings) : null

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
          <div style={{ position: 'relative' }}>

            {/* Portfolio switcher */}
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
                <i className={`ti ti-chevron-${switcherOpen ? 'up' : 'down'}`}
                  style={{ fontSize: 11, color: 'var(--text-4)' }} aria-hidden />
              )}
            </button>

            {switcherOpen && (
              <div className="portfolio-dropdown" role="listbox">
                {portfolios.map(p => (
                  <button
                    key={p.id}
                    className={`portfolio-dropdown-item${p.id === activeId ? ' active' : ''}`}
                    role="option"
                    aria-selected={p.id === activeId}
                    onClick={() => { setActiveId(p.id); setSwitcherOpen(false) }}
                  >
                    <i className="ti ti-briefcase" style={{ fontSize: 12 }} aria-hidden />
                    {p.name}
                    {p.id === activeId && (
                      <i className="ti ti-check" style={{ fontSize: 11, marginLeft: 'auto' }} aria-hidden />
                    )}
                  </button>
                ))}
                <div style={{ height: 1, background: 'var(--border-subtle)', margin: '4px 0' }} />
                <button
                  className="portfolio-dropdown-item"
                  onClick={() => { setSwitcherOpen(false); router.push('/dashboard/portfolio') }}
                >
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
              <button
                className="btn btn-outline"
                onClick={() => router.push(`/dashboard/portfolio?tab=recommendations&portfolio_id=${activeId}`)}
              >
                <i className="ti ti-adjustments-horizontal" aria-hidden /> Build ↗
              </button>
              <button
                className="btn btn-dark"
                onClick={() => router.push(`/dashboard/portfolio?portfolio_id=${activeId}`)}
              >
                <i className="ti ti-briefcase" aria-hidden /> Full view ↗
              </button>
            </div>
          </div>
        </div>

        {/* ── Capital metrics ── */}
        {metrics && metrics.total_capital > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

            {/* Row 1: top-level */}
            <div className="metrics">
              <div className="metric">
                <div className="metric-label">Total capital</div>
                <div className="metric-value">{fmtCurrency(metrics.total_capital)}</div>
              </div>
              <div className="metric">
                <div className="metric-label">Current value</div>
                <div className="metric-value">{fmtCurrency(metrics.current_value)}</div>
                <div className="metric-sub" style={{ color: signCol(metrics.unrealised_gain) }}>
                  {metrics.unrealised_gain >= 0 ? '+' : ''}{fmtCurrency(metrics.unrealised_gain)} unrealised
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
              <div className="metric">
                <div className="metric-label">Cash available</div>
                <div className="metric-value" style={{ color: 'var(--color-info)' }}>
                  {fmtCurrency(metrics.cash_available)}
                </div>
                <div className="metric-sub">{(100 - investedPct).toFixed(0)}% uninvested</div>
              </div>
            </div>

            {/* Invested progress bar */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ height: 3, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${Math.min(100, investedPct)}%`,
                  background: 'var(--text)',
                  borderRadius: 99,
                  transition: 'width 0.4s',
                }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 9, color: 'var(--text-4)' }}>
                  {fmtCurrency(metrics.invested)} in positions
                </span>
                <span style={{ fontSize: 9, color: 'var(--text-4)' }}>
                  {fmtCurrency(metrics.cash_available)} available
                </span>
              </div>
            </div>

            {/* Row 2: P&L breakdown */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', border: '1px solid var(--border)', borderRadius: 5, overflow: 'hidden' }}>
              {[
                { label: 'Invested', value: fmtCurrency(metrics.invested), col: 'var(--text)' },
                { label: 'Unrealised P&L', value: `${metrics.unrealised_gain >= 0 ? '+' : ''}${fmtCurrency(metrics.unrealised_gain)}`, sub: fmtPct(metrics.unrealised_pct), col: signCol(metrics.unrealised_gain) },
                { label: 'Realised P&L', value: `${metrics.realised_gain >= 0 ? '+' : ''}${fmtCurrency(metrics.realised_gain)}`, col: signCol(metrics.realised_gain) },
              ].map((m, i) => (
                <div key={i} style={{ padding: '8px 12px', borderLeft: i > 0 ? '1px solid var(--border)' : 'none', background: 'var(--bg)' }}>
                  <div className="metric-label">{m.label}</div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: m.col, marginTop: 2 }}>{m.value}</div>
                  {m.sub && <div style={{ fontSize: 9, color: m.col, marginTop: 1 }}>{m.sub}</div>}
                </div>
              ))}
            </div>
          </div>
        ) : (
          // No capital set — prompt user
          <div style={{ border: '1px solid var(--border)', borderRadius: 5, padding: '14px 16px', background: 'var(--bg-subtle)' }}>
            <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>
              Set your portfolio capital to get started
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-4)', marginBottom: 10 }}>
              Capital is needed to generate portfolio recommendations and track performance.
            </div>
            <button
              className="btn btn-outline"
              onClick={() => router.push(`/dashboard/portfolio?portfolio_id=${activeId}`)}
            >
              Set capital ↗
            </button>
          </div>
        )}

        {/* ── Holdings table ── */}
        <div>
          <div className="section-head">
            <span className="section-label">Holdings {loading ? '…' : `(${holdings.length})`}</span>
            <button
              className="section-link"
              onClick={() => router.push(`/dashboard/portfolio?portfolio_id=${activeId}`)}
            >
              Full portfolio ↗
            </button>
          </div>

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
                </tr>
              </thead>
              <tbody>
                {holdings.slice(0, 8).map(h => {
                  const sig       = h.signal
                  const livePrice = sig?.price_usd  ?? null
                  const chg       = sig?.change_pct ?? null
                  const qty       = h.quantity ?? 0
                  const cost      = h.avg_cost  ?? 0
                  const mktVal    = livePrice != null ? qty * livePrice : null
                  const costBase  = qty * cost
                  const unrealised = mktVal != null ? mktVal - costBase : null
                  const sc        = sig?.signal ?? 'hold'

                  // Weight dot shade from portfolio total
                  const weight = mktVal && metrics ? (mktVal / metrics.current_value) * 100 : 0
                  const dotColor = weight >= 20 ? 'var(--text)' : weight >= 12 ? 'var(--text-2)' : weight >= 6 ? 'var(--text-3)' : 'var(--text-4)'

                  return (
                    <tr key={h.id}>
                      <td>
                        <div className="ticker-cell">
                          <div className="ticker-dot" style={{ background: dotColor }} />
                          <div>
                            <div className="ticker-name">{h.ticker}</div>
                            {h.name && <div className="ticker-desc">{h.name}</div>}
                          </div>
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
                        {unrealised != null
                          ? `${unrealised >= 0 ? '+' : ''}${fmtCurrency(unrealised)}`
                          : '—'}
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
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : loading ? (
            <div style={{ color: 'var(--text-4)', fontSize: 10.5, padding: '10px 0' }}>Loading holdings…</div>
          ) : (
            <div style={{ color: 'var(--text-4)', fontSize: 10.5, padding: '10px 0' }}>
              No holdings yet.{' '}
              <button
                className="section-link"
                style={{ display: 'inline', fontSize: 10.5 }}
                onClick={() => router.push(`/dashboard/portfolio?portfolio_id=${activeId}`)}
              >
                Add holdings ↗
              </button>
            </div>
          )}
        </div>

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
