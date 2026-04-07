'use client'
// src/components/landing/LandingPage.tsx — Editorial Redesign
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import styles from './landing.module.css'

// ── Types ────────────────────────────────────────────────────────────────────

type LiveEvent = {
  id: string
  headline: string
  sentiment_score: number | null
  impact_score: number | null
  event_type: string | null
  sectors: string[] | null
  tickers: string[] | null
  ai_summary: string | null
  published_at: string
}

type LiveTheme = {
  id: string
  name: string
  label: string | null
  timeframe: string
  conviction: number | null
  momentum: string | null
  brief: string | null
  candidate_tickers: string[] | null
}

type LiveSignal = {
  ticker: string
  name: string
  asset_type: string
  sector: string | null
  signal: {
    signal: string
    score: number | null
    price_usd: number | null
    change_pct: number | null
    rationale: string | null
  } | null
}

type TimeFrame = '1m' | '3m' | '6m'

// ── Helpers ──────────────────────────────────────────────────────────────────

function sentimentColor(score: number | null): string {
  if (score === null) return '#e09845'
  if (score > 0.1) return '#4eca99'
  if (score < -0.1) return '#e87070'
  return '#e09845'
}

function sentimentLabel(score: number | null): string {
  if (score === null) return 'Neut'
  if (score > 0.1) return 'Bull'
  if (score < -0.1) return 'Bear'
  return 'Neut'
}

function momentumColor(momentum: string | null): string {
  const map: Record<string, string> = {
    strong_up: '#4eca99', moderate_up: '#4eca99',
    neutral: '#e09845',
    moderate_down: '#e87070', strong_down: '#e87070',
  }
  return map[momentum ?? 'neutral'] ?? '#e09845'
}

function momentumLabel(momentum: string | null): string {
  const map: Record<string, string> = {
    strong_up: '↑ Strong', moderate_up: '↑ Mod',
    neutral: '→ Neutral',
    moderate_down: '↓ Mod', strong_down: '↓ Strong',
  }
  return map[momentum ?? 'neutral'] ?? '→ Neutral'
}

function signalColor(signal: string): string {
  const map: Record<string, string> = {
    buy: '#4eca99', watch: '#e09845',
    hold: 'rgba(200,185,165,0.45)', avoid: '#e87070',
  }
  return map[signal] ?? '#e09845'
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

function Sparkline({ score }: { score: number | null }) {
  const pct = Math.min(100, Math.max(0, score ?? 50))
  const color = pct >= 60 ? '#4eca99' : pct <= 40 ? '#e87070' : '#e09845'
  const bars = [pct * 0.55, pct * 0.68, pct * 0.75, pct * 0.82, pct * 0.88, pct * 0.94, pct]
  const max = Math.max(...bars)
  return (
    <span className={styles.spark}>
      {bars.map((v, i) => (
        <span key={i} className={styles.sparkBar}
          style={{ height: `${Math.round(v / max * 16) + 2}px`, background: color }} />
      ))}
    </span>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function LandingPage() {
  const router = useRouter()
  const [navOpen, setNavOpen] = useState(false)
  const [navScrolled, setNavScrolled] = useState(false)
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')
  const [themeTF, setThemeTF] = useState<TimeFrame>('1m')
  const [selectedTheme, setSelectedTheme] = useState<number | null>(null)
  const [assetFilter, setAssetFilter] = useState('all')
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null)

  const [events, setEvents] = useState<LiveEvent[]>([])
  const [themes, setThemes] = useState<LiveTheme[]>([])
  const [signals, setSignals] = useState<LiveSignal[]>([])
  const [dataLoaded, setDataLoaded] = useState(false)

  const DEMO_EVENT_LIMIT = 6

  useEffect(() => {
    Promise.all([
      fetch(`/api/events?limit=${DEMO_EVENT_LIMIT}&fields=tickers`).then(r => r.json()).catch(() => ({ events: [] })),
      fetch('/api/themes').then(r => r.json()).catch(() => ({ themes: [] })),
      fetch('/api/assets').then(r => r.json()).catch(() => ({ assets: [] })),
    ]).then(([evData, thData, asData]) => {
      setEvents(evData.events ?? [])
      setThemes(thData.themes ?? [])
      setSignals(asData.assets ?? [])
      setDataLoaded(true)
    })
  }, [])

  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 40)
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const els = document.querySelectorAll(`.${styles.reveal}`)
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((e, i) => {
        if (e.isIntersecting) {
          setTimeout(() => e.target.classList.add(styles.visible), i * 65)
          obs.unobserve(e.target)
        }
      })
    }, { threshold: 0.08 })
    els.forEach(el => obs.observe(el))
    return () => obs.disconnect()
  }, [dataLoaded])

  function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    if (email.includes('@')) {
      router.push(`/auth/signup?email=${encodeURIComponent(email)}`)
    } else {
      setEmailError(true)
    }
  }

  // Derived data
  const themesByTF = themes.filter(t => t.timeframe === themeTF)
  const currentTheme = selectedTheme !== null ? themesByTF[selectedTheme] : null
  const filteredSignals = assetFilter === 'all'
    ? signals
    : signals.filter(a => a.asset_type === assetFilter)

  const avgSentiment = events.length
    ? events.reduce((s, e) => s + (e.sentiment_score ?? 0), 0) / events.length
    : null

  const topEvents = [...events]
    .sort((a, b) => {
      const d = (b.impact_score ?? 0) - (a.impact_score ?? 0)
      if (d !== 0) return d
      return new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
    })
    .slice(0, 4)

  const TAB_TITLES: Record<string, string> = {
    overview: 'Overview', events: 'Event Feed',
    themes: 'Themes', assets: 'Asset Screener', portfolio: 'Portfolio',
  }

  const NAV_ITEMS = [
    { id: 'overview',  icon: '⬡', label: 'Dashboard',      section: 'Overview'  },
    { id: 'events',    icon: '📡', label: 'Event Feed',     section: null        },
    { id: 'themes',    icon: '🎯', label: 'Themes',         section: 'Advisory'  },
    { id: 'assets',    icon: '📊', label: 'Asset Screener', section: null        },
    { id: 'portfolio', icon: '🗂️', label: 'My Portfolio',   section: 'Portfolio' },
  ]

  const typeCls: Record<string, string> = {
    stock: styles.typeStock, etf: styles.typeEtf,
    crypto: styles.typeCrypto, commodity: styles.typeCmdty,
  }

  return (
    <div className={styles.page}>

      {/* ── NAV ── */}
      <nav className={`${styles.nav} ${navScrolled ? styles.navScrolled : ''} ${navOpen ? styles.navOpen : ''}`}>
        <a href="#" className={styles.navLogo}><span className={styles.navLogoDot} />Quant IQ</a>
        <ul className={styles.navLinks}>
          <li><a href="#how">How It Works</a></li>
          <li><a href="#demo">Dashboard</a></li>
          <li><a href="#features">Features</a></li>
          <li><a href="#pricing">Pricing</a></li>
        </ul>
        <div className={styles.navActions}>
          <a href="/auth/login" className={styles.navSignIn}>Sign in</a>
          <a href="#signup" className={styles.navCta}>Early Access</a>
        </div>
        <button className={styles.hamburger} onClick={() => setNavOpen(!navOpen)} aria-label="menu">
          <span /><span /><span />
        </button>
      </nav>

      {/* ── HERO — split editorial ── */}
      <section id="hero" className={styles.hero}>
        <div className={styles.heroGridBg} />
        <div className={styles.heroInner}>

          {/* Left: editorial copy */}
          <div className={styles.heroLeft}>
            <span className={styles.heroEyebrow}>
              <span className={styles.heroEyebrowDot} />
              US Market Intelligence · Macro + Geopolitical
            </span>
            <h1 className={styles.heroTitle}>
              Markets move on <em>events.</em><br />
              <span>Are you ready</span><br />
              before they do?
            </h1>
            <div className={styles.heroRule} />
            <p className={styles.heroSub}>
              Quant IQ scans macro and geopolitical signals in real time, translates them into actionable investment themes, and shows you exactly which assets to consider — across stocks, ETFs, crypto and commodities.
            </p>
            <div className={styles.heroActions}>
              <a href="#signup" className={styles.btnPrimary}>Get Early Access</a>
              <a href="#demo" className={styles.btnOutline}>See Live Dashboard</a>
            </div>
          </div>

          {/* Right: live event ticker */}
          <div className={styles.heroRight}>
            <div className={styles.heroTicker}>
              <div className={styles.heroTickerLabel}>
                <span style={{
                  width: 5, height: 5, borderRadius: '50%',
                  background: '#4eca99',
                  display: 'inline-block',
                  animation: 'pulse 2s infinite',
                }} />
                Live intelligence feed
              </div>
              {events.length > 0 ? events.map(e => (
                <div key={e.id} className={styles.heroTickerRow}>
                  <div className={styles.heroTickerDot} style={{ background: sentimentColor(e.sentiment_score) }} />
                  <div className={styles.heroTickerText}>
                    <div className={styles.heroTickerHeadline}>{e.headline}</div>
                    <div className={styles.heroTickerMeta}>
                      <span>{e.event_type?.replace(/_/g, ' ') ?? 'general'}</span>
                      <span>·</span>
                      <span>{relTime(e.published_at)} ago</span>
                    </div>
                  </div>
                  <div
                    className={`${styles.heroTickerScore} ${styles[`score${sentimentLabel(e.sentiment_score)}`]}`}
                  >
                    {e.sentiment_score !== null
                      ? `${e.sentiment_score >= 0 ? '+' : ''}${e.sentiment_score.toFixed(2)}`
                      : '—'}
                  </div>
                </div>
              )) : (
                // Skeleton placeholders while loading
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className={styles.heroTickerRow} style={{ opacity: 0.3 + i * 0.1 }}>
                    <div className={styles.heroTickerDot} style={{ background: '#e09845' }} />
                    <div className={styles.heroTickerText}>
                      <div className={styles.heroTickerHeadline} style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 3, height: 12, width: '80%' }} />
                      <div className={styles.heroTickerMeta} style={{ marginTop: 6 }}>
                        <span style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 2, display: 'inline-block', width: 60, height: 8 }} />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Stats strip */}
        <div className={styles.heroStats}>
          {[['500+', 'Signals per day'], ['1/3/6m', 'Theme horizons'], ['4', 'Asset classes'], ['US', 'Market coverage']].map(([v, l]) => (
            <div key={l} className={styles.heroStatItem}>
              <div className={styles.heroStatVal}>{v}</div>
              <div className={styles.heroStatLabel}>{l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS — vertical timeline ── */}
      <section id="how" className={styles.sectionCream}>
        <div className={`${styles.sectionHeader} ${styles.reveal}`}>
          <span className={styles.sectionLabel}>How It Works</span>
          <h2 className={styles.sectionTitle}>From world event to<br />portfolio action</h2>
          <span className={styles.divider} />
          <p className={styles.sectionSubtitle}>
            Quant IQ compresses hours of research into seconds — from raw news to a ranked, investable recommendation.
          </p>
        </div>

        <div className={styles.howTimeline}>
          <div className={styles.howTimelineTrack} />
          {[
            ['01', '📡', 'Macro & Geopolitical Scanning', 'Continuous ingestion from news wires, Fed releases, SEC filings, earnings calls, and geopolitical intelligence across the US market.'],
            ['02', '🧠', 'AI Signal Classification', 'Every event is classified by type, sentiment-scored from −1 to +1, and mapped to the sectors and asset classes most likely to be affected.'],
            ['03', '🎯', 'Investment Theme Surfacing', 'Related signals are clustered into coherent investment themes ranked by conviction across 1-month, 3-month, and 6-month outlooks.'],
            ['04', '💡', 'Asset Recommendations', 'For each theme, Quant IQ surfaces candidate stocks, ETFs, crypto assets, and commodities with signal strength and entry rationale.'],
            ['05', '🛡️', 'Portfolio Impact Alerts', 'Connect your holdings and get instant alerts when a macro event meaningfully changes the risk profile of your existing positions.'],
          ].map(([step, icon, title, body]) => (
            <div key={step as string} className={`${styles.howRow} ${styles.reveal}`}>
              <div className={styles.howRowLeft}>
                <span className={styles.howStep}>{step}</span>
                <div className={styles.howNode}>{icon}</div>
              </div>
              <div className={styles.howRowRight}>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── DASHBOARD DEMO — full-width editorial split ── */}
      <section id="demo" className={styles.sectionNavy}>
        <div style={{ padding: '0 5%', marginBottom: '2.5rem' }}>
          <div className={`${styles.sectionHeader} ${styles.reveal}`} style={{ marginBottom: 0 }}>
            <span className={styles.sectionLabel}>Live Dashboard Preview</span>
            <h2 className={`${styles.sectionTitle} ${styles.light}`}>Your edge, on one screen</h2>
            <span className={styles.divider} />
            <p className={`${styles.sectionSubtitle} ${styles.muted}`}>
              {dataLoaded ? 'Powered by live AI-classified market data.' : 'Loading live market data…'}
            </p>
          </div>
        </div>

        {/* Dashboard shell */}
        <div className={`${styles.demoSplit} ${styles.reveal}`}>

          {/* Left sidebar nav */}
          <aside className={styles.demoNav}>
            <div className={styles.demoNavHeader}>
              <div style={{
                fontFamily: "'Playfair Display', serif",
                fontWeight: 900,
                fontSize: '1.1rem',
                color: '#c8a96e',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#b84c2e', display: 'inline-block' }} />
                Quant IQ
              </div>
            </div>

            {NAV_ITEMS.map(item => (
              <div key={item.id}>
                {item.section && <div className={styles.demoNavSection}>{item.section}</div>}
                <div
                  className={`${styles.demoNavItem} ${activeTab === item.id ? styles.demoNavActive : ''}`}
                  onClick={() => setActiveTab(item.id)}
                >
                  <span className={styles.demoNavIcon}>{item.icon}</span>
                  {item.label}
                </div>
              </div>
            ))}

            <div className={styles.demoNavBottom}>
              <div className={styles.demoAvatar}>QI</div>
              <div>
                <div className={styles.demoUserName}>Live Data</div>
                <div className={styles.demoUserPlan}>AI CLASSIFIED</div>
              </div>
            </div>
          </aside>

          {/* Right content */}
          <div className={styles.demoContent}>
            <div className={styles.demoTopbar}>
              <span className={styles.demoTopbarTitle}>{TAB_TITLES[activeTab]}</span>
              <span className={styles.demoBadge}>⚡ {events.length} signals</span>
            </div>

            <div className={styles.demoBody}>

              {/* ── OVERVIEW ── */}
              {activeTab === 'overview' && (
                <>
                  {events.filter(e => (e.impact_score ?? 0) >= 7).slice(0, 1).map(e => (
                    <div key={e.id} className={styles.alertStrip}>
                      <strong style={{ color: sentimentColor(e.sentiment_score), flexShrink: 0 }}>HIGH IMPACT</strong>
                      <span>{e.ai_summary || e.headline}</span>
                    </div>
                  ))}

                  {/* KPI strip */}
                  <div className={styles.kpiRow}>
                    <div className={styles.kpiCell}>
                      <div className={styles.kpiLabel}>Market Sentiment</div>
                      <div className={styles.kpiVal} style={{ color: sentimentColor(avgSentiment ?? null) }}>
                        {avgSentiment !== null ? `${avgSentiment >= 0 ? '+' : ''}${avgSentiment.toFixed(2)}` : '—'}
                      </div>
                      <div className={`${styles.kpiDelta} ${avgSentiment !== null && avgSentiment > 0 ? styles.up : styles.down}`}>
                        {avgSentiment !== null && avgSentiment > 0.1 ? '↑ Risk-on' : avgSentiment !== null && avgSentiment < -0.1 ? '↓ Risk-off' : '→ Neutral'}
                      </div>
                    </div>
                    <div className={styles.kpiCell}>
                      <div className={styles.kpiLabel}>Active Themes</div>
                      <div className={styles.kpiVal}>{themes.length}</div>
                      <div className={`${styles.kpiDelta} ${styles.up}`}>
                        ↑ {themes.filter(t => t.timeframe === '1m').length} near-term
                      </div>
                    </div>
                    <div className={styles.kpiCell}>
                      <div className={styles.kpiLabel}>Buy Signals</div>
                      <div className={styles.kpiVal}>{signals.filter(s => s.signal?.signal === 'buy').length}</div>
                      <div className={`${styles.kpiDelta} ${styles.neutral}`}>
                        ⚡ {signals.filter(s => s.signal?.signal === 'avoid').length} to avoid
                      </div>
                    </div>
                  </div>

                  <div className={styles.demoGrid2}>
                    <div className={styles.demoPanel}>
                      <div className={styles.demoPanelTitle}>Top Signals <span>LIVE</span></div>
                      {topEvents.map(e => (
                        <div key={e.id} className={styles.eventItem}>
                          <div className={styles.eventDot} style={{ background: sentimentColor(e.sentiment_score) }} />
                          <div className={styles.eventBody}>
                            <div className={styles.eventHeadline}>{e.headline}</div>
                            <div className={styles.eventMeta}>
                              <span>{e.event_type?.replace('_', ' ') ?? 'general'}</span>
                              <span>{relTime(e.published_at)}</span>
                            </div>
                          </div>
                          <div className={`${styles.eventScore} ${styles[`score${sentimentLabel(e.sentiment_score)}`]}`}>
                            {e.sentiment_score !== null ? `${e.sentiment_score >= 0 ? '+' : ''}${e.sentiment_score.toFixed(2)}` : '—'}
                          </div>
                        </div>
                      ))}
                      {!events.length && <div style={{ color: 'rgba(200,185,165,0.3)', fontSize: '0.78rem' }}>Loading…</div>}
                    </div>
                    <div className={styles.demoPanel}>
                      <div className={styles.demoPanelTitle}>Active Themes</div>
                      {themes.slice(0, 4).map(t => (
                        <div key={t.id} className={styles.gaugeItem}>
                          <div className={styles.gaugeLabel}>{t.name}</div>
                          <div className={styles.gaugeBar}>
                            <div className={styles.gaugeFill} style={{ width: `${t.conviction ?? 0}%`, background: momentumColor(t.momentum) }} />
                          </div>
                          <div className={styles.gaugeVal}>{t.conviction ?? 0}%</div>
                        </div>
                      ))}
                      {!themes.length && <div style={{ color: 'rgba(200,185,165,0.3)', fontSize: '0.78rem' }}>Loading…</div>}
                    </div>
                  </div>
                </>
              )}

              {/* ── EVENTS ── */}
              {activeTab === 'events' && (
                <div className={styles.demoPanel}>
                  <div className={styles.demoPanelTitle}>Event Intelligence Feed <span>Live</span></div>
                  {events.map(e => (
                    <div key={e.id}>
                      <div
                        className={styles.eventItem}
                        onClick={() => setSelectedEvent(selectedEvent === e.id ? null : e.id)}
                      >
                        <div className={styles.eventDot} style={{ background: sentimentColor(e.sentiment_score) }} />
                        <div className={styles.eventBody}>
                          <div className={styles.eventHeadline}>{e.headline}</div>
                          <div className={styles.eventMeta}>
                            <span>{e.event_type?.replace(/_/g, ' ') ?? 'general'} · {(e.sectors ?? []).slice(0, 2).join(', ')}</span>
                            <span>{relTime(e.published_at)} ago</span>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <div className={`${styles.eventScore} ${styles[`score${sentimentLabel(e.sentiment_score)}`]}`}>
                            {e.sentiment_score !== null ? `${e.sentiment_score >= 0 ? '+' : ''}${e.sentiment_score.toFixed(2)}` : '—'}
                          </div>
                          <span style={{ color: 'rgba(200,185,165,0.28)', fontSize: '0.65rem' }}>
                            {selectedEvent === e.id ? '▲' : '▼'}
                          </span>
                        </div>
                      </div>
                      {selectedEvent === e.id && (
                        <div style={{
                          background: 'rgba(255,255,255,0.025)',
                          border: '1px solid rgba(200,169,110,0.1)',
                          borderTop: 'none',
                          borderRadius: '0 0 4px 4px',
                          padding: '0.8rem 1rem 0.9rem',
                          marginBottom: '0.2rem',
                        }}>
                          {e.ai_summary && (
                            <p style={{ fontSize: '0.78rem', color: 'rgba(232,226,217,0.55)', lineHeight: 1.65, marginBottom: '0.65rem' }}>
                              {e.ai_summary}
                            </p>
                          )}
                          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                            <span style={{
                              fontFamily: 'monospace', fontSize: '0.62rem', fontWeight: 500,
                              padding: '0.12rem 0.4rem', borderRadius: 3,
                              background: (e.impact_score ?? 0) >= 7 ? 'rgba(232,112,112,0.12)' : 'rgba(224,152,69,0.12)',
                              color: (e.impact_score ?? 0) >= 7 ? '#e87070' : '#e09845',
                            }}>
                              {e.impact_score ?? 1}/10 impact
                            </span>
                            {(e.sectors ?? []).map((s: string) => (
                              <span key={s} style={{ fontFamily: 'monospace', fontSize: '0.62rem', padding: '0.12rem 0.4rem', borderRadius: 3, background: 'rgba(255,255,255,0.05)', color: 'rgba(232,226,217,0.38)' }}>
                                {s}
                              </span>
                            ))}
                            {(e.tickers ?? []).map((t: string) => (
                              <span key={t} style={{ fontFamily: 'monospace', fontSize: '0.62rem', fontWeight: 600, padding: '0.12rem 0.4rem', borderRadius: 3, background: 'rgba(78,202,153,0.1)', color: '#4eca99' }}>
                                {t}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  {!events.length && <div style={{ color: 'rgba(200,185,165,0.3)', fontSize: '0.78rem', padding: '1rem 0' }}>Loading…</div>}
                </div>
              )}

              {/* ── THEMES ── */}
              {activeTab === 'themes' && (
                <>
                  <div className={styles.tfRow}>
                    <span className={styles.tfNote}>Ranked by conviction</span>
                    <div className={styles.tfToggle}>
                      {(['1m', '3m', '6m'] as TimeFrame[]).map(tf => (
                        <button key={tf} className={`${styles.tfBtn} ${themeTF === tf ? styles.tfActive : ''}`}
                          onClick={() => { setThemeTF(tf); setSelectedTheme(null) }}>
                          {tf.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className={styles.themeGrid}>
                    {themesByTF.map((t, i) => (
                      <div key={t.id}
                        className={`${styles.themeCard} ${selectedTheme === i ? styles.themeSelected : ''}`}
                        onClick={() => setSelectedTheme(selectedTheme === i ? null : i)}>
                        <div className={styles.themeLabel} style={{ color: momentumColor(t.momentum) }}>{t.label ?? t.timeframe}</div>
                        <div className={styles.themeName}>{t.name}</div>
                        <div className={styles.themeConf}>
                          <span>{t.conviction ?? 0}%</span>
                          <div className={styles.confBar}>
                            <div className={styles.confFill} style={{ width: `${t.conviction ?? 0}%`, background: momentumColor(t.momentum) }} />
                          </div>
                        </div>
                        <div className={styles.themeMomentum}
                          style={{ background: `${momentumColor(t.momentum)}20`, color: momentumColor(t.momentum), border: `1px solid ${momentumColor(t.momentum)}40` }}>
                          {momentumLabel(t.momentum)}
                        </div>
                      </div>
                    ))}
                    {!themesByTF.length && <div style={{ color: 'rgba(200,185,165,0.3)', fontSize: '0.78rem' }}>Loading…</div>}
                  </div>
                  {currentTheme && (
                    <div className={styles.demoPanel} style={{ marginTop: '1rem' }}>
                      <div className={styles.demoPanelTitle}>Theme Brief — <span style={{ color: '#c8a96e' }}>{currentTheme.name}</span></div>
                      <p className={styles.themeBrief}>{currentTheme.brief}</p>
                      <div className={styles.tickerRow}>
                        {(currentTheme.candidate_tickers ?? []).map(a => <span key={a} className={styles.tickerPill}>{a}</span>)}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ── ASSETS ── */}
              {activeTab === 'assets' && (
                <>
                  <div className={styles.filterBar}>
                    {['all', 'stock', 'etf', 'crypto', 'commodity'].map(f => (
                      <button key={f} className={`${styles.filterBtn} ${assetFilter === f ? styles.filterActive : ''}`}
                        onClick={() => setAssetFilter(f)}>
                        {f === 'all' ? 'All' : f === 'commodity' ? 'CMDTY' : f.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <div className={styles.demoPanel}>
                    <table className={styles.assetTable}>
                      <thead>
                        <tr><th>Ticker</th><th>Name</th><th>Type</th><th>Signal</th><th>Score</th><th>Trend</th></tr>
                      </thead>
                      <tbody>
                        {filteredSignals.map(a => (
                          <tr key={a.ticker}>
                            <td><span className={styles.assetTicker}>{a.ticker}</span></td>
                            <td className={styles.assetName}>{a.name}</td>
                            <td>
                              <span className={`${styles.typeBadge} ${typeCls[a.asset_type] ?? ''}`}>
                                {a.asset_type === 'commodity' ? 'CMDTY' : a.asset_type.toUpperCase()}
                              </span>
                            </td>
                            <td>
                              <span style={{ color: signalColor(a.signal?.signal ?? 'hold'), fontSize: '0.7rem', fontWeight: 600, fontFamily: 'monospace' }}>
                                {(a.signal?.signal ?? 'hold').toUpperCase()}
                              </span>
                            </td>
                            <td style={{ fontFamily: 'monospace', fontSize: '0.76rem', color: (a.signal?.score ?? 50) >= 50 ? '#4eca99' : '#e87070' }}>
                              {a.signal?.score != null ? `${a.signal.score >= 50 ? '+' : ''}${(a.signal.score / 100).toFixed(2)}` : '—'}
                            </td>
                            <td><Sparkline score={a.signal?.score ?? null} /></td>
                          </tr>
                        ))}
                        {!filteredSignals.length && (
                          <tr><td colSpan={6} style={{ color: 'rgba(200,185,165,0.3)', fontSize: '0.76rem', padding: '1rem' }}>Loading…</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* ── PORTFOLIO ── */}
              {activeTab === 'portfolio' && (
                <div className={styles.demoPanel} style={{ textAlign: 'center', padding: '3rem 2rem' }}>
                  <div style={{ fontSize: '1.8rem', marginBottom: '0.9rem' }}>🗂️</div>
                  <div style={{ color: '#f5f0e8', fontWeight: 600, marginBottom: '0.4rem', fontFamily: "'Playfair Display', serif", fontSize: '1.05rem' }}>
                    Portfolio tracking requires an account
                  </div>
                  <div style={{ color: 'rgba(200,185,165,0.45)', fontSize: '0.82rem', marginBottom: '1.5rem', maxWidth: 320, margin: '0.4rem auto 1.5rem' }}>
                    Sign up free to track holdings and get personalised AI advisory memos.
                  </div>
                  <a href="/auth/signup" className={styles.btnPrimary} style={{ display: 'inline-block' }}>
                    Create Free Account
                  </a>
                </div>
              )}

            </div>
          </div>
        </div>
      </section>

      {/* ── FEATURES — magazine grid ── */}
      <section id="features" className={styles.sectionLight}>
        <div className={`${styles.sectionHeader} ${styles.reveal}`}>
          <span className={styles.sectionLabel}>Platform Features</span>
          <h2 className={styles.sectionTitle}>Built for serious<br />independent investors</h2>
          <span className={styles.divider} />
          <p className={styles.sectionSubtitle}>Everything you need to stay ahead of macro shifts — without hiring a research team.</p>
        </div>
        <div className={styles.featGrid}>
          {[
            ['📡', 'Real-Time Event Ingestion', '500+ signals per day from news wires, Fed releases, SEC filings, earnings calls, and geopolitical intelligence.', 'Live'],
            ['🧠', 'LLM-Powered Analysis', 'Every event is classified, sentiment-scored, and mapped to sectors and tickers using Claude AI — in seconds.', 'AI-Powered'],
            ['🎯', 'Investment Theme Engine', 'Signals are grouped into coherent investment theses with 1, 3, and 6-month conviction scores.', 'Proprietary'],
            ['📊', 'Multi-Asset Screener', 'Candidate assets across US stocks, ETFs, Bitcoin, Ethereum, and key commodities — ranked by theme alignment.', '4 Classes'],
            ['🛡️', 'Portfolio Impact Engine', 'Connect your holdings and see exactly how each macro event affects your specific positions.', 'Personalised'],
            ['🔔', 'Smart Alert System', 'Push, email, and in-app alerts triggered the moment a high-impact event changes your portfolio risk profile.', 'Instant'],
          ].map(([icon, title, body, tag]) => (
            <div key={title as string} className={`${styles.featCard} ${styles.reveal}`}>
              <div className={styles.featIcon}>{icon}</div>
              <h3>{title}</h3>
              <p>{body}</p>
              <span className={styles.featTag}>{tag}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── PRICING ── */}
      <section id="pricing" className={styles.sectionCream}>
        <div className={`${styles.sectionHeader} ${styles.reveal}`}>
          <span className={styles.sectionLabel}>Pricing</span>
          <h2 className={styles.sectionTitle}>Simple, transparent pricing</h2>
          <span className={styles.divider} />
          <p className={styles.sectionSubtitle}>Start free, upgrade when you&apos;re ready. No hidden fees, cancel any time.</p>
        </div>
        <div className={styles.pricingGrid}>
          <div className={`${styles.priceCard} ${styles.reveal}`}>
            <div className={styles.priceName}>Free</div>
            <div className={styles.priceVal}>$0</div>
            <div className={styles.pricePer}>forever</div>
            <ul>
              <li>5 events per day</li>
              <li>1-month themes only</li>
              <li>3 watchlist assets</li>
              <li>Daily digest email</li>
            </ul>
            <a href="/auth/signup" className={`${styles.priceBtn} ${styles.priceBtnOutline}`}>Get Started Free</a>
          </div>
          <div className={`${styles.priceCard} ${styles.priceFeatured} ${styles.reveal}`}>
            <div className={styles.priceName}>Pro</div>
            <div className={styles.priceVal} style={{ color: '#c8a96e' }}>$29</div>
            <div className={styles.pricePer}>/month · billed monthly</div>
            <ul>
              <li>Unlimited event feed</li>
              <li>1 / 3 / 6 month themes</li>
              <li>Full asset screener</li>
              <li>Portfolio impact engine</li>
              <li>Real-time alerts</li>
              <li>Advisory memos (AI)</li>
            </ul>
            <a href="/auth/signup" className={`${styles.priceBtn} ${styles.priceBtnGold}`}>Start 14-Day Free Trial</a>
          </div>
          <div className={`${styles.priceCard} ${styles.reveal}`}>
            <div className={styles.priceName}>Advisor</div>
            <div className={styles.priceVal}>$99</div>
            <div className={styles.pricePer}>/month · for RIAs &amp; professionals</div>
            <ul>
              <li>Everything in Pro</li>
              <li>API data access</li>
              <li>Client portfolio tracking</li>
              <li>Custom alert rules</li>
              <li>Priority support</li>
            </ul>
            <a href="/auth/signup" className={`${styles.priceBtn} ${styles.priceBtnOutline}`}>Contact Sales</a>
          </div>
        </div>
      </section>

      {/* ── SIGNUP ── */}
      <section id="signup" className={styles.sectionSignup}>
        <div className={`${styles.sectionHeader} ${styles.reveal}`} style={{ margin: '0 auto 2.5rem', textAlign: 'center' }}>
          <span className={styles.sectionLabel}>Early Access</span>
          <h2 className={`${styles.sectionTitle} ${styles.light}`}>Join the waitlist.<br />Get ahead of the market.</h2>
          <span className={styles.divider} style={{ margin: '1rem auto 1.5rem' }} />
          <p className={`${styles.sectionSubtitle} ${styles.muted}`} style={{ margin: '0 auto' }}>
            We&apos;re onboarding early users now. Join free — full Pro access for your first 60 days.
          </p>
        </div>
        <form onSubmit={handleSignup} className={`${styles.signupForm} ${styles.reveal}`}>
          <input
            type="email"
            value={email}
            onChange={e => { setEmail(e.target.value); setEmailError(false) }}
            placeholder={emailError ? 'Please enter a valid email' : 'Enter your work or personal email…'}
            className={styles.signupInput}
            style={{ borderColor: emailError ? '#b84c2e' : undefined }}
          />
          <button type="submit" className={styles.btnPrimary}>Claim Early Access</button>
        </form>
        <p className={`${styles.signupNote} ${styles.reveal}`}>No credit card required · 60 days Pro free · Cancel any time</p>
      </section>

      {/* ── FOOTER ── */}
      <footer className={styles.footer}>
        <div className={styles.footerGrid}>
          <div className={styles.footerBrand}>
            <div className={styles.navLogo} style={{ marginBottom: '0.9rem' }}><span className={styles.navLogoDot} />Quant IQ</div>
            <p>Quant-grade macro intelligence for independent investors and financial advisors in the US market.</p>
          </div>
          {[
            ['Product', ['Dashboard', 'Event Feed', 'Theme Engine', 'Pricing']],
            ['Company', ['About', 'Blog', 'Careers', 'Press']],
            ['Legal', ['Privacy', 'Terms', 'Security']],
          ].map(([heading, links]) => (
            <div key={heading as string} className={styles.footerCol}>
              <h4>{heading}</h4>
              <ul>{(links as string[]).map(l => <li key={l}><a href="#">{l}</a></li>)}</ul>
            </div>
          ))}
        </div>
        <div className={styles.footerBottom}>
          <span>© 2026 Quant IQ Inc. All rights reserved.</span>
          <span>US Markets Only · Not financial advice</span>
        </div>
        <p className={styles.footerDisc}>
          Quant IQ is an information and analytics platform. Nothing on this site constitutes financial, investment, legal, or tax advice. All content is for informational purposes only. Past signal performance does not guarantee future results. Always conduct your own research and consult a qualified financial advisor before making investment decisions.
        </p>
      </footer>

    </div>
  )
}
