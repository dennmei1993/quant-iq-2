'use client'
// src/app/dashboard/HomeClient.tsx
import { useState, useEffect } from 'react'
import Link from 'next/link'
import type { Regime, MacroSnapshot, HomeTheme, HomeEvent, PortfolioSummary, PortfolioAlert } from './page'
import styles from './home.module.css'

// ── Helpers ───────────────────────────────────────────────────────────────────

function momentumColor(m: string | null): string {
  const map: Record<string, string> = {
    strong_up:     'var(--signal-bull)',
    moderate_up:   'var(--signal-bull)',
    neutral:       'var(--signal-neut)',
    moderate_down: 'var(--signal-bear)',
    strong_down:   'var(--signal-bear)',
  }
  return map[m ?? 'neutral'] ?? 'var(--signal-neut)'
}

function sentimentColor(s: number | null): string {
  if (s === null) return 'var(--signal-neut)'
  if (s > 0.1)   return 'var(--signal-bull)'
  if (s < -0.1)  return 'var(--signal-bear)'
  return 'var(--signal-neut)'
}

function sentimentClass(s: number | null): string {
  if (s === null) return styles.scoreNeut
  if (s > 0.1)   return styles.scoreBull
  if (s < -0.1)  return styles.scoreBear
  return styles.scoreNeut
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function fmtCurrency(n: number | null): string {
  if (n === null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

// ── Theme detail ──────────────────────────────────────────────────────────────

interface ThemeDetailTicker {
  ticker: string; name: string; asset_type: string | null
  final_weight: number; signal: string | null; score: number | null
  price_usd: number | null; change_pct: number | null; rationale: string | null
}
interface ThemeDetail { theme: any; tickers: ThemeDetailTicker[] }

function ThemeDetailPanel({ themeId }: { themeId: string }) {
  const [detail,  setDetail]  = useState<ThemeDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    setLoading(true); setError(null)
    fetch(`/api/themes/${themeId}`, { cache: 'no-store' })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(d  => { if (d.error) throw new Error(d.error); setDetail(d); setLoading(false) })
      .catch((e: Error) => { setError(e.message); setLoading(false) })
  }, [themeId])

  const MOMENTUM_LABEL: Record<string, string> = {
    strong_up: '↑↑ Strong', moderate_up: '↑ Moderate',
    neutral: '→ Neutral', moderate_down: '↓ Moderate', strong_down: '↓↓ Strong',
  }

  function sigColor(s: string | null) {
    if (s === 'buy')   return 'var(--signal-bull)'
    if (s === 'avoid') return 'var(--signal-bear)'
    if (s === 'watch') return 'var(--signal-neut)'
    return 'var(--text-4)'
  }
  function sigBorder(s: string | null) {
    if (s === 'buy')   return 'rgba(var(--green-rgb), 0.3)'
    if (s === 'avoid') return 'rgba(var(--red-rgb),   0.3)'
    if (s === 'watch') return 'rgba(var(--amber-rgb), 0.3)'
    return 'var(--border)'
  }

  if (loading) return <div style={{ fontSize: '0.62rem', color: 'var(--text-4)', padding: '8px 12px' }}>Loading...</div>
  if (error || !detail) return <div style={{ fontSize: '0.62rem', color: 'var(--signal-bear)', padding: '8px 12px' }}>{error ?? 'No data'}</div>

  const mColor = momentumColor(detail.theme.momentum)

  return (
    <div style={{ padding: '10px 12px 12px' }}>
      {detail.theme.brief && (
        <p style={{ fontSize: '0.74rem', color: 'var(--text-3)', lineHeight: 1.65, margin: '0 0 10px', fontWeight: 300 }}>
          {detail.theme.brief}
        </p>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        {detail.theme.momentum && (
          <span style={{ fontSize: '0.65rem', color: mColor, letterSpacing: '0.04em' }}>
            {MOMENTUM_LABEL[detail.theme.momentum] ?? 'neutral'}
          </span>
        )}
        <div style={{ flex: 1, height: 2, background: 'var(--border)' }}>
          <div style={{ width: `${detail.theme.conviction ?? 0}%`, height: 2, background: mColor }} />
        </div>
        <span style={{ fontSize: '0.65rem', color: mColor }}>{detail.theme.conviction ?? 0}% conviction</span>
      </div>
      {detail.theme.anchor_reason && (
        <div style={{ fontSize: '0.6rem', color: 'var(--text-4)', marginBottom: 10, fontStyle: 'italic' }}>
          anchor: {detail.theme.anchor_reason}
        </div>
      )}
      {detail.tickers.length > 0 && (
        <>
          <div style={{ fontSize: '0.58rem', color: 'var(--text-4)', letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 6 }}>
            ## Candidate assets
          </div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
            {detail.tickers.map(t => (
              <Link key={t.ticker} href={`/dashboard/tickers/${t.ticker}`}
                style={{ border: '1px solid var(--border)', padding: '6px 9px', background: 'var(--bg-subtle)', minWidth: 80, display: 'block', textDecoration: 'none' }}
                onClick={e => e.stopPropagation()}>
                <div style={{ fontSize: '0.8rem', color: 'var(--signal-bull)', letterSpacing: '0.05em', fontFamily: 'var(--font-mono)' }}>{t.ticker}</div>
                {t.asset_type && (
                  <div style={{ fontSize: '0.56rem', color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 1 }}>{t.asset_type}</div>
                )}
                <div style={{ fontSize: '0.6rem', color: 'var(--text-3)', marginTop: 2 }}>{Math.round(t.final_weight)}%</div>
                {t.price_usd != null && (
                  <div style={{ fontSize: '0.6rem', color: 'var(--text-2)', marginTop: 1, fontFamily: 'var(--font-mono)' }}>
                    ${t.price_usd.toFixed(2)}
                    {t.change_pct != null && (
                      <span style={{ color: t.change_pct >= 0 ? 'var(--signal-bull)' : 'var(--signal-bear)', marginLeft: 4 }}>
                        {t.change_pct >= 0 ? '+' : ''}{t.change_pct.toFixed(2)}%
                      </span>
                    )}
                  </div>
                )}
                {t.signal && (
                  <div style={{ fontSize: '0.56rem', padding: '1px 5px', border: `1px solid ${sigBorder(t.signal)}`, color: sigColor(t.signal), marginTop: 3, display: 'inline-block', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                    {t.signal}
                  </div>
                )}
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── Suggested actions ─────────────────────────────────────────────────────────

function buildActions(regime: Regime | null, themes: HomeTheme[], hasHoldings: boolean) {
  const actions = []
  if (themes[0]) actions.push({ num: '01', title: `Review: ${themes[0].name}`, sub: `${themes[0].conviction ?? 0}% conviction · ${themes[0].timeframe} horizon`, href: '/dashboard/themes' })
  if (regime?.risk_bias === 'risk-off') {
    actions.push({ num: '02', title: 'Find safe-haven assets', sub: 'Regime is risk-off — defensive positioning recommended', href: '/dashboard/assets' })
  } else if (regime?.risk_bias === 'risk-on') {
    actions.push({ num: '02', title: 'Explore growth opportunities', sub: 'Regime is risk-on — consider adding growth exposure', href: '/dashboard/assets' })
  } else {
    actions.push({ num: '02', title: 'Screen regime-aligned assets', sub: 'Find assets that match the current market environment', href: '/dashboard/assets' })
  }
  actions.push(!hasHoldings
    ? { num: '03', title: 'Set up your portfolio', sub: 'Add holdings to unlock personalised macro impact analysis', href: '/dashboard/portfolio' }
    : { num: '03', title: 'Review portfolio risk exposure', sub: "Check how today's regime affects your specific positions", href: '/dashboard/portfolio' }
  )
  return actions
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  regime: Regime | null; macro: MacroSnapshot; themes: HomeTheme[]
  events: HomeEvent[]; portfolio: PortfolioSummary; latestAlert: PortfolioAlert | null; hasHoldings: boolean
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function HomeClient({ regime, macro, themes, events, portfolio, latestAlert, hasHoldings }: Props) {
  const [expandedThemeId, setExpandedThemeId] = useState<string | null>(null)
  const actions = buildActions(regime, themes, hasHoldings)

  const bias       = regime?.risk_bias ?? 'neutral'
  const biasCls    = bias === 'risk-on' ? '' : bias === 'risk-off' ? styles.bearish : styles.neutral
  const badgeCls   = bias === 'risk-on' ? styles.badgeBull : bias === 'risk-off' ? styles.badgeBear : styles.badgeNeut
  const badgeLabel = bias === 'risk-on' ? 'Risk-on' : bias === 'risk-off' ? 'Risk-off' : regime?.style_bias ?? 'Neutral'

  const sentStr   = macro.avg_sentiment !== null ? `${macro.avg_sentiment >= 0 ? '+' : ''}${macro.avg_sentiment.toFixed(2)}` : '—'
  const sentDir   = macro.avg_sentiment !== null && macro.avg_sentiment > 0.1 ? 'Risk-on' : macro.avg_sentiment !== null && macro.avg_sentiment < -0.1 ? 'Risk-off' : 'Neutral'
  const sentClass = macro.avg_sentiment !== null && macro.avg_sentiment > 0.1 ? styles.up : macro.avg_sentiment !== null && macro.avg_sentiment < -0.1 ? styles.down : styles.neut

  return (
    <div className={styles.page}>

      {/* ── REGIME BANNER ── */}
      {regime ? (
        <div className={`${styles.regime} ${biasCls}`}>
          <div className={styles.regimeMain}>
            <div className={styles.regimeLabel}>Market regime · updated {relTime(regime.refreshed_at)}</div>
            <div className={styles.regimeName}>{regime.label}</div>
            {regime.rationale && (
              <div className={styles.regimeSub}>
                {regime.rationale.slice(0, 180)}{regime.rationale.length > 180 ? '…' : ''}
              </div>
            )}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px', alignItems: 'center' }}>
              <span className={`${styles.regimeBadge} ${badgeCls}`}>{badgeLabel}</span>
              {regime.cycle_phase  && <span className={`${styles.regimeBadge} ${styles.badgeNeut}`}>{regime.cycle_phase} cycle</span>}
              {regime.style_bias   && <span className={`${styles.regimeBadge} ${styles.badgeNeut}`}>{regime.style_bias}</span>}
            </div>
            {(regime.favoured_sectors?.length || regime.avoid_sectors?.length) && (
              <div style={{ display: 'flex', gap: '12px', marginTop: '8px', flexWrap: 'wrap' }}>
                {!!regime.favoured_sectors?.length && (
                  <div style={{ display: 'flex', gap: '5px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span className={styles.sectorLabel}>Favour</span>
                    {regime.favoured_sectors.slice(0, 4).map(s => (
                      <span key={s} className={styles.sectorBull}>{s}</span>
                    ))}
                  </div>
                )}
                {!!regime.avoid_sectors?.length && (
                  <div style={{ display: 'flex', gap: '5px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span className={styles.sectorLabel}>Avoid</span>
                    {regime.avoid_sectors.slice(0, 3).map(s => (
                      <span key={s} className={styles.sectorBear}>{s}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className={styles.regimeConv}>
            <div className={styles.regimeConvNum}>{regime.confidence}%</div>
            <div className={styles.regimeConvBar}>
              <div className={styles.regimeConvFill} style={{ width: `${regime.confidence}%` }} />
            </div>
            <div className={styles.regimeConvLabel}>Confidence</div>
          </div>
        </div>
      ) : (
        <div className={styles.regime}>
          <div className={styles.regimeMain}>
            <div className={styles.regimeLabel}>Market regime</div>
            <div className={`${styles.regimeName} ${styles.mute}`}>No regime data — run the regime cron to generate</div>
          </div>
        </div>
      )}

      {/* ── MACRO STRIP ── */}
      <div className={styles.macroStrip}>
        <div className={styles.macroCell}>
          <div className={styles.macroCellLabel}>Avg sentiment</div>
          <div className={`${styles.macroCellVal} ${sentClass}`}>{sentStr}</div>
          <div className={`${styles.macroCellSub} ${sentClass}`}>{sentDir}</div>
        </div>
        <div className={styles.macroCell}>
          <div className={styles.macroCellLabel}>Signals today</div>
          <div className={styles.macroCellVal}>{macro.signals_today}</div>
          <div className={`${styles.macroCellSub} ${macro.high_impact > 0 ? styles.neut : styles.mute}`}>
            {macro.high_impact > 0 ? `↑ ${macro.high_impact} high-impact` : 'None high-impact'}
          </div>
        </div>
        <div className={styles.macroCell}>
          <div className={styles.macroCellLabel}>Active themes</div>
          <div className={styles.macroCellVal}>{macro.active_themes}</div>
          <div className={`${styles.macroCellSub} ${styles.up}`}>{macro.active_themes > 0 ? `${macro.active_themes} tracked` : 'None active'}</div>
        </div>
        <div className={styles.macroCell}>
          <div className={styles.macroCellLabel}>Buy signals</div>
          <div className={`${styles.macroCellVal} ${macro.buy_signals > 0 ? styles.up : styles.mute}`}>{macro.buy_signals}</div>
          <div className={`${styles.macroCellSub} ${macro.avoid_signals > 0 ? styles.down : styles.mute}`}>
            {macro.avoid_signals > 0 ? `${macro.avoid_signals} avoid` : 'None to avoid'}
          </div>
        </div>
      </div>

      {/* ── THEMES + EVENTS ── */}
      <div className={styles.twoCol}>
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>Top themes</span>
            <Link href="/dashboard/themes" className={styles.panelLink}>All →</Link>
          </div>
          {themes.length === 0 ? (
            <div className={styles.empty}>No active themes — run the themes cron</div>
          ) : themes.map(t => {
            const isExpanded = expandedThemeId === t.id
            const mColor = momentumColor(t.momentum)
            return (
              <div key={t.id}>
                <div className={styles.themeItem} onClick={() => setExpandedThemeId(isExpanded ? null : t.id)} style={{ cursor: 'pointer', userSelect: 'none' }}>
                  <div className={styles.themeDot} style={{ background: mColor }} />
                  <div className={styles.themeName}>{t.name}</div>
                  <div className={styles.themeTf}>{t.timeframe}</div>
                  <div className={styles.themeConv} style={{ color: mColor }}>{t.conviction ?? 0}%</div>
                  <span className={styles.expandIcon}>{isExpanded ? '▲' : '▼'}</span>
                </div>
                {isExpanded && (
                  <div className={styles.themeExpand} style={{ borderLeft: `2px solid ${mColor}` }} onClick={e => e.stopPropagation()}>
                    <ThemeDetailPanel themeId={t.id} />
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>Top events</span>
            <Link href="/dashboard/events" className={styles.panelLink}>All →</Link>
          </div>
          {events.length === 0 ? (
            <div className={styles.empty}>No events in the last 24h</div>
          ) : events.map(e => (
            <div key={e.id} className={styles.eventItem}>
              <div className={styles.eventRow}>
                <div className={styles.eventDot} style={{ background: sentimentColor(e.sentiment_score) }} />
                <div className={styles.eventHeadline}>{e.headline}</div>
                <div className={`${styles.eventScore} ${sentimentClass(e.sentiment_score)}`}>
                  {e.sentiment_score !== null ? `${e.sentiment_score >= 0 ? '+' : ''}${e.sentiment_score.toFixed(2)}` : '—'}
                </div>
              </div>
              <div className={styles.eventMeta}>{e.event_type?.replace(/_/g, ' ') ?? 'general'} · {relTime(e.published_at)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── PORTFOLIO + ACTIONS ── */}
      <div className={styles.twoCol}>
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>My portfolio</span>
            <Link href="/dashboard/portfolio" className={styles.panelLink}>{hasHoldings ? 'Manage →' : 'Set up →'}</Link>
          </div>
          {!hasHoldings ? (
            <div className={styles.portfolioEmpty}>
              <div className={styles.portfolioEmptyTitle}>No holdings yet</div>
              <div className={styles.portfolioEmptySub}>Add your holdings to see how today's regime affects your positions.</div>
              <Link href="/dashboard/portfolio" className={styles.ctaBtn}>+ Add holdings</Link>
            </div>
          ) : (
            <>
              <div className={styles.portfolioKpis}>
                <div className={styles.portfolioKpiCell}>
                  <div className={styles.portfolioKpiLabel}>Value</div>
                  <div className={styles.portfolioKpiVal}>{fmtCurrency(portfolio.total_value)}</div>
                  {portfolio.total_pnl !== null && (
                    <div className={`${styles.portfolioKpiSub} ${portfolio.total_pnl >= 0 ? styles.up : styles.down}`}>
                      {portfolio.total_pnl >= 0 ? '+' : ''}{fmtCurrency(portfolio.total_pnl)}
                    </div>
                  )}
                </div>
                <div className={styles.portfolioKpiCell}>
                  <div className={styles.portfolioKpiLabel}>P&amp;L</div>
                  <div className={`${styles.portfolioKpiVal} ${(portfolio.total_pnl_pct ?? 0) >= 0 ? styles.up : styles.down}`}>
                    {portfolio.total_pnl_pct !== null ? `${portfolio.total_pnl_pct >= 0 ? '+' : ''}${portfolio.total_pnl_pct.toFixed(1)}%` : '—'}
                  </div>
                  <div className={`${styles.portfolioKpiSub} ${styles.mute}`}>unrealised</div>
                </div>
                <div className={styles.portfolioKpiCell}>
                  <div className={styles.portfolioKpiLabel}>Holdings</div>
                  <div className={`${styles.portfolioKpiVal} ${styles.mute}`}>{portfolio.holdings_count}</div>
                  <div className={`${styles.portfolioKpiSub} ${styles.mute}`}>positions</div>
                </div>
              </div>
              {latestAlert && (
                <div className={styles.alertStrip}>
                  <div className={styles.alertIcon}>!</div>
                  <div className={styles.alertBody}>
                    <div className={styles.alertTitle}>{latestAlert.title}</div>
                    {latestAlert.body && <div className={styles.alertSub}>{latestAlert.body}</div>}
                  </div>
                  <div className={styles.alertTime}>{relTime(latestAlert.created_at)}</div>
                </div>
              )}
            </>
          )}
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHeader}><span className={styles.panelTitle}>Suggested actions</span></div>
          {actions.map(a => (
            <Link key={a.num} href={a.href} className={styles.actionItem}>
              <div className={styles.actionNum}>{a.num}</div>
              <div className={styles.actionBody}>
                <div className={styles.actionTitle}>{a.title}</div>
                <div className={styles.actionSub}>{a.sub}</div>
              </div>
              <div className={styles.actionArrow}>→</div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
