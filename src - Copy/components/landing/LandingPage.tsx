'use client'
// src/components/landing/LandingPage.tsx
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import styles from './landing.module.css'

type Theme = { name: string; label: string; conf: number; momentum: string; color: string; brief: string; assets: string[] }
type Asset = { ticker: string; name: string; type: string; theme: string; signal: string; score: string; spark: number[] }
type TimeFrame = '1m' | '3m' | '6m'

const THEMES: Record<TimeFrame, Theme[]> = {
  '1m': [
    { name: 'AI Infrastructure Buildout', label: 'Technology', conf: 88, momentum: '↑ Strong', color: '#4eca99', brief: 'The US-Japan semiconductor deal and Nvidia H300 announcement accelerate the AI data centre buildout narrative. Short-term beneficiaries include hyperscalers and power infrastructure plays.', assets: ['NVDA','SMCI','VST','AMAT'] },
    { name: 'Defence & Aerospace Surge', label: 'Defence', conf: 82, momentum: '↑ Strong', color: '#4eca99', brief: 'The $14.2B DoD FY2027 AI procurement budget is a direct near-term catalyst for prime contractors. Autonomous systems integrators stand to benefit most.', assets: ['LMT','RTX','NOC','PLTR'] },
    { name: 'Rate Hold — Risk-Off Rotation', label: 'Macro · Fed', conf: 74, momentum: '→ Moderate', color: '#e09845', brief: 'Fed decision to hold rates tightens the high-multiple valuation compression trade. Rotation from growth into value and defensive sectors is the immediate expression.', assets: ['GLD','TLT','VPU','KO'] },
  ],
  '3m': [
    { name: 'AI Infrastructure Buildout', label: 'Technology', conf: 91, momentum: '↑ Strong', color: '#4eca99', brief: 'AI capex cycle remains structurally intact. Power, cooling, and networking sub-themes gain prominence as bottlenecks shift from compute to infrastructure.', assets: ['NVDA','NEE','ETN','CSCO'] },
    { name: 'Gold & Real Asset Hedging', label: 'Commodities', conf: 78, momentum: '↑ Building', color: '#4eca99', brief: 'Persistent inflation above 3% with Fed on hold creates a strong case for hard assets. Gold has historically outperformed in this macro configuration.', assets: ['GLD','GDX','WPM','SLV'] },
    { name: 'Energy Sector Rebalancing', label: 'Energy', conf: 55, momentum: '→ Mixed', color: '#e09845', brief: 'OPEC+ supply uncertainty creates a bifurcated energy picture. Clean energy infrastructure benefits from IRA tailwinds.', assets: ['XLE','FSLR','NEE','BKR'] },
  ],
  '6m': [
    { name: 'AI Infrastructure Buildout', label: 'Technology', conf: 94, momentum: '↑ Conviction', color: '#4eca99', brief: 'The 6-month AI theme is the highest-conviction call. Structural demand from hyperscalers, enterprise adoption, and sovereign AI programmes creates a multi-quarter tailwind.', assets: ['NVDA','AMD','MSFT','AMAT','NEE'] },
    { name: 'Defence Modernisation Supercycle', label: 'Defence', conf: 85, momentum: '↑ Strong', color: '#4eca99', brief: 'The shift toward autonomous, networked warfare systems is a 5-10 year programme. The FY2027 budget is the latest confirmation. Long-cycle contractors benefit.', assets: ['LMT','RTX','NOC','HII','PLTR'] },
    { name: 'Clean Energy Re-rating', label: 'Energy · ESG', conf: 70, momentum: '↑ Building', color: '#e09845', brief: 'IRA implementation accelerates. Solar, grid storage, and transmission plays benefit from locked-in subsidy flows regardless of rate environment.', assets: ['FSLR','ENPH','NEE','AES','ICLN'] },
    { name: 'Crypto Institutional Adoption', label: 'Digital Assets', conf: 66, momentum: '↑ Growing', color: '#e09845', brief: 'Spot ETF inflows continue. Institutional allocations to BTC as a macro hedge deepen as inflation stays elevated.', assets: ['BTC','ETH','IBIT','FBTC'] },
  ],
}

const ASSETS: Asset[] = [
  { ticker:'NVDA', name:'Nvidia Corp',         type:'stock', theme:'AI Infrastructure', signal:'buy',   score:'+0.91', spark:[5,6,7,8,7,9,11] },
  { ticker:'LMT',  name:'Lockheed Martin',      type:'stock', theme:'Defence Surge',     signal:'buy',   score:'+0.78', spark:[7,7,8,8,9,9,10] },
  { ticker:'GLD',  name:'SPDR Gold Shares ETF', type:'etf',   theme:'Rate Hold Hedge',   signal:'buy',   score:'+0.72', spark:[6,7,6,8,8,9,9]  },
  { ticker:'AMAT', name:'Applied Materials',    type:'stock', theme:'AI Infrastructure', signal:'buy',   score:'+0.68', spark:[5,5,6,7,7,8,9]  },
  { ticker:'BTC',  name:'Bitcoin',              type:'crypto',theme:'Crypto Adoption',   signal:'watch', score:'+0.41', spark:[9,7,8,6,7,8,8]  },
  { ticker:'XOM',  name:'Exxon Mobil',          type:'stock', theme:'Energy Rebalance',  signal:'hold',  score:'-0.18', spark:[9,8,8,7,7,6,6]  },
  { ticker:'GC=F', name:'Gold Futures',         type:'cmdty', theme:'Rate Hold Hedge',   signal:'buy',   score:'+0.70', spark:[6,7,7,8,8,9,9]  },
  { ticker:'CL=F', name:'WTI Crude Oil',        type:'cmdty', theme:'Energy Rebalance',  signal:'avoid', score:'-0.35', spark:[9,8,7,6,6,5,5]  },
]

function Sparkline({ vals }: { vals: number[] }) {
  const max = Math.max(...vals)
  const isUp = vals[vals.length - 1] >= vals[0]
  return (
    <span className={styles.spark}>
      {vals.map((v, i) => (
        <span key={i} className={styles.sparkBar} style={{ height: `${Math.round(v / max * 18) + 2}px`, background: isUp ? '#4eca99' : '#e87070' }} />
      ))}
    </span>
  )
}

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
          setTimeout(() => e.target.classList.add(styles.visible), i * 70)
          obs.unobserve(e.target)
        }
      })
    }, { threshold: 0.1 })
    els.forEach(el => obs.observe(el))
    return () => obs.disconnect()
  }, [])

  function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    if (email.includes('@')) {
      router.push(`/auth/signup?email=${encodeURIComponent(email)}`)
    } else {
      setEmailError(true)
    }
  }

  const filteredAssets = assetFilter === 'all' ? ASSETS : ASSETS.filter(a => a.type === assetFilter)
  const currentTheme = selectedTheme !== null ? THEMES[themeTF][selectedTheme] : null
  const signalColor: Record<string, string> = { buy: '#4eca99', watch: '#e09845', hold: 'rgba(200,185,165,0.45)', avoid: '#e87070' }
  const typeCls: Record<string, string> = { stock: styles.typeStock, etf: styles.typeEtf, crypto: styles.typeCrypto, cmdty: styles.typeCmdty }

  const TAB_TITLES: Record<string, string> = { overview: 'Overview', events: 'Event Feed', themes: 'Themes', assets: 'Asset Screener', portfolio: 'Portfolio' }
  const NAV_ITEMS = [
    { id: 'overview', icon: '⬡', label: 'Dashboard', section: 'Overview' },
    { id: 'events', icon: '📡', label: 'Event Feed', section: null },
    { id: 'themes', icon: '🎯', label: 'Themes', section: 'Advisory' },
    { id: 'assets', icon: '📊', label: 'Asset Screener', section: null },
    { id: 'portfolio', icon: '🗂️', label: 'My Portfolio', section: 'Portfolio' },
  ]

  return (
    <div className={styles.page}>

      {/* NAV */}
      <nav className={`${styles.nav} ${navScrolled ? styles.navScrolled : ''} ${navOpen ? styles.navOpen : ''}`}>
        <a href="#" className={styles.navLogo}><span className={styles.navLogoDot} />Quant IQ</a>
        <ul className={styles.navLinks}>
          <li><a href="#how">How It Works</a></li>
          <li><a href="#demo">Dashboard</a></li>
          <li><a href="#features">Features</a></li>
          <li><a href="#pricing">Pricing</a></li>
        </ul>
        <a href="#signup" className={styles.navCta}>Early Access</a>
        <button className={styles.hamburger} onClick={() => setNavOpen(!navOpen)} aria-label="menu">
          <span /><span /><span />
        </button>
      </nav>

      {/* HERO */}
      <section id="hero" className={styles.hero}>
        <div className={styles.heroGridBg} />
        <div className={styles.heroGlow} />
        <span className={styles.heroEyebrow}><span className={styles.heroEyebrowDot} />US Market Intelligence · Macro + Geopolitical</span>
        <h1 className={styles.heroTitle}>Markets move on <em>events.</em><br /><span>Are you ready</span><br />before they do?</h1>
        <p className={styles.heroSub}>Quant IQ scans macro and geopolitical signals in real time, translates them into actionable investment themes, and shows you exactly which assets to consider — across stocks, ETFs, crypto and commodities.</p>
        <div className={styles.heroActions}>
          <a href="#signup" className={styles.btnPrimary}>Get Early Access</a>
          <a href="#demo" className={styles.btnOutline}>See Live Dashboard</a>
        </div>
        <div className={styles.heroStats}>
          {[['500+','Signals per day'],['1/3/6m','Theme horizons'],['4','Asset classes'],['US','Market coverage']].map(([v, l]) => (
            <div key={l}><div className={styles.heroStatVal}>{v}</div><div className={styles.heroStatLabel}>{l}</div></div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className={styles.sectionCream}>
        <div className={`${styles.sectionHeader} ${styles.reveal}`}>
          <span className={styles.sectionLabel}>How It Works</span>
          <h2 className={styles.sectionTitle}>From world event to<br />portfolio action</h2>
          <span className={styles.divider} />
          <p className={styles.sectionSubtitle}>Quant IQ compresses hours of research into seconds — from raw news to a ranked, investable recommendation.</p>
        </div>
        <div className={styles.howGrid}>
          {[
            ['01 · INGEST','📡','Macro & Geopolitical Scanning','Continuous ingestion of news, Fed commentary, economic releases, geopolitical developments, and regulatory changes across the US market.'],
            ['02 · ANALYSE','🧠','AI Signal Classification','Every event is classified by type, sentiment scored from −1 to +1, and mapped to the sectors and asset classes most likely to be affected.'],
            ['03 · THEME','🎯','Investment Theme Surfacing','Related signals are clustered into coherent investment themes ranked by conviction, with 1-month, 3-month, and 6-month outlooks.'],
            ['04 · ADVISE','💡','Asset Recommendations','For each theme, Quant IQ surfaces candidate stocks, ETFs, crypto assets, and commodities with signal strength and entry rationale.'],
            ['05 · PROTECT','🛡️','Portfolio Impact Alerts','Connect your holdings and get instant alerts when a macro event meaningfully changes the risk profile of your existing positions.'],
          ].map(([step, icon, title, body]) => (
            <div key={title as string} className={`${styles.howCard} ${styles.reveal}`}>
              <span className={styles.howStep}>{step}</span>
              <span className={styles.howIcon}>{icon}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* DASHBOARD DEMO */}
      <section id="demo" className={styles.sectionNavy}>
        <div className={`${styles.sectionHeader} ${styles.reveal}`}>
          <span className={styles.sectionLabel}>Live Dashboard Preview</span>
          <h2 className={`${styles.sectionTitle} ${styles.light}`}>Your edge, on one screen</h2>
          <span className={styles.divider} />
          <p className={`${styles.sectionSubtitle} ${styles.muted}`}>Explore the actual advisory dashboard — live mock data, fully interactive.</p>
        </div>

        <div className={`${styles.demoFrame} ${styles.reveal}`}>
          <div className={styles.demoTitlebar}>
            <span className={styles.demoDot} style={{ background: '#e87a5a' }} />
            <span className={styles.demoDot} style={{ background: '#e09845' }} />
            <span className={styles.demoDot} style={{ background: '#4eca99' }} />
            <span className={styles.demoLabel}>quant-iq.app / dashboard</span>
          </div>

          <div className={styles.dash}>
            <div className={styles.dashSidebar}>
              <div className={styles.dashSidebarLogo}><span className={styles.dashLogoDot} />Quant IQ</div>
              {NAV_ITEMS.map(item => (
                <div key={item.id}>
                  {item.section && <div className={styles.dashNavSection}>{item.section}</div>}
                  <div className={`${styles.dashNavItem} ${activeTab === item.id ? styles.dashNavActive : ''}`} onClick={() => setActiveTab(item.id)}>
                    <span className={styles.dashNavIcon}>{item.icon}</span>{item.label}
                  </div>
                </div>
              ))}
              <div className={styles.dashSidebarBottom}>
                <div className={styles.dashAvatar}>JD</div>
                <div><div className={styles.dashUserName}>James Dao</div><div className={styles.dashUserPlan}>PRO PLAN</div></div>
              </div>
            </div>

            <div className={styles.dashMain}>
              <div className={styles.dashTopbar}>
                <span className={styles.dashTopbarTitle}>{TAB_TITLES[activeTab]}</span>
                <span className={styles.dashBadge}>⚡ 3 new signals</span>
              </div>

              {/* OVERVIEW */}
              {activeTab === 'overview' && (
                <div className={styles.dashContent}>
                  <div className={styles.alertStrip}><strong style={{ color: '#e87a5a' }}>Fed signal alert:</strong>&nbsp;Powell remarks suggest rate hold at May meeting — energy and financials most exposed.</div>
                  <div className={styles.dashGrid3}>
                    {[['Market Sentiment','−0.32','7-day score (−1 to +1)','↓ Risk-off bias','down'],['Active Themes','7','1 / 3 / 6m horizons','↑ 2 new this week','up'],['Portfolio Risk','68/100','Based on 6 holdings','⚡ Moderate — review energy','neutral']].map(([t,v,s,d,dt]) => (
                      <div key={t as string} className={styles.dashPanel}>
                        <div className={styles.dashPanelTitle}>{t}</div>
                        <div className={styles.kpiVal}>{v}</div>
                        <div className={styles.kpiSub}>{s}</div>
                        <div className={`${styles.kpiDelta} ${styles[dt as string]}`}>{d}</div>
                      </div>
                    ))}
                  </div>
                  <div className={styles.dashGrid2}>
                    <div className={styles.dashPanel}>
                      <div className={styles.dashPanelTitle}>Top Signals <span>LIVE</span></div>
                      {[['#e87070','Fed holds rates — inflation stickier than expected','Macro · Fed','08:32','-0.71','Bear'],['#4eca99','Nvidia H300 chip — 40% efficiency gain','Tech · Semi','07:15','+0.84','Bull'],['#e09845','OPEC+ considering 400K bbl/day increase','Commodity','06:50','-0.28','Neut'],['#4eca99','US-Japan semiconductor supply deal signed','Geopolitical','05:30','+0.61','Bull']].map(([dot,hl,meta,time,score,cls]) => (
                        <div key={hl as string} className={styles.eventItem}>
                          <div className={styles.eventDot} style={{ background: dot as string }} />
                          <div className={styles.eventBody}><div className={styles.eventHeadline}>{hl}</div><div className={styles.eventMeta}><span>{meta}</span><span>{time}</span></div></div>
                          <div className={`${styles.eventScore} ${styles[`score${cls}`]}`}>{score}</div>
                        </div>
                      ))}
                    </div>
                    <div className={styles.dashPanel}>
                      <div className={styles.dashPanelTitle}>Macro Environment</div>
                      {[['Fed Policy','72%','#e87070',72],['Inflation','3.1% CPI','#e09845',68],['Growth','Moderate','#4eca99',55],['Geo Risk','Medium','#e09845',45],['USD','DXY 104','#7ab4e8',63],['Credit','Contained','#4eca99',38]].map(([l,v,c,w]) => (
                        <div key={l as string} className={styles.gaugeItem}>
                          <div className={styles.gaugeLabel}>{l}</div>
                          <div className={styles.gaugeBar}><div className={styles.gaugeFill} style={{ width: `${w}%`, background: c as string }} /></div>
                          <div className={styles.gaugeVal}>{v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* EVENTS */}
              {activeTab === 'events' && (
                <div className={styles.dashContent}>
                  <div className={styles.dashPanel}>
                    <div className={styles.dashPanelTitle}>Event Intelligence Feed <span>Last 24 hours</span></div>
                    {[['#e87070','Federal Reserve holds rates at 5.25%–5.50% amid sticky inflation','Macro · Monetary Policy','Today 08:32','-0.71','Bear'],['#4eca99','Nvidia unveils H300 AI chip — 40% efficiency over H200','Corp · Semiconductors','Today 07:15','+0.84','Bull'],['#e09845','OPEC+ may increase production 400K bbl/day at June meeting','Geopolitical · Energy','Today 06:50','-0.28','Neut'],['#4eca99','US-Japan semiconductor supply chain framework signed','Geopolitical · Trade','Today 05:30','+0.61','Bull'],['#4eca99','DoD announces $14.2B AI procurement budget for FY2027','Regulatory · Defence','Yesterday 16:20','+0.78','Bull'],['#e87070','Regional bank stress tests show elevated CRE exposure','Regulatory · Banking','Yesterday 14:05','-0.55','Bear']].map(([dot,hl,meta,time,score,cls]) => (
                      <div key={hl as string} className={styles.eventItem}>
                        <div className={styles.eventDot} style={{ background: dot as string }} />
                        <div className={styles.eventBody}><div className={styles.eventHeadline}>{hl}</div><div className={styles.eventMeta}><span>{meta}</span><span>{time}</span></div></div>
                        <div className={`${styles.eventScore} ${styles[`score${cls}`]}`}>{score}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* THEMES */}
              {activeTab === 'themes' && (
                <div className={styles.dashContent}>
                  <div className={styles.tfRow}>
                    <span className={styles.tfNote}>Ranked by conviction</span>
                    <div className={styles.tfToggle}>
                      {(['1m','3m','6m'] as TimeFrame[]).map(tf => (
                        <button key={tf} className={`${styles.tfBtn} ${themeTF === tf ? styles.tfActive : ''}`} onClick={() => { setThemeTF(tf); setSelectedTheme(null) }}>{tf.toUpperCase()}</button>
                      ))}
                    </div>
                  </div>
                  <div className={styles.themeGrid}>
                    {THEMES[themeTF].map((t, i) => (
                      <div key={i} className={`${styles.themeCard} ${selectedTheme === i ? styles.themeSelected : ''}`} onClick={() => setSelectedTheme(selectedTheme === i ? null : i)}>
                        <div className={styles.themeLabel} style={{ color: t.color }}>{t.label}</div>
                        <div className={styles.themeName}>{t.name}</div>
                        <div className={styles.themeConf}><span>{t.conf}%</span><div className={styles.confBar}><div className={styles.confFill} style={{ width: `${t.conf}%`, background: t.color }} /></div></div>
                        <div className={styles.themeMomentum} style={{ background: `${t.color}22`, color: t.color, border: `1px solid ${t.color}44` }}>{t.momentum}</div>
                      </div>
                    ))}
                  </div>
                  {currentTheme && (
                    <div className={styles.dashPanel} style={{ marginTop: '1rem' }}>
                      <div className={styles.dashPanelTitle}>Theme Brief — <span style={{ color: '#c8a96e' }}>{currentTheme.name}</span></div>
                      <p className={styles.themeBrief}>{currentTheme.brief}</p>
                      <div className={styles.tickerRow}>{currentTheme.assets.map(a => <span key={a} className={styles.tickerPill}>{a}</span>)}</div>
                    </div>
                  )}
                </div>
              )}

              {/* ASSETS */}
              {activeTab === 'assets' && (
                <div className={styles.dashContent}>
                  <div className={styles.filterBar}>
                    {['all','stock','etf','crypto','cmdty'].map(f => (
                      <button key={f} className={`${styles.filterBtn} ${assetFilter === f ? styles.filterActive : ''}`} onClick={() => setAssetFilter(f)}>{f === 'all' ? 'All' : f.toUpperCase()}</button>
                    ))}
                  </div>
                  <div className={styles.dashPanel}>
                    <table className={styles.assetTable}>
                      <thead><tr><th>Ticker</th><th>Name</th><th>Type</th><th>Theme</th><th>Signal</th><th>Score</th><th>7d</th></tr></thead>
                      <tbody>
                        {filteredAssets.map(a => (
                          <tr key={a.ticker}>
                            <td><span className={styles.assetTicker}>{a.ticker}</span></td>
                            <td className={styles.assetName}>{a.name}</td>
                            <td><span className={`${styles.typeBadge} ${typeCls[a.type]}`}>{a.type.toUpperCase()}</span></td>
                            <td className={styles.assetTheme}>{a.theme}</td>
                            <td><span style={{ color: signalColor[a.signal], fontSize: '0.72rem', fontWeight: 500 }}>{a.signal.toUpperCase()}</span></td>
                            <td style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: parseFloat(a.score) >= 0 ? '#4eca99' : '#e87070' }}>{a.score}</td>
                            <td><Sparkline vals={a.spark} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* PORTFOLIO */}
              {activeTab === 'portfolio' && (
                <div className={styles.dashContent}>
                  <div className={styles.dashGrid2}>
                    <div className={styles.dashPanel}>
                      <div className={styles.dashPanelTitle}>Portfolio Value</div>
                      <div className={styles.kpiVal}>$148,240</div>
                      <div className={styles.kpiSub}>6 holdings · 4 asset classes</div>
                      <div className={`${styles.kpiDelta} ${styles.up}`}>↑ +$3,420 this month</div>
                    </div>
                    <div className={styles.dashPanel}>
                      <div className={styles.dashPanelTitle}>Event Exposure</div>
                      <div className={styles.kpiVal}>68<span style={{ fontSize: '1rem', color: 'rgba(200,185,165,0.3)' }}>/100</span></div>
                      <div className={styles.kpiSub}>Moderate risk from signals</div>
                      <div className={`${styles.kpiDelta} ${styles.neutral}`}>⚡ Fed hold affects 2 holdings</div>
                    </div>
                  </div>
                  <div className={styles.dashPanel}>
                    <div className={styles.dashPanelTitle}>Holdings · Event Impact</div>
                    {[['NVDA','Nvidia Corp','↑ Boosted','pos'],['SPY','SPDR S&P 500 ETF','⚡ Mild pressure','med'],['XOM','Exxon Mobil','⚠ Review — OPEC','high'],['BTC','Bitcoin','⚡ Rate sensitivity','med'],['GLD','SPDR Gold Shares','↑ Benefiting','pos'],['LMT','Lockheed Martin','↑ DoD budget news','pos']].map(([tk,nm,imp,cls]) => (
                      <div key={tk as string} className={styles.portHolding}>
                        <div className={styles.portTicker}>{tk}</div>
                        <div className={styles.portName}>{nm}</div>
                        <div className={`${styles.portImpact} ${styles[`impact${(cls as string).charAt(0).toUpperCase() + (cls as string).slice(1)}`]}`}>{imp}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className={styles.sectionLight}>
        <div className={`${styles.sectionHeader} ${styles.reveal}`}>
          <span className={styles.sectionLabel}>Platform Features</span>
          <h2 className={styles.sectionTitle}>Built for serious<br />independent investors</h2>
          <span className={styles.divider} />
          <p className={styles.sectionSubtitle}>Everything you need to stay ahead of macro shifts — without hiring a research team.</p>
        </div>
        <div className={styles.featGrid}>
          {[['📡','Real-Time Event Ingestion','500+ signals per day from news wires, Fed releases, SEC filings, earnings calls, and geopolitical intelligence.','Live'],['🧠','LLM-Powered Analysis','Every event is classified, sentiment-scored, and mapped to sectors and tickers using Claude AI — in seconds.','AI-Powered'],['🎯','Investment Theme Engine','Signals are grouped into coherent investment theses with 1, 3, and 6-month conviction scores.','Proprietary'],['📊','Multi-Asset Screener','Candidate assets across US stocks, ETFs, Bitcoin, Ethereum, and key commodities — ranked by theme alignment.','4 Classes'],['🛡️','Portfolio Impact Engine','Connect your holdings and see exactly how each macro event affects your specific positions.','Personalised'],['🔔','Smart Alert System','Push, email, and in-app alerts triggered the moment a high-impact event changes your portfolio risk profile.','Instant']].map(([icon,title,body,tag]) => (
            <div key={title as string} className={`${styles.featCard} ${styles.reveal}`}>
              <div className={styles.featIcon}>{icon}</div>
              <h3>{title}</h3>
              <p>{body}</p>
              <span className={styles.featTag}>{tag}</span>
            </div>
          ))}
        </div>
      </section>

      {/* PRICING */}
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
            <ul><li>5 events per day</li><li>1-month themes only</li><li>3 watchlist assets</li><li>Daily digest email</li></ul>
            <a href="#signup" className={`${styles.priceBtn} ${styles.priceBtnOutline}`}>Get Started Free</a>
          </div>
          <div className={`${styles.priceCard} ${styles.priceFeatured} ${styles.reveal}`}>
            <div className={styles.priceName}>Pro</div>
            <div className={styles.priceVal} style={{ color: '#c8a96e' }}>$29</div>
            <div className={styles.pricePer}>/month · billed monthly</div>
            <ul><li>Unlimited event feed</li><li>1 / 3 / 6 month themes</li><li>Full asset screener</li><li>Portfolio impact engine</li><li>Real-time alerts</li><li>Advisory memos (AI)</li></ul>
            <a href="#signup" className={`${styles.priceBtn} ${styles.priceBtnGold}`}>Start 14-Day Free Trial</a>
          </div>
          <div className={`${styles.priceCard} ${styles.reveal}`}>
            <div className={styles.priceName}>Advisor</div>
            <div className={styles.priceVal}>$99</div>
            <div className={styles.pricePer}>/month · for RIAs &amp; professionals</div>
            <ul><li>Everything in Pro</li><li>API data access</li><li>Client portfolio tracking</li><li>Custom alert rules</li><li>Priority support</li></ul>
            <a href="#signup" className={`${styles.priceBtn} ${styles.priceBtnOutline}`}>Contact Sales</a>
          </div>
        </div>
      </section>

      {/* SIGNUP */}
      <section id="signup" className={styles.sectionSignup}>
        <div className={`${styles.sectionHeader} ${styles.reveal}`} style={{ margin: '0 auto 2.5rem', textAlign: 'center' }}>
          <span className={styles.sectionLabel}>Early Access</span>
          <h2 className={`${styles.sectionTitle} ${styles.light}`}>Join the waitlist.<br />Get ahead of the market.</h2>
          <span className={styles.divider} style={{ margin: '1rem auto 1.5rem' }} />
          <p className={`${styles.sectionSubtitle} ${styles.muted}`} style={{ margin: '0 auto' }}>We&apos;re onboarding early users now. Join free — full Pro access for your first 60 days.</p>
        </div>
        <form onSubmit={handleSignup} className={`${styles.signupForm} ${styles.reveal}`}>
          <input type="email" value={email} onChange={e => { setEmail(e.target.value); setEmailError(false) }}
            placeholder={emailError ? 'Please enter a valid email' : 'Enter your work or personal email…'}
            className={styles.signupInput}
            style={{ borderColor: emailError ? '#b84c2e' : undefined }} />
          <button type="submit" className={styles.btnPrimary}>Claim Early Access</button>
        </form>
        <p className={`${styles.signupNote} ${styles.reveal}`}>No credit card required · 60 days Pro free · Cancel any time</p>
      </section>

      {/* FOOTER */}
      <footer className={styles.footer}>
        <div className={styles.footerGrid}>
          <div className={styles.footerBrand}>
            <div className={styles.navLogo} style={{ marginBottom: '0.9rem' }}><span className={styles.navLogoDot} />Quant IQ</div>
            <p>Quant-grade macro intelligence for independent investors and financial advisors in the US market.</p>
          </div>
          {[['Product',['Dashboard','Event Feed','Theme Engine','Pricing']],['Company',['About','Blog','Careers','Press']],['Legal',['Privacy','Terms','Security']]].map(([heading, links]) => (
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
        <p className={styles.footerDisc}>Quant IQ is an information and analytics platform. Nothing on this site constitutes financial, investment, legal, or tax advice. All content is for informational purposes only. Past signal performance does not guarantee future results. Always conduct your own research and consult a qualified financial advisor before making investment decisions.</p>
      </footer>

    </div>
  )
}
