'use client'
// src/app/dashboard/HomeClient.tsx
// Client component — handles expand/collapse, hover states, navigation
import { useState, useEffect } from 'react'
import Link from 'next/link'
import type {
  Regime, MacroSnapshot, HomeTheme,
  HomeEvent, PortfolioSummary, PortfolioAlert,
} from './page'
import styles from './home.module.css'

// ── Helpers ───────────────────────────────────────────────────────────────────

function momentumColor(m: string | null): string {
  const map: Record<string, string> = {
    strong_up:    '#4eff91', moderate_up:   '#7affb0',
    neutral:      '#e09845',
    moderate_down:'#ff8a9a', strong_down:   '#ff4e6a',
  }
  return map[m ?? 'neutral'] ?? '#e09845'
}

function sentimentColor(s: number | null): string {
  if (s === null) return '#e09845'
  if (s > 0.1)   return '#4eff91'
  if (s < -0.1)  return '#ff4e6a'
  return '#e09845'
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
  if (mins < 60)  return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function fmt(n: number, prefix = ''): string {
  if (Math.abs(n) >= 1000) {
    return `${prefix}${(n / 1000).toFixed(1)}k`
  }
  return `${prefix}${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function fmtCurrency(n: number | null): string {
  if (n === null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}


// ── Theme detail types ────────────────────────────────────────────────────────

interface ThemeDetailTicker {
  ticker:       string
  name:         string
  asset_type:   string | null
  final_weight: number
  signal:       string | null
  score:        number | null
  price_usd:    number | null
  change_pct:   number | null
  rationale:    string | null
}

interface ThemeDetail {
  theme:   any
  tickers: ThemeDetailTicker[]
}

// ── Inline theme detail panel ─────────────────────────────────────────────────

function ThemeDetailPanel({ themeId }: { themeId: string }) {
  const [detail, setDetail] = useState<ThemeDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/themes/${themeId}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(d => {
        if (d.error) throw new Error(d.error)
        setDetail(d)
        setLoading(false)
      })
      .catch((e: Error) => {
        console.error('[ThemeDetailPanel]', e.message)
        setError(e.message)
        setLoading(false)
      })
  }, [themeId])

  const MOMENTUM_LABEL: Record<string, string> = {
    strong_up: '\u21911 Strong', moderate_up: '\u2191 Moderate',
    neutral: '\u2192 Neutral', moderate_down: '\u2193 Moderate', strong_down: '\u21932 Strong',
  }
  const MOMENTUM_COLOR: Record<string, string> = {
    strong_up: '#4eff91', moderate_up: '#7affb0',
    neutral: '#e09845', moderate_down: '#ff8a9a', strong_down: '#ff4e6a',
  }

  function sigColor(s: string | null) {
    return s === 'buy' ? '#4eff91' : s === 'avoid' ? '#ff4e6a' : s === 'watch' ? '#e09845' : '#2a3a50'
  }
  function sigBorder(s: string | null) {
    return s === 'buy' ? 'rgba(78,255,145,0.3)' : s === 'avoid' ? 'rgba(255,78,106,0.3)' : s === 'watch' ? 'rgba(224,152,69,0.3)' : '#1a2030'
  }

  if (loading) return (
    <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.62rem", color: "var(--text-faint)", padding: "8px 12px" }}>
      Loading...
    </div>
  )
  if (error || !detail) return (
    <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.62rem", color: "var(--red)", padding: "8px 12px" }}>
      {error ?? "No data"}
    </div>
  )

  const mColor = MOMENTUM_COLOR[detail.theme.momentum ?? "neutral"] ?? "#e09845"

  return (
    <div style={{ padding: "10px 12px 12px" }}>
      {detail.theme.brief && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "0.74rem", color: "var(--text-muted)", lineHeight: 1.65, margin: "0 0 10px", fontWeight: 300 }}>
          {detail.theme.brief}
        </p>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
        {detail.theme.momentum && (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: mColor, letterSpacing: "0.04em" }}>
            {MOMENTUM_LABEL[detail.theme.momentum] ?? "neutral"}
          </span>
        )}
        <div style={{ flex: 1, height: 2, background: "var(--border-default)" }}>
          <div style={{ width: `${detail.theme.conviction ?? 0}%`, height: 2, background: mColor }} />
        </div>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: mColor }}>
          {detail.theme.conviction ?? 0}% conviction
        </span>
      </div>
      {detail.theme.anchor_reason && (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--text-faint)", marginBottom: 10, fontStyle: "italic" }}>
          anchor: {detail.theme.anchor_reason}
        </div>
      )}
      {detail.tickers.length > 0 && (
        <>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.58rem", color: "var(--text-faint)", letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 6 }}>
            ## Candidate assets
          </div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 10 }}>
            {detail.tickers.map(t => (
              <Link key={t.ticker} href={`/dashboard/tickers/${t.ticker}`} style={{ border: "1px solid var(--border-default)", padding: "6px 9px", background: "var(--bg-base)", minWidth: 80, display: "block", textDecoration: "none" }} onClick={e => e.stopPropagation()}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--green)", letterSpacing: "0.05em" }}>{t.ticker}</div>
                {t.asset_type && (
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.56rem", color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 1 }}>{t.asset_type}</div>
                )}
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--text-muted)", marginTop: 2 }}>
                  {Math.round(t.final_weight)}%
                </div>
                {t.price_usd != null && (
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", color: "var(--text-secondary)", marginTop: 1 }}>
                    ${t.price_usd.toFixed(2)}
                    {t.change_pct != null && (
                      <span style={{ color: t.change_pct >= 0 ? "#4eff91" : "#ff4e6a", marginLeft: 4 }}>
                        {t.change_pct >= 0 ? "+" : ""}{t.change_pct.toFixed(2)}%
                      </span>
                    )}
                  </div>
                )}
                {t.signal && (
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.56rem", padding: "1px 5px", border: `1px solid ${sigBorder(t.signal)}`, color: sigColor(t.signal), marginTop: 3, display: "inline-block", letterSpacing: "0.06em", textTransform: "uppercase" }}>
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

// ── Suggested actions — derived from live state ────────────────────────────────

function buildActions(
  regime: Regime | null,
  themes: HomeTheme[],
  hasHoldings: boolean,
): { num: string; title: string; sub: string; href: string }[] {
  const actions = []

  if (themes[0]) {
    actions.push({
      num: '01',
      title: `Review: ${themes[0].name}`,
      sub: `${themes[0].conviction ?? 0}% conviction · ${themes[0].timeframe} horizon`,
      href: '/dashboard/themes',
    })
  }

  if (regime?.risk_bias === 'risk-off') {
    actions.push({
      num: '02',
      title: 'Find safe-haven assets',
      sub: `Regime is risk-off — defensive positioning recommended`,
      href: '/dashboard/assets',
    })
  } else if (regime?.risk_bias === 'risk-on') {
    actions.push({
      num: '02',
      title: 'Explore growth opportunities',
      sub: `Regime is risk-on — consider adding growth exposure`,
      href: '/dashboard/assets',
    })
  } else {
    actions.push({
      num: '02',
      title: 'Screen regime-aligned assets',
      sub: 'Find assets that match the current market environment',
      href: '/dashboard/assets',
    })
  }

  if (!hasHoldings) {
    actions.push({
      num: '03',
      title: 'Set up your portfolio',
      sub: 'Add holdings to unlock personalised macro impact analysis',
      href: '/dashboard/portfolio',
    })
  } else {
    actions.push({
      num: '03',
      title: 'Review portfolio risk exposure',
      sub: 'Check how today\'s regime affects your specific positions',
      href: '/dashboard/portfolio',
    })
  }

  return actions
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  regime:       Regime | null
  macro:        MacroSnapshot
  themes:       HomeTheme[]
  events:       HomeEvent[]
  portfolio:    PortfolioSummary
  latestAlert:  PortfolioAlert | null
  hasHoldings:  boolean
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function HomeClient({
  regime, macro, themes, events, portfolio, latestAlert, hasHoldings,
}: Props) {
  const bias       = regime?.risk_bias ?? 'neutral'
  // Normalise risk_bias to bullish/bearish/neutral for styling
  const biasCls    = bias === 'risk-on'  ? '' :
                     bias === 'risk-off' ? styles.bearish : styles.neutral
  const badgeCls   = bias === 'risk-on'  ? styles.badgeBull :
                     bias === 'risk-off' ? styles.badgeBear : styles.badgeNeut
  const badgeLabel = bias === 'risk-on'  ? 'Risk-on' :
                     bias === 'risk-off' ? 'Risk-off' :
                     regime?.style_bias ?? 'Neutral'
  const actions    = buildActions(regime, themes, hasHoldings)
  const [expandedThemeId, setExpandedThemeId] = useState<string | null>(null)

  const sentStr = macro.avg_sentiment !== null
    ? `${macro.avg_sentiment >= 0 ? '+' : ''}${macro.avg_sentiment.toFixed(2)}`
    : '—'
  const sentDir = macro.avg_sentiment !== null && macro.avg_sentiment > 0.1
    ? 'Risk-on' : macro.avg_sentiment !== null && macro.avg_sentiment < -0.1
    ? 'Risk-off' : 'Neutral'
  const sentClass = macro.avg_sentiment !== null && macro.avg_sentiment > 0.1
    ? styles.up : macro.avg_sentiment !== null && macro.avg_sentiment < -0.1
    ? styles.down : styles.neut

  return (
    <div className={styles.page}>

      {/* ── MARKET REGIME BANNER ── */}
      {regime ? (
        <div className={`${styles.regime} ${biasCls}`}>
          <div className={styles.regimeMain}>
            <div className={styles.regimeLabel}>
              Market regime · updated {relTime(regime.refreshed_at)}
            </div>
            <div className={styles.regimeName}>{regime.label}</div>
            {regime.rationale && (
              <div className={styles.regimeSub}>
                {regime.rationale.slice(0, 180)}{regime.rationale.length > 180 ? '…' : ''}
              </div>
            )}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px', alignItems: 'center' }}>
              <span className={`${styles.regimeBadge} ${badgeCls}`}>{badgeLabel}</span>
              {regime.cycle_phase && (
                <span className={`${styles.regimeBadge} ${styles.badgeNeut}`}>{regime.cycle_phase} cycle</span>
              )}
              {regime.style_bias && (
                <span className={`${styles.regimeBadge} ${styles.badgeNeut}`}>{regime.style_bias}</span>
              )}
            </div>
            {(regime.favoured_sectors?.length || regime.avoid_sectors?.length) && (
              <div style={{ display: 'flex', gap: '12px', marginTop: '8px', flexWrap: 'wrap' }}>
                {regime.favoured_sectors && regime.favoured_sectors.length > 0 && (
                  <div style={{ display: 'flex', gap: '5px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.58rem', color: 'var(--text-faint)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Favour</span>
                    {regime.favoured_sectors.slice(0, 4).map(s => (
                      <span key={s} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', padding: '1px 7px', border: '1px solid rgba(78,255,145,0.25)', color: 'var(--green)', letterSpacing: '0.06em' }}>{s}</span>
                    ))}
                  </div>
                )}
                {regime.avoid_sectors && regime.avoid_sectors.length > 0 && (
                  <div style={{ display: 'flex', gap: '5px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.58rem', color: 'var(--text-faint)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Avoid</span>
                    {regime.avoid_sectors.slice(0, 3).map(s => (
                      <span key={s} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', padding: '1px 7px', border: '1px solid rgba(255,78,106,0.25)', color: 'var(--red)', letterSpacing: '0.06em' }}>{s}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className={styles.regimeConv}>
            <div className={styles.regimeConvNum}>{regime.confidence}%</div>
            <div className={styles.regimeConvBar}>
              <div
                className={styles.regimeConvFill}
                style={{ width: `${regime.confidence}%` }}
              />
            </div>
            <div className={styles.regimeConvLabel}>Confidence</div>
          </div>
        </div>
      ) : (
        <div className={styles.regime}>
          <div className={styles.regimeMain}>
            <div className={styles.regimeLabel}>Market regime</div>
            <div className={styles.regimeName} style={{ color: 'var(--text-faint)' }}>
              No regime data — run the regime cron to generate
            </div>
          </div>
        </div>
      )}

      {/* ── MACRO SNAPSHOT STRIP ── */}
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
          <div className={`${styles.macroCellSub} ${styles.up}`}>
            {macro.active_themes > 0 ? `${macro.active_themes} tracked` : 'None active'}
          </div>
        </div>
        <div className={styles.macroCell}>
          <div className={styles.macroCellLabel}>Buy signals</div>
          <div className={`${styles.macroCellVal} ${macro.buy_signals > 0 ? styles.up : styles.mute}`}>
            {macro.buy_signals}
          </div>
          <div className={`${styles.macroCellSub} ${macro.avoid_signals > 0 ? styles.down : styles.mute}`}>
            {macro.avoid_signals > 0 ? `${macro.avoid_signals} avoid` : 'None to avoid'}
          </div>
        </div>
      </div>

      {/* ── TOP THEMES + TOP EVENTS ── */}
      <div className={styles.twoCol}>

        {/* THEMES */}
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>Top themes</span>
            <Link href="/dashboard/themes" className={styles.panelLink}>All →</Link>
          </div>
          {themes.length === 0 ? (
            <div className={styles.empty}>No active themes — run the themes cron</div>
          ) : (
            themes.map(t => {
              const isExpanded = expandedThemeId === t.id
              return (
                <div key={t.id}>
                  <div
                    className={styles.themeItem}
                    onClick={() => setExpandedThemeId(isExpanded ? null : t.id)}
                    style={{ cursor: 'pointer', userSelect: 'none' }}
                  >
                    <div
                      className={styles.themeDot}
                      style={{ background: momentumColor(t.momentum) }}
                    />
                    <div className={styles.themeName}>{t.name}</div>
                    <div className={styles.themeTf}>{t.timeframe}</div>
                    <div className={styles.themeConv} style={{ color: momentumColor(t.momentum) }}>
                      {t.conviction ?? 0}%
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--text-faint)', marginLeft: 4 }}>
                      {isExpanded ? '▲' : '▼'}
                    </div>
                  </div>
                  {isExpanded && (
                    <div style={{
                      borderBottom: '1px solid rgba(26,32,48,0.7)',
                      background: 'rgba(78,255,145,0.02)',
                      borderLeft: `2px solid ${momentumColor(t.momentum)}`,
                      marginLeft: 12,
                    }}
                      onClick={e => e.stopPropagation()}
                    >
                      <ThemeDetailPanel themeId={t.id} />
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* EVENTS */}
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>Top events</span>
            <Link href="/dashboard/events" className={styles.panelLink}>All →</Link>
          </div>
          {events.length === 0 ? (
            <div className={styles.empty}>No events in the last 24h</div>
          ) : (
            events.map(e => (
              <div key={e.id} className={styles.eventItem}>
                <div className={styles.eventRow}>
                  <div
                    className={styles.eventDot}
                    style={{ background: sentimentColor(e.sentiment_score) }}
                  />
                  <div className={styles.eventHeadline}>{e.headline}</div>
                  <div className={`${styles.eventScore} ${sentimentClass(e.sentiment_score)}`}>
                    {e.sentiment_score !== null
                      ? `${e.sentiment_score >= 0 ? '+' : ''}${e.sentiment_score.toFixed(2)}`
                      : '—'}
                  </div>
                </div>
                <div className={styles.eventMeta}>
                  {e.event_type?.replace(/_/g, ' ') ?? 'general'} · {relTime(e.published_at)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── PORTFOLIO + SUGGESTED ACTIONS ── */}
      <div className={styles.twoCol}>

        {/* PORTFOLIO */}
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>My portfolio</span>
            <Link href="/dashboard/portfolio" className={styles.panelLink}>
              {hasHoldings ? 'Manage →' : 'Set up →'}
            </Link>
          </div>

          {!hasHoldings ? (
            <div className={styles.portfolioEmpty}>
              <div className={styles.portfolioEmptyIcon}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <rect x="1" y="4" width="12" height="9" rx="1" stroke="var(--text-faint)" strokeWidth="1"/>
                  <path d="M4 4V3a3 3 0 016 0v1" stroke="var(--text-faint)" strokeWidth="1"/>
                </svg>
              </div>
              <div className={styles.portfolioEmptyTitle}>No holdings yet</div>
              <div className={styles.portfolioEmptySub}>
                Add your holdings to see how today&apos;s regime affects your positions.
              </div>
              <Link href="/dashboard/portfolio" className={styles.ctaBtn}>
                + Add holdings
              </Link>
            </div>
          ) : (
            <>
              {/* Mini KPI strip */}
              <div className={styles.portfolioKpis}>
                <div className={styles.portfolioKpiCell}>
                  <div className={styles.portfolioKpiLabel}>Value</div>
                  <div className={styles.portfolioKpiVal}>
                    {fmtCurrency(portfolio.total_value)}
                  </div>
                  {portfolio.total_pnl !== null && (
                    <div className={`${styles.portfolioKpiSub} ${portfolio.total_pnl >= 0 ? styles.up : styles.down}`}>
                      {portfolio.total_pnl >= 0 ? '+' : ''}{fmtCurrency(portfolio.total_pnl)}
                    </div>
                  )}
                </div>
                <div className={styles.portfolioKpiCell}>
                  <div className={styles.portfolioKpiLabel}>P&amp;L</div>
                  <div className={`${styles.portfolioKpiVal} ${portfolio.total_pnl_pct !== null && portfolio.total_pnl_pct >= 0 ? styles.up : styles.down}`}>
                    {portfolio.total_pnl_pct !== null
                      ? `${portfolio.total_pnl_pct >= 0 ? '+' : ''}${portfolio.total_pnl_pct.toFixed(1)}%`
                      : '—'}
                  </div>
                  <div className={styles.portfolioKpiSub} style={{ color: 'var(--text-faint)' }}>unrealised</div>
                </div>
                <div className={styles.portfolioKpiCell}>
                  <div className={styles.portfolioKpiLabel}>Holdings</div>
                  <div className={styles.portfolioKpiVal} style={{ color: 'var(--text-muted)' }}>
                    {portfolio.holdings_count}
                  </div>
                  <div className={styles.portfolioKpiSub} style={{ color: 'var(--text-faint)' }}>positions</div>
                </div>
              </div>

              {/* Latest alert if any */}
              {latestAlert && (
                <div className={styles.alertStrip}>
                  <div className={styles.alertIcon}>!</div>
                  <div className={styles.alertBody}>
                    <div className={styles.alertTitle}>{latestAlert.title}</div>
                    {latestAlert.body && (
                      <div className={styles.alertSub}>{latestAlert.body}</div>
                    )}
                  </div>
                  <div className={styles.alertTime}>{relTime(latestAlert.created_at)}</div>
                </div>
              )}
            </>
          )}
        </div>

        {/* SUGGESTED ACTIONS */}
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>Suggested actions</span>
          </div>
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
