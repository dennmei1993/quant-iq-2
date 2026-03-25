// src/components/dashboard/EventFeedPreview.tsx
import Link from 'next/link'
import styles from './ui.module.css'

interface Event {
  id: string
  headline: string
  ai_summary: string | null
  published_at: string
  event_type: string | null
  sectors: string[] | null
  sentiment_score: number | null
  impact_score: number | null
}

export function EventFeedPreview({ events }: { events: Event[] }) {
  return (
    <div className={styles.panel}>
      <div className={styles.panelTitle}>
        Top Signals
        <Link href="/dashboard/events" className={styles.panelLink}>View all →</Link>
      </div>
      <div className={styles.eventList}>
        {events.length === 0 && (
          <div className={styles.empty}>No events yet — first ingest running soon.</div>
        )}
        {events.map(e => {
          const score = e.sentiment_score ?? 0
          const scoreClass = score > 0.2 ? styles.scoreBull : score < -0.2 ? styles.scoreBear : styles.scoreNeut
          const dotColor = score > 0.2 ? '#4eca99' : score < -0.2 ? '#e87070' : '#e09845'
          const relTime = getRelativeTime(e.published_at)
          return (
            <div key={e.id} className={styles.eventItem}>
              <div className={styles.eventDot} style={{ background: dotColor }} />
              <div className={styles.eventBody}>
                <div className={styles.eventHeadline}>{e.headline}</div>
                <div className={styles.eventMeta}>
                  <span>{e.event_type ?? 'event'}</span>
                  <span>{relTime}</span>
                </div>
              </div>
              <div className={`${styles.eventScore} ${scoreClass}`}>
                {score >= 0 ? '+' : ''}{score.toFixed(2)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// src/components/dashboard/MacroGauges.tsx
export function MacroGauges() {
  // Static macro environment display — will be data-driven in a future sprint
  const gauges = [
    { label: 'Fed Policy (Hawkish)', value: 72, color: '#e87070', display: '72%' },
    { label: 'Inflation Pressure',   value: 68, color: '#e09845', display: '3.1% CPI' },
    { label: 'Growth Momentum',      value: 55, color: '#4eca99', display: 'Moderate' },
    { label: 'Geopolitical Risk',    value: 45, color: '#e09845', display: 'Medium' },
    { label: 'USD Strength',         value: 63, color: '#7ab4e8', display: 'DXY 104' },
    { label: 'Credit Spreads',       value: 38, color: '#4eca99', display: 'Contained' },
  ]
  return (
    <div className={styles.panel}>
      <div className={styles.panelTitle}>Macro Environment</div>
      <div className={styles.gaugeGrid}>
        {gauges.map(g => (
          <div key={g.label} className={styles.gaugeItem}>
            <div className={styles.gaugeLabel}>{g.label}</div>
            <div className={styles.gaugeBar}>
              <div className={styles.gaugeFill} style={{ width: `${g.value}%`, background: g.color }} />
            </div>
            <div className={styles.gaugeVal}>{g.display}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// src/components/dashboard/SectorHeatmap.tsx
export function SectorHeatmap({ sectors }: { sectors: Array<{ sector: string; score: number }> }) {
  const displaySectors = sectors.length > 0 ? sectors : [
    { sector: 'technology', score: 0.5 },
    { sector: 'defence',    score: 0.3 },
    { sector: 'energy',     score: -0.2 },
    { sector: 'financials', score: -0.3 },
    { sector: 'healthcare', score: 0.1 },
    { sector: 'utilities',  score: -0.1 },
    { sector: 'materials',  score: 0.2 },
    { sector: 'consumer',   score: -0.1 },
  ]

  function sectorBg(score: number) {
    if (score >  0.3) return 'rgba(42,124,94,0.55)'
    if (score >  0.1) return 'rgba(42,124,94,0.3)'
    if (score < -0.3) return 'rgba(184,48,48,0.55)'
    if (score < -0.1) return 'rgba(184,48,48,0.3)'
    return 'rgba(200,120,32,0.25)'
  }
  function sectorColor(score: number) {
    if (score > 0.1) return '#4eca99'
    if (score < -0.1) return '#e87070'
    return '#e09845'
  }

  return (
    <div className={styles.panel}>
      <div className={styles.panelTitle}>
        Sector Signal Heatmap
        <span className={styles.panelSub}>7-day aggregate</span>
      </div>
      <div className={styles.heatmapRow}>
        {displaySectors.map(s => (
          <div key={s.sector} className={styles.heatCell}>
            <div
              className={styles.heatBox}
              style={{ background: sectorBg(s.score), color: sectorColor(s.score) }}
            >
              {s.score >= 0 ? '+' : ''}{s.score.toFixed(2)}
            </div>
            <div className={styles.heatLabel}>
              {s.sector.charAt(0).toUpperCase() + s.sector.slice(0, 5)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────
function getRelativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}
