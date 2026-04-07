'use client'
// src/components/landing/LandingPage.tsx — Terminal / Minimal Dark
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import styles from './landing.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function sentimentColor(score: number | null): string {
  if (score === null) return '#e09845'
  if (score > 0.1) return '#4eff91'
  if (score < -0.1) return '#ff4e6a'
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
    strong_up: '#4eff91', moderate_up: '#4eff91',
    neutral: '#e09845',
    moderate_down: '#ff4e6a', strong_down: '#ff4e6a',
  }
  return map[momentum ?? 'neutral'] ?? '#e09845'
}

function momentumLabel(momentum: string | null): string {
  const map: Record<string, string> = {
    strong_up: '↑↑ STRONG', moderate_up: '↑ MOD',
    neutral: '→ NEUTRAL',
    moderate_down: '↓ MOD', strong_down: '↓↓ STRONG',
  }
  return map[momentum ?? 'neutral'] ?? '→ NEUTRAL'
}

function signalColor(signal: string): string {
  const map: Record<string, string> = {
    buy: '#4eff91', watch: '#e09845',
    hold: '#2a3a50', avoid: '#ff4e6a',
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
  const color = pct >= 60 ? '#4eff91' : pct <= 40 ? '#ff4e6a' : '#e09845'
  const bars = [pct * 0.5, pct * 0.65, pct * 0.75, pct * 0.83, pct * 0.9, pct * 0.96, pct]
  const max = Math.max(...bars)
  return (
    <span className={styles.spark}>
      {bars.map((v, i) => (
        <span key={i} className={styles.sparkBar}
          style={{ height: `${Math.round(v / max * 14) + 2}px`, background: color }} />
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

  // Typing animation for hero title
  const [typed, setTyped] = useState(0)
  const fullTitle = 'Markets move on events.'

  useEffect(() => {
    if (typed < fullTitle.length) {
      const t = setTimeout(() => setTyped(n => n + 1), 38)
      return () => clearTimeout(t)
    }
  }, [typed])

  useEffect(() => {
    Promise.all([
      fetch('/api/events?limit=8&fields=tickers').then(r => r.json()).catch(() => ({ events: [] })),
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
          setTimeout(() => e.target.classList.add(styles.visible), i * 55)
          obs.unobserve(e.target)
        }
      })
    }, { threshold: 0.06 })
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

  // Derived
  const themesByTF = themes.filter(t => t.timeframe === themeTF)
  const currentTheme = selectedTheme !== null ? themesByTF[selectedTheme] : null
  const filteredSignals = assetFilter === 'all' ? signals : signals.filter(a => a.asset_type === assetFilter)
  const avgSentiment = events.length
    ? events.reduce((s, e) => s + (e.sentiment_score ?? 0), 0) / events.length
    : null
  const topEvents = [...events]
    .sort((a, b) => (b.impact_score ?? 0) - (a.impact_score ?? 0))
    .slice(0, 4)

  const TAB_TITLES: Record<string, string> = {
    overview: 'overview', events: 'event_feed',
    themes: 'themes', assets: 'asset_screener', portfolio: 'portfolio',
  }

  const NAV_ITEMS = [
    { id: 'overview',  icon: '⬡', label: 'overview',       section: 'core' },
    { id: 'events',    icon: '↯', label: 'event_feed',     section: null },
    { id: 'themes',    icon: '◈', label: 'themes',         section: 'advisory' },
    { id: 'assets',    icon: '▤', label: 'asset_screener', section: null },
    { id: 'portfolio', icon: '▦', label: 'portfolio',      section: 'account' },
  ]

  const typeCls: Record<string, string> = {
    stock: styles.typeStock, etf: styles.typeEtf,
    crypto: styles.typeCrypto, commodity: styles.typeCmdty,
  }

  return (
    <div className={styles.page}>

      {/* ── NAV ── */}
      <nav className={`${styles.nav} ${navScrolled ? styles.navScrolled : ''} ${navOpen ? styles.navOpen : ''}`}>
        <a href="#" className={styles.navLogo}>
          <span className={styles.navLogoDot} />
          QUANT_IQ
        </a>
        <ul className={styles.navLinks}>
          <li><a href="#how">// how_it_works</a></li>
          <li><a href="#demo">// dashboard</a></li>
          <li><a href="#features">// features</a></li>
          <li><a href="#pricing">// pricing</a></li>
        </ul>
        <div className={styles.navActions}>
          <a href="/auth/login" className={styles.navSignIn}>sign_in</a>
          <a href="#signup" className={styles.navCta}>early_access</a>
        </div>
        <button className={styles.hamburger} onClick={() => setNavOpen(!navOpen)} aria-label="menu">
          <span /><span /><span />
        </button>
      </nav>

      {/* ── HERO ── */}
      <section id="hero" className={styles.hero}>
        <div className={styles.heroGridBg} />
        <div className={styles.heroInner}>

          {/* Left: terminal prompt */}
          <div className={styles.heroLeft}>
            <div className={styles.heroPrompt}>
              <span className={styles.heroPromptPath}>~/quant-iq</span>
              <span className={styles.heroPromptSymbol}>$</span>
              <span style={{ color: '#2a3a50' }}>run market_intelligence --live --us</span>
            </div>

            <h1 className={styles.heroTitle}>
              {fullTitle.slice(0, typed)}
              <span className={styles.heroCursor} />
            </h1>

            <div className={styles.heroRule} />

            <p className={styles.heroSub}>
              Quant IQ ingests macro and geopolitical signals in real time, runs them through LLM classification, and surfaces ranked investment themes across stocks, ETFs, crypto, and commodities.
            </p>

            <div className={styles.heroActions}>
              <a href="#signup" className={styles.btnPrimary}>./get_access</a>
              <a href="#demo" className={styles.btnOutline}>./view_dashboard</a>
            </div>
          </div>

          {/* Right: raw event feed */}
          <div className={styles.heroRight}>
            <div className={styles.heroTermHeader}>
              <span className={styles.heroTermTitle}>event_stream.live</span>
              <span className={styles.heroTermStatus}>
                <span className={styles.heroTermStatusDot} />
                CONNECTED
              </span>
            </div>
            <div className={styles.heroFeed}>
              {events.length > 0 ? events.map((e, idx) => (
                <div key={e.id} className={styles.heroFeedRow}>
                  <span className={styles.heroFeedIdx}>{String(idx + 1).padStart(2, '0')}</span>
                  <span className={styles.heroFeedText}>{e.headline}</span>
                  <span
                    className={styles.heroFeedScore}
                    style={{ color: sentimentColor(e.sentiment_score) }}
                  >
                    {e.sentiment_score !== null
                      ? `${e.sentiment_score >= 0 ? '+' : ''}${e.sentiment_score.toFixed(2)}`
                      : ' —'}
                  </span>
                </div>
              )) : (
                Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className={styles.heroFeedRow} style={{ opacity: 0.15 + i * 0.04 }}>
                    <span className={styles.heroFeedIdx}>{String(i + 1).padStart(2, '0')}</span>
                    <span className={styles.heroFeedText} style={{ letterSpacing: 0 }}>
                      {'█'.repeat(Math.floor(Math.random() * 20 + 20))}
                    </span>
                    <span className={styles.heroFeedScore} style={{ color: '#1a2030' }}>——</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Stats strip */}
        <div className={styles.heroStats}>
          {[['500+', 'signals/day'], ['1/3/6m', 'horizons'], ['4', 'asset_classes'], ['US', 'markets']].map(([v, l]) => (
            <div key={l} className={styles.heroStatItem}>
              <div className={styles.heroStatVal}>{v}</div>
              <div className={styles.heroStatLabel}>{l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section id="how" className={styles.sectionCream}>
        <div className={`${styles.sectionHeader} ${styles.reveal}`}>
          <span className={styles.sectionLabel}>how_it_works</span>
          <h2 className={styles.sectionTitle}>event → theme → action</h2>
          <div className={styles.divider} />
          <p className={styles.sectionSubtitle}>
            Five pipeline stages. Raw news to ranked investable recommendation in seconds.
          </p>
        </div>

        <div className={styles.howTimeline}>
          {[
            ['01', '📡', 'ingest()', 'Continuous scan of news wires, Fed releases, SEC filings, earnings calls, geopolitical intelligence. 500+ signals per day.'],
            ['02', '🧠', 'classify()', 'LLM classification: event_type, sentiment ∈ [−1,+1], sector mapping, ticker resolution. Every signal, every time.'],
            ['03', '🎯', 'cluster()', 'Related signals grouped into investment themes. Conviction-ranked across 1m, 3m, 6m horizons.'],
            ['04', '💡', 'advise()', 'Candidate assets surfaced per theme — stocks, ETFs, crypto, commodities — with signal strength and rationale.'],
            ['05', '🛡️', 'protect()', 'Connect holdings. Get push alerts when macro events materially shift your portfolio risk profile.'],
          ].map(([step, icon, fn, body]) => (
            <div key={step as string} className={`${styles.howRow} ${styles.reveal}`}>
              <div className={styles.howRowLeft}>
                <span className={styles.howStep}>{step}</span>
                <span className={styles.howNode}>{icon}</span>
              </div>
              <div className={styles.howRowRight}>
                <h3>{fn as string}</h3>
                <p>{body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── DEMO ── */}
      <section id="demo" className={styles.sectionNavy}>
        <div className={styles.demoPreamble}>
          <div className={`${styles.sectionHeader} ${styles.reveal}`} style={{ marginBottom: 0 }}>
            <span className={styles.sectionLabel}>live_dashboard_preview</span>
            <h2 className={`${styles.sectionTitle} ${styles.light}`}>your_edge.app</h2>
            <div className={styles.divider} />
            <p className={`${styles.sectionSubtitle} ${styles.muted}`}>
              {dataLoaded ? '// powered by live ai-classified market data' : '// connecting to market data stream…'}
            </p>
          </div>
        </div>

        <div className={`${styles.demoSplit} ${styles.reveal}`}>

          {/* Sidebar */}
          <aside className={styles.demoNav}>
            <div className={styles.demoNavHeader}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#4eff91', letterSpacing: '0.12em' }}>
                <span style={{ marginRight: '0.4rem', fontSize: '0.65rem', opacity: 0.5 }}>$</span>
                QUANT_IQ
              </div>
            </div>

            {NAV_ITEMS.map(item => (
              <div key={item.id}>
                {item.section && <div className={styles.demoNavSection}>// {item.section}</div>}
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
                <div className={styles.demoUserName}>live_feed</div>
                <div className={styles.demoUserPlan}>AI_CLASSIFIED</div>
              </div>
            </div>
          </aside>

          {/* Content */}
          <div className={styles.demoContent}>
            <div className={styles.demoTopbar}>
              <span className={styles.demoTopbarTitle}>{TAB_TITLES[activeTab]}</span>
              <span className={styles.demoBadge}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#4eff91', display: 'inline-block', animation: 'blink 1.5s step-end infinite' }} />
                {events.length}_signals_live
              </span>
            </div>

            <div className={styles.demoBody}>

              {/* OVERVIEW */}
              {activeTab === 'overview' && (
                <>
                  {events.filter(e => (e.impact_score ?? 0) >= 7).slice(0, 1).map(e => (
                    <div key={e.id} className={styles.alertStrip}>
                      <strong style={{ color: '#ff4e6a', flexShrink: 0, letterSpacing: '0.1em' }}>ALERT</strong>
                      <span>{e.ai_summary || e.headline}</span>
                    </div>
                  ))}
                  <div className={styles.kpiRow}>
                    <div className={styles.kpiCell}>
                      <div className={styles.kpiLabel}>market_sentiment</div>
                      <div className={styles.kpiVal} style={{ color: sentimentColor(avgSentiment ?? null) }}>
                        {avgSentiment !== null ? `${avgSentiment >= 0 ? '+' : ''}${avgSentiment.toFixed(2)}` : '——'}
                      </div>
                      <div className={`${styles.kpiDelta} ${avgSentiment !== null && avgSentiment > 0 ? styles.up : styles.down}`}>
                        {avgSentiment !== null && avgSentiment > 0.1 ? '↑ risk_on' : avgSentiment !== null && avgSentiment < -0.1 ? '↓ risk_off' : '→ neutral'}
                      </div>
                    </div>
                    <div className={styles.kpiCell}>
                      <div className={styles.kpiLabel}>active_themes</div>
                      <div className={styles.kpiVal}>{themes.length}</div>
                      <div className={`${styles.kpiDelta} ${styles.up}`}>
                        {themes.filter(t => t.timeframe === '1m').length} near_term
                      </div>
                    </div>
                    <div className={styles.kpiCell}>
                      <div className={styles.kpiLabel}>buy_signals</div>
                      <div className={styles.kpiVal}>{signals.filter(s => s.signal?.signal === 'buy').length}</div>
                      <div className={`${styles.kpiDelta} ${styles.neutral}`}>
                        {signals.filter(s => s.signal?.signal === 'avoid').length} avoid
                      </div>
                    </div>
                  </div>
                  <div className={styles.demoGrid2}>
                    <div className={styles.demoPanel}>
                      <div className={styles.demoPanelTitle}>top_signals <span>LIVE</span></div>
                      {topEvents.map(e => (
                        <div key={e.id} className={styles.eventItem}>
                          <div className={styles.eventDot} style={{ background: sentimentColor(e.sentiment_score) }} />
                          <div className={styles.eventBody}>
                            <div className={styles.eventHeadline}>{e.headline}</div>
                            <div className={styles.eventMeta}>
                              <span>{e.event_type?.replace(/_/g, '_') ?? 'general'}</span>
                              <span>{relTime(e.published_at)}</span>
                            </div>
                          </div>
                          <div className={`${styles.eventScore} ${styles[`score${sentimentLabel(e.sentiment_score)}`]}`}>
                            {e.sentiment_score !== null ? `${e.sentiment_score >= 0 ? '+' : ''}${e.sentiment_score.toFixed(2)}` : '—'}
                          </div>
                        </div>
                      ))}
                      {!events.length && <div style={{ color: '#1a2030', fontSize: '0.72rem' }}>// loading…</div>}
                    </div>
                    <div className={styles.demoPanel}>
                      <div className={styles.demoPanelTitle}>active_themes</div>
                      {themes.slice(0, 5).map(t => (
                        <div key={t.id} className={styles.gaugeItem}>
                          <div className={styles.gaugeLabel}>{t.name}</div>
                          <div className={styles.gaugeBar}>
                            <div className={styles.gaugeFill} style={{ width: `${t.conviction ?? 0}%`, background: momentumColor(t.momentum) }} />
                          </div>
                          <div className={styles.gaugeVal}>{t.conviction ?? 0}%</div>
                        </div>
                      ))}
                      {!themes.length && <div style={{ color: '#1a2030', fontSize: '0.72rem' }}>// loading…</div>}
                    </div>
                  </div>
                </>
              )}

              {/* EVENTS */}
              {activeTab === 'events' && (
                <div className={styles.demoPanel}>
                  <div className={styles.demoPanelTitle}>event_intelligence_feed <span>LIVE</span></div>
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
                            <span>{e.event_type?.replace(/_/g, '_') ?? 'general'}</span>
                            <span>·</span>
                            <span>{(e.sectors ?? []).slice(0, 2).join(', ')}</span>
                            <span>{relTime(e.published_at)}</span>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <div className={`${styles.eventScore} ${styles[`score${sentimentLabel(e.sentiment_score)}`]}`}>
                            {e.sentiment_score !== null ? `${e.sentiment_score >= 0 ? '+' : ''}${e.sentiment_score.toFixed(2)}` : '—'}
                          </div>
                          <span style={{ color: '#1a2030', fontSize: '0.62rem' }}>
                            {selectedEvent === e.id ? '▲' : '▼'}
                          </span>
                        </div>
                      </div>
                      {selectedEvent === e.id && (
                        <div style={{
                          background: 'rgba(78,255,145,0.02)',
                          borderLeft: '2px solid rgba(78,255,145,0.2)',
                          padding: '0.7rem 0.9rem 0.8rem',
                          marginBottom: '0.15rem',
                          marginLeft: '0.5rem',
                        }}>
                          {e.ai_summary && (
                            <p style={{ fontSize: '0.74rem', color: '#4a5568', lineHeight: 1.75, marginBottom: '0.6rem' }}>
                              {e.ai_summary}
                            </p>
                          )}
                          <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                            <span style={{
                              fontFamily: 'monospace', fontSize: '0.6rem', fontWeight: 700,
                              padding: '0.1rem 0.35rem', letterSpacing: '0.08em',
                              color: (e.impact_score ?? 0) >= 7 ? '#ff4e6a' : '#e09845',
                            }}>
                              IMPACT:{e.impact_score ?? 1}/10
                            </span>
                            {(e.sectors ?? []).map((s: string) => (
                              <span key={s} style={{ fontFamily: 'monospace', fontSize: '0.6rem', padding: '0.1rem 0.35rem', color: '#2a3a50', letterSpacing: '0.06em' }}>
                                [{s}]
                              </span>
                            ))}
                            {(e.tickers ?? []).map((t: string) => (
                              <span key={t} style={{ fontFamily: 'monospace', fontSize: '0.6rem', fontWeight: 700, padding: '0.1rem 0.35rem', color: '#4eff91', letterSpacing: '0.08em' }}>
                                ${t}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  {!events.length && <div style={{ color: '#1a2030', fontSize: '0.72rem', padding: '0.8rem 0' }}>// loading event stream…</div>}
                </div>
              )}

              {/* THEMES */}
              {activeTab === 'themes' && (
                <>
                  <div className={styles.tfRow}>
                    <span className={styles.tfNote}>// ranked by conviction</span>
                    <div className={styles.tfToggle}>
                      {(['1m', '3m', '6m'] as TimeFrame[]).map(tf => (
                        <button key={tf} className={`${styles.tfBtn} ${themeTF === tf ? styles.tfActive : ''}`}
                          onClick={() => { setThemeTF(tf); setSelectedTheme(null) }}>
                          {tf}
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
                        <div className={styles.themeMomentum} style={{ color: momentumColor(t.momentum) }}>
                          {momentumLabel(t.momentum)}
                        </div>
                      </div>
                    ))}
                    {!themesByTF.length && <div style={{ color: '#1a2030', fontSize: '0.72rem' }}>// loading…</div>}
                  </div>
                  {currentTheme && (
                    <div className={styles.demoPanel} style={{ marginTop: '1px' }}>
                      <div className={styles.demoPanelTitle}>theme_brief — <span style={{ color: '#4eff91' }}>{currentTheme.name}</span></div>
                      <p className={styles.themeBrief}>{currentTheme.brief}</p>
                      <div className={styles.tickerRow}>
                        {(currentTheme.candidate_tickers ?? []).map(a => (
                          <span key={a} className={styles.tickerPill}>${a}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ASSETS */}
              {activeTab === 'assets' && (
                <>
                  <div className={styles.filterBar}>
                    {['all', 'stock', 'etf', 'crypto', 'commodity'].map(f => (
                      <button key={f} className={`${styles.filterBtn} ${assetFilter === f ? styles.filterActive : ''}`}
                        onClick={() => setAssetFilter(f)}>
                        {f === 'commodity' ? 'cmdty' : f}
                      </button>
                    ))}
                  </div>
                  <div className={styles.demoPanel}>
                    <table className={styles.assetTable}>
                      <thead>
                        <tr><th>ticker</th><th>name</th><th>type</th><th>signal</th><th>score</th><th>trend</th></tr>
                      </thead>
                      <tbody>
                        {filteredSignals.map(a => (
                          <tr key={a.ticker}>
                            <td><span className={styles.assetTicker}>${a.ticker}</span></td>
                            <td className={styles.assetName}>{a.name}</td>
                            <td>
                              <span className={`${styles.typeBadge} ${typeCls[a.asset_type] ?? ''}`}>
                                {a.asset_type === 'commodity' ? 'cmdty' : a.asset_type}
                              </span>
                            </td>
                            <td>
                              <span style={{ color: signalColor(a.signal?.signal ?? 'hold'), fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.08em' }}>
                                {(a.signal?.signal ?? 'hold').toUpperCase()}
                              </span>
                            </td>
                            <td style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: (a.signal?.score ?? 50) >= 50 ? '#4eff91' : '#ff4e6a' }}>
                              {a.signal?.score != null ? `${a.signal.score >= 50 ? '+' : ''}${(a.signal.score / 100).toFixed(2)}` : '——'}
                            </td>
                            <td><Sparkline score={a.signal?.score ?? null} /></td>
                          </tr>
                        ))}
                        {!filteredSignals.length && (
                          <tr><td colSpan={6} style={{ color: '#1a2030', fontSize: '0.72rem', padding: '1rem' }}>// loading asset data…</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* PORTFOLIO */}
              {activeTab === 'portfolio' && (
                <div className={styles.demoPanel} style={{ textAlign: 'center', padding: '3.5rem 2rem' }}>
                  <div style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: '#2a3a50', marginBottom: '1rem', letterSpacing: '0.1em' }}>
                    ERROR: authentication_required
                  </div>
                  <div style={{ color: '#4a5568', fontSize: '0.78rem', marginBottom: '0.4rem' }}>
                    portfolio_tracking requires account credentials.
                  </div>
                  <div style={{ color: '#2a3a50', fontSize: '0.74rem', marginBottom: '1.8rem' }}>
                    sign up to track holdings and receive AI advisory memos.
                  </div>
                  <a href="/auth/signup" className={styles.btnPrimary} style={{ display: 'inline-block', fontSize: '0.72rem' }}>
                    ./create_account
                  </a>
                </div>
              )}

            </div>
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section id="features" className={styles.sectionLight}>
        <div className={`${styles.sectionHeader} ${styles.reveal}`}>
          <span className={styles.sectionLabel}>platform_features</span>
          <h2 className={styles.sectionTitle}>built for serious<br />independent investors</h2>
          <div className={styles.divider} />
          <p className={styles.sectionSubtitle}>
            Everything you need to stay ahead of macro shifts. No research team required.
          </p>
        </div>
        <div className={styles.featGrid}>
          {[
            ['📡', 'ingest()', '500+ signals per day from news wires, Fed releases, SEC filings, earnings calls, and geopolitical intelligence.', 'LIVE'],
            ['🧠', 'classify()', 'LLM classification and sentiment scoring on every event — type, sentiment ∈ [−1,+1], sector, ticker.', 'AI'],
            ['🎯', 'theme()', 'Related signals clustered into investment theses with 1m, 3m, 6m conviction scores.', 'PROP'],
            ['📊', 'screen()', 'Candidate assets across US equities, ETFs, BTC, ETH, and key commodities — ranked by alignment.', '4x'],
            ['🛡️', 'protect()', 'Connect holdings. Get alerts when macro events materially shift your specific position risk.', 'PNL'],
            ['🔔', 'alert()', 'Push, email, and in-app alerts triggered on high-impact events affecting your portfolio.', 'RT'],
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
      <section id="pricing" className={styles.sectionCreamAlt}>
        <div className={`${styles.sectionHeader} ${styles.reveal}`}>
          <span className={styles.sectionLabel}>pricing</span>
          <h2 className={styles.sectionTitle}>simple, transparent</h2>
          <div className={styles.divider} />
          <p className={styles.sectionSubtitle}>Start free, upgrade when you&apos;re ready. No hidden fees, cancel any time.</p>
        </div>
        <div className={styles.pricingGrid}>
          <div className={`${styles.priceCard} ${styles.reveal}`}>
            <div className={styles.priceName}>free</div>
            <div className={styles.priceVal}>$0</div>
            <div className={styles.pricePer}>forever</div>
            <ul>
              <li>5 events per day</li>
              <li>1-month themes only</li>
              <li>3 watchlist assets</li>
              <li>Daily digest email</li>
            </ul>
            <a href="/auth/signup" className={`${styles.priceBtn} ${styles.priceBtnOutline}`}>./get_started</a>
          </div>
          <div className={`${styles.priceCard} ${styles.priceFeatured} ${styles.reveal}`}>
            <div className={styles.priceName}>pro</div>
            <div className={styles.priceVal} style={{ color: '#4eff91' }}>$29</div>
            <div className={styles.pricePer}>/month</div>
            <ul>
              <li>Unlimited event feed</li>
              <li>1 / 3 / 6 month themes</li>
              <li>Full asset screener</li>
              <li>Portfolio impact engine</li>
              <li>Real-time alerts</li>
              <li>Advisory memos (AI)</li>
            </ul>
            <a href="/auth/signup" className={`${styles.priceBtn} ${styles.priceBtnGold}`}>./start_trial</a>
          </div>
          <div className={`${styles.priceCard} ${styles.reveal}`}>
            <div className={styles.priceName}>advisor</div>
            <div className={styles.priceVal}>$99</div>
            <div className={styles.pricePer}>/month · RIA &amp; professionals</div>
            <ul>
              <li>Everything in Pro</li>
              <li>API data access</li>
              <li>Client portfolio tracking</li>
              <li>Custom alert rules</li>
              <li>Priority support</li>
            </ul>
            <a href="/auth/signup" className={`${styles.priceBtn} ${styles.priceBtnOutline}`}>./contact_sales</a>
          </div>
        </div>
      </section>

      {/* ── SIGNUP ── */}
      <section id="signup" className={styles.sectionSignup}>
        <div className={`${styles.sectionHeader} ${styles.reveal}`} style={{ margin: '0 auto 2.5rem', textAlign: 'center' }}>
          <span className={styles.sectionLabel} style={{ justifyContent: 'center' }}>early_access</span>
          <h2 className={`${styles.sectionTitle} ${styles.light}`}>join_waitlist()<br />get_ahead(market)</h2>
          <div className={styles.divider} style={{ margin: '1rem auto 1.5rem', justifyContent: 'center' }} />
          <p className={`${styles.sectionSubtitle} ${styles.muted}`} style={{ margin: '0 auto' }}>
            Onboarding early users now. Full Pro access, first 60 days, no credit card.
          </p>
        </div>
        <form onSubmit={handleSignup} className={`${styles.signupForm} ${styles.reveal}`}>
          <input
            type="email"
            value={email}
            onChange={e => { setEmail(e.target.value); setEmailError(false) }}
            placeholder={emailError ? 'error: invalid_email_format' : '$ enter email address…'}
            className={styles.signupInput}
            style={{ borderColor: emailError ? '#ff4e6a' : undefined }}
          />
          <button type="submit" className={styles.btnPrimary} style={{ whiteSpace: 'nowrap' }}>
            ./claim_access
          </button>
        </form>
        <p className={`${styles.signupNote} ${styles.reveal}`}>
          // no_credit_card · 60d_pro_free · cancel_anytime
        </p>
      </section>

      {/* ── FOOTER ── */}
      <footer className={styles.footer}>
        <div className={styles.footerGrid}>
          <div className={styles.footerBrand}>
            <div className={styles.navLogo} style={{ marginBottom: '0.9rem' }}>
              <span className={styles.navLogoDot} />QUANT_IQ
            </div>
            <p>Quant-grade macro intelligence for independent investors and financial advisors in the US market.</p>
          </div>
          {[
            ['product', ['Dashboard', 'Event Feed', 'Theme Engine', 'Pricing']],
            ['company', ['About', 'Blog', 'Careers', 'Press']],
            ['legal', ['Privacy', 'Terms', 'Security']],
          ].map(([heading, links]) => (
            <div key={heading as string} className={styles.footerCol}>
              <h4>{heading}</h4>
              <ul>{(links as string[]).map(l => <li key={l}><a href="#">{l.toLowerCase().replace(' ', '_')}</a></li>)}</ul>
            </div>
          ))}
        </div>
        <div className={styles.footerBottom}>
          <span>// © 2026 Quant IQ Inc.</span>
          <span>US_markets_only · not_financial_advice</span>
        </div>
        <p className={styles.footerDisc}>
          Quant IQ is an information and analytics platform. Nothing on this site constitutes financial, investment, legal, or tax advice. All content is for informational purposes only. Past signal performance does not guarantee future results. Always conduct your own research and consult a qualified financial advisor before making investment decisions.
        </p>
      </footer>

    </div>
  )
}
