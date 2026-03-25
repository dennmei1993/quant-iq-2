cat > /home/claude/quant-iq/src/app/dashboard/events/page.tsx << 'ENDOFFILE'
'use client'
// src/app/dashboard/events/page.tsx
import { useState, useEffect, useCallback } from 'react'
import styles from './events.module.css'
import panelStyles from '@/components/dashboard/ui.module.css'

interface Event {
  id: string
  headline: string
  ai_summary: string | null
  published_at: string
  event_type: string | null
  sectors: string[] | null
  sentiment_score: number | null
  impact_level: string | null
}

const TIME_FILTERS = [
  { label: '8h',   hours: 8   },
  { label: '16h',  hours: 16  },
  { label: '24h',  hours: 24  },
  { label: '2d',   hours: 48  },
  { label: '3d',   hours: 72  },
  { label: '4d',   hours: 96  },
  { label: '5d',   hours: 120 },
]

const IMPACT_FILTERS = [
  { label: 'All',    value: ''       },
  { label: 'High',   value: 'high'   },
  { label: 'Medium', value: 'medium' },
  { label: 'Low',    value: 'low'    },
]

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

export default function EventsPage() {
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [timeFilter, setTimeFilter] = useState(24)
  const [impactFilter, setImpactFilter] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const fetchEvents = useCallback(async () => {
    setLoading(true)
    const since = new Date(Date.now() - timeFilter * 60 * 60 * 1000).toISOString()
    const params = new URLSearchParams({ since, limit: '100' })
    if (impactFilter) params.set('impact', impactFilter)

    const res = await fetch(`/api/events?${params}`)
    const data = await res.json()
    setEvents(data.events ?? [])
    setLoading(false)
  }, [timeFilter, impactFilter])

  useEffect(() => { fetchEvents() }, [fetchEvents])

  const scoreClass = (score: number | null) => {
    if (!score) return panelStyles.scoreNeut
    if (score > 0.2) return panelStyles.scoreBull
    if (score < -0.2) return panelStyles.scoreBear
    return panelStyles.scoreNeut
  }

  const dotColor = (score: number | null) => {
    if (!score) return '#e09845'
    if (score > 0.2) return '#4eca99'
    if (score < -0.2) return '#e87070'
    return '#e09845'
  }

  const impactBadge = (level: string | null) => {
    if (level === 'high')   return { label: 'High',   css: styles.impactHigh }
    if (level === 'medium') return { label: 'Medium', css: styles.impactMed  }
    return { label: 'Low', css: styles.impactLow }
  }

  return (
    <div>
      {/* Filter bar */}
      <div className={styles.filterBar}>
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Time range</span>
          <div className={styles.filterToggle}>
            {TIME_FILTERS.map(f => (
              <button
                key={f.hours}
                className={`${styles.filterBtn} ${timeFilter === f.hours ? styles.filterActive : ''}`}
                onClick={() => setTimeFilter(f.hours)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Impact</span>
          <div className={styles.filterToggle}>
            {IMPACT_FILTERS.map(f => (
              <button
                key={f.value}
                className={`${styles.filterBtn} ${impactFilter === f.value ? styles.filterActive : ''}`}
                onClick={() => setImpactFilter(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.filterMeta}>
          {loading
            ? <span className={styles.filterCount}>Loading…</span>
            : <span className={styles.filterCount}>{events.length} events</span>
          }
          <button className={styles.refreshBtn} onClick={fetchEvents} disabled={loading}>
            {loading ? '↻' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* Events list */}
      <div className={panelStyles.panel}>
        <div className={panelStyles.panelTitle}>
          Event Intelligence Feed
          <span className={panelStyles.panelSub}>
            Last {TIME_FILTERS.find(f => f.hours === timeFilter)?.label}
            {impactFilter ? ` · ${impactFilter} impact` : ''}
          </span>
        </div>

        {loading && (
          <div className={panelStyles.empty}>Loading events…</div>
        )}

        {!loading && events.length === 0 && (
          <div className={panelStyles.empty}>
            No events found for the selected filters. Try a longer time range.
          </div>
        )}

        {events.map(e => {
          const impact = impactBadge(e.impact_level)
          const isExpanded = expanded === e.id
          return (
            <div
              key={e.id}
              className={`${panelStyles.eventItem} ${styles.eventRow} ${isExpanded ? styles.eventExpanded : ''}`}
              onClick={() => setExpanded(isExpanded ? null : e.id)}
            >
              <div className={panelStyles.eventDot} style={{ background: dotColor(e.sentiment_score) }} />
              <div className={styles.eventMain}>
                <div className={styles.eventTop}>
                  <div className={panelStyles.eventHeadline}>{e.headline}</div>
                  <div className={`${panelStyles.eventScore} ${scoreClass(e.sentiment_score)}`}>
                    {e.sentiment_score !== null
                      ? `${e.sentiment_score >= 0 ? '+' : ''}${e.sentiment_score.toFixed(2)}`
                      : '—'}
                  </div>
                </div>
                <div className={styles.eventMeta}>
                  <span className={styles.eventType}>{e.event_type ?? 'event'}</span>
                  {e.sectors?.slice(0, 2).map(s => (
                    <span key={s} className={styles.sectorTag}>{s}</span>
                  ))}
                  <span className={`${styles.impactBadge} ${impact.css}`}>{impact.label}</span>
                  <span className={styles.eventTime} title={formatTime(e.published_at)}>
                    {relTime(e.published_at)}
                  </span>
                </div>
                {isExpanded && e.ai_summary && (
                  <div className={styles.eventSummary}>{e.ai_summary}</div>
                )}
                {isExpanded && !e.ai_summary && (
                  <div className={styles.eventSummary} style={{ color: 'rgba(200,185,165,0.3)', fontStyle: 'italic' }}>
                    No AI summary available for this event.
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
ENDOFFILE
echo "done"