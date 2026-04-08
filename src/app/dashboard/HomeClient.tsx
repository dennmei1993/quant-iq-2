'use client'
// src/app/dashboard/HomeClient.tsx
// Client component — handles expand/collapse, hover states, navigation
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
      href: '/dashboard/discover',
    })
  }

  if (regime?.bias === 'bearish') {
    actions.push({
      num: '02',
      title: 'Find safe-haven assets',
      sub: `Regime is ${regime.label} — defensive positioning recommended`,
      href: '/dashboard/discover',
    })
  } else if (regime?.bias === 'bullish') {
    actions.push({
      num: '02',
      title: 'Explore growth opportunities',
      sub: `Regime is ${regime.label} — risk-on conditions`,
      href: '/dashboard/discover',
    })
  } else {
    actions.push({
      num: '02',
      title: 'Screen regime-aligned assets',
      sub: 'Find assets that match the current market environment',
      href: '/dashboard/discover',
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
  const bias       = regime?.bias ?? 'neutral'
  const regimeCls  = bias === 'bullish' ? '' : bias === 'bearish' ? styles.bearish : styles.neutral
  const badgeCls   = bias === 'bullish' ? styles.badgeBull : bias === 'bearish' ? styles.badgeBear : styles.badgeNeut
  const badgeLabel = bias === 'bullish' ? 'Bullish bias' : bias === 'bearish' ? 'Bearish bias' : 'Neutral'
  const actions    = buildActions(regime, themes, hasHoldings)

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
        <div className={`${styles.regime} ${regimeCls}`}>
          <div className={styles.regimeMain}>
            <div className={styles.regimeLabel}>
              Market regime · updated {relTime(regime.updated_at)}
            </div>
            <div className={styles.regimeName}>{regime.label}</div>
            {regime.description && (
              <div className={styles.regimeSub}>{regime.description}</div>
            )}
            <span className={`${styles.regimeBadge} ${badgeCls}`}>{badgeLabel}</span>
          </div>
          <div className={styles.regimeConv}>
            <div className={styles.regimeConvNum}>{regime.conviction}%</div>
            <div className={styles.regimeConvBar}>
              <div
                className={styles.regimeConvFill}
                style={{ width: `${regime.conviction}%` }}
              />
            </div>
            <div className={styles.regimeConvLabel}>Conviction</div>
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
            <Link href="/dashboard/discover" className={styles.panelLink}>All →</Link>
          </div>
          {themes.length === 0 ? (
            <div className={styles.empty}>No active themes — run the themes cron</div>
          ) : (
            themes.map(t => (
              <Link
                key={t.id}
                href="/dashboard/discover"
                className={styles.themeItem}
              >
                <div
                  className={styles.themeDot}
                  style={{ background: momentumColor(t.momentum) }}
                />
                <div className={styles.themeName}>{t.name}</div>
                <div className={styles.themeTf}>{t.timeframe}</div>
                <div className={styles.themeConv}>{t.conviction ?? 0}%</div>
              </Link>
            ))
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
