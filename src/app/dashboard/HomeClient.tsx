'use client'

// src/app/dashboard/HomeClient.tsx
// Overview page — content area only (sidebar owned by layout).
// Fetches portfolio data client-side so it stays live.
// Full detail at /dashboard/portfolio.

import { useState, useEffect, useCallback } from 'react'
import { PortfolioPerformanceChart } from '@/components/dashboard/PortfolioPerformanceChart'
import { PortfolioWatchlist } from '@/components/dashboard/PortfolioWatchlist'
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
            </div>
          </div>
        </div>


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

        {/* ── Three-column: Holdings · Performance · Watchlist ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px 240px', gap: 'var(--sp-4)', alignItems: 'start' }}>

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
                      const weight     = mktVal && metrics ? (mktVal / metrics.current_value) * 100 : 0
                      const dotColor   = weight >= 20 ? 'var(--text)' : weight >= 12 ? 'var(--text-2)' : weight >= 6 ? 'var(--text-3)' : 'var(--text-4)'
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
                        </tr>
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

          {/* Col 3: Watchlist */}
          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
            <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="section-label">Watchlist</span>
              <button className="section-link" onClick={() => router.push(`/dashboard/portfolio?tab=watchlist&portfolio_id=${activeId}`)}>
                Manage ↗
              </button>
            </div>
            <div style={{ padding: '8px 14px' }}>
              {activeId ? (
                <PortfolioWatchlist portfolioId={activeId} />
              ) : (
                <div style={{ color: 'var(--text-4)', fontSize: 'var(--fs-sm)', padding: '12px 0', textAlign: 'center' }}>
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
