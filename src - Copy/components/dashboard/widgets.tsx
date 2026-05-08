// src/components/dashboard/widgets.tsx
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
          const dotColor = score > 0.2 ? 'var(--signal-bull)' : score < -0.2 ? 'var(--signal-bear)' : 'var(--signal-neut)'
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

export function MacroGauges() {
  const gauges = [
    { label: 'Fed Policy (Hawkish)', value: 72, color: 'var(--signal-bear)', display: '72%'      },
    { label: 'Inflation Pressure',   value: 68, color: 'var(--signal-neut)', display: '3.1% CPI' },
    { label: 'Growth Momentum',      value: 55, color: 'var(--signal-bull)', display: 'Moderate'  },
    { label: 'Geopolitical Risk',    value: 45, color: 'var(--signal-neut)', display: 'Medium'    },
    { label: 'USD Strength',         value: 63, color: 'var(--color-info)',  display: 'DXY 104'   },
    { label: 'Credit Spreads',       value: 38, color: 'var(--signal-bull)', display: 'Contained' },
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

export function SectorHeatmap({ sectors }: { sectors: Array<{ sector: string; score: number }> }) {
  const displaySectors = sectors.length > 0 ? sectors : [
    { sector: 'technology', score: 0.5  },
    { sector: 'defence',    score: 0.3  },
    { sector: 'energy',     score: -0.2 },
    { sector: 'financials', score: -0.3 },
    { sector: 'healthcare', score: 0.1  },
    { sector: 'utilities',  score: -0.1 },
    { sector: 'materials',  score: 0.2  },
    { sector: 'consumer',   score: -0.1 },
  ]

  function sectorBg(score: number) {
    if (score >  0.3) return 'rgba(var(--green-rgb), 0.15)'
    if (score >  0.1) return 'rgba(var(--green-rgb), 0.08)'
    if (score < -0.3) return 'rgba(var(--red-rgb),   0.15)'
    if (score < -0.1) return 'rgba(var(--red-rgb),   0.08)'
    return 'rgba(var(--amber-rgb), 0.08)'
  }
  function sectorColor(score: number) {
    if (score >  0.1) return 'var(--signal-bull)'
    if (score < -0.1) return 'var(--signal-bear)'
    return 'var(--signal-neut)'
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

function getRelativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}
