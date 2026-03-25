'use client'
// src/app/dashboard/events/page.tsx
import { useState, useEffect, useCallback } from 'react'
import styles from './events.module.css'
import panelStyles from '@/components/dashboard/ui.module.css'

interface Event {
  id:              string
  headline:        string
  ai_summary:      string | null
  published_at:    string
  event_type:      string | null
  sectors:         string[] | null
  sentiment_score: number | null
  impact_score:    number | null
}

const TIME_FILTERS = [
  { label: '8h',  hours: 8   },
  { label: '16h', hours: 16  },
  { label: '24h', hours: 24  },
  { label: '2d',  hours: 48  },
  { label: '3d',  hours: 72  },
  { label: '4d',  hours: 96  },
  { label: '5d',  hours: 120 },
]

// Numeric impact_score thresholds: 0-10 scale
const IMPACT_FILTERS = [
  { label: 'All',    min: null },
  { label: 'High',   min: 7    },  // 7-10
  { label: 'Medium', min: 4    },  // 4-10
  { label: 'Low',    min: 0    },  // 0-10 (same as all but explicit)
]

const TYPE_FILTERS = [
  { label: 'All Types',       value: ''                 },
  { label: 'Monetary Policy', value: 'monetary_policy'  },
  { label: 'Geopolitical',    value: 'geopolitical'     },
  { label: 'Corporate',       value: 'corporate'        },
  { label: 'Economic Data',   value: 'economic_data'    },
  { label: 'Regulatory',      value: 'regulatory'       },
]

const TYPE_LABELS: Record<string, string> = {
  monetary_policy: 'Monetary Policy',
  geopolitical:    'Geopolitical',
  corporate:       'Corporate',
  economic_data:   'Economic Data',
  regulatory:      'Regulatory',
}

// Derive impact label from numeric score
function impactFromScore(score: number | null): { label: string; css: string } {
  if (score === null)  return { label: '—',      css: styles.impactNone }
  if (score >= 7)      return { label: 'High',   css: styles.impactHigh }
  if (score >= 4)      return { label: 'Medium', css: styles.impactMed  }
  return                      { label: 'Low',    css: styles.impactLow  }
}

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
  const [events, setEvents]       = useState<Event[]>([])
  const [loading, setLoading]     = useState(true)
  const [timeFilter, setTimeFilter]   = useState(24)
  const [impactMin, setImpactMin]     = useState<number | null>(null)
  const [typeFilter, setTypeFilter]   = useState('')
  const [expanded, setExpanded]   = useState<string | null>(null)

  const fetchEvents = useCallback(async () => {
    setLoading(true)
    setExpanded(null)
    const since = new Date(Date.now() - timeFilter * 60 * 60 * 1000).toISOString()
    const params = new URLSearchParams({ since, limit: '500' })
    if (impactMin !== null) params.set('impact', String(impactMin))
    if (typeFilter)         params.set('event_type', typeFilter)

    const res = await fetch(`/api/events?${params}`)
    const data = await res.json()
    setEvents(data.events ?? [])
    setLoading(false)
  }, [timeFilter, impactMin, typeFilter])

  useEffect(() => { fetchEvents() }, [fetchEvents])

  const dotColor = (score: number | null) => {
    if (score === null) return '#555'
    if (score >= 7) return '#e87070'
    if (score >= 4) return '#e09845'
    return 'rgba(200,185,165,0.3)'
  }

  const sentimentClass = (score: number | null) => {
    if (score === null) return panelStyles.scoreNeut
    if (score > 0.2)  return panelStyles.scoreBull
    if (score < -0.2) return panelStyles.scoreBear
    return panelStyles.scoreNeut
  }

  const typeCls: Record<string, string> = {
    monetary_policy: styles.typeMonetary,
    geopolitical:    styles.typeGeo,
    corporate:       styles.typeCorp,
    economic_data:   styles.typeEcon,
    regulatory:      styles.typeReg,
  }

  const timeLabel = TIME_FILTERS.find(f => f.hours === timeFilter)?.label ?? '24h'
  const impactLabel = IMPACT_FILTERS.find(f => f.min === impactMin)?.label ?? 'All'

  return (
    <div>
      {/* ── FILTER BAR ── */}
      <div className={styles.filterBar}>

        <div className={styles.filterRow}>
          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>Time range</span>
            <div className={styles.filterToggle}>
              {TIME_FILTERS.map(f => (
                <button key={f.hours}
                  className={`${styles.filterBtn} ${timeFilter === f.hours ? styles.filterActive : ''}`}
                  onClick={() => setTimeFilter(f.hours)}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.filterMeta}>
            {loading
              ? <span className={styles.filterCount}>Loading…</span>
              : <span className={styles.filterCount}>{events.length} event{events.length !== 1 ? 's' : ''}</span>
            }
            <button className={styles.refreshBtn} onClick={fetchEvents} disabled={loading}>
              ↻ Refresh
            </button>
          </div>
        </div>

        <div className={styles.filterRow}>
          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>Impact</span>
            <div className={styles.filterToggle}>
              {IMPACT_FILTERS.map(f => (
                <button key={String(f.min)}
                  className={`${styles.filterBtn} ${impactMin === f.min ? styles.filterActive : ''}`}
                  onClick={() => setImpactMin(f.min)}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>Type</span>
            <div className={styles.filterToggle}>
              {TYPE_FILTERS.map(f => (
                <button key={f.value}
                  className={`${styles.filterBtn} ${typeFilter === f.value ? styles.filterActive : ''}`}
                  onClick={() => setTypeFilter(f.value)}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>

      </div>

      {/* ── EVENT LIST ── */}
      <div className={panelStyles.panel}>
        <div className={panelStyles.panelTitle}>
          Event Intelligence Feed
          <span className={panelStyles.panelSub}>
            Last {timeLabel}
            {impactMin !== null && impactMin > 0 ? ` · ${impactLabel} impact` : ''}
            {typeFilter ? ` · ${TYPE_LABELS[typeFilter] ?? typeFilter}` : ''}
          </span>
        </div>

        {loading && <div className={panelStyles.empty}>Loading events…</div>}

        {!loading && events.length === 0 && (
          <div className={panelStyles.empty}>
            No events found — try a longer time range or broader filter.
          </div>
        )}

        {events.map(e => {
          const impact     = impactFromScore(e.impact_score)
          const isExpanded = expanded === e.id
          const tCls       = typeCls[e.event_type ?? ''] ?? styles.typeDefault

          return (
            <div key={e.id}
              className={`${panelStyles.eventItem} ${styles.eventRow} ${isExpanded ? styles.eventExpanded : ''}`}
              onClick={() => setExpanded(isExpanded ? null : e.id)}>

              <div className={panelStyles.eventDot} style={{ background: dotColor(e.impact_score) }} />

              <div className={styles.eventMain}>
                <div className={styles.eventTop}>
                  <div className={panelStyles.eventHeadline}>{e.headline}</div>
                  <div className={`${panelStyles.eventScore} ${sentimentClass(e.sentiment_score)}`}>
                    {e.sentiment_score !== null
                      ? `${e.sentiment_score >= 0 ? '+' : ''}${e.sentiment_score.toFixed(2)}`
                      : '—'}
                  </div>
                </div>

                <div className={styles.eventMeta}>
                  {e.event_type && (
                    <span className={`${styles.typePill} ${tCls}`}>
                      {TYPE_LABELS[e.event_type] ?? e.event_type}
                    </span>
                  )}
                  {e.sectors?.slice(0, 2).map(s => (
                    <span key={s} className={styles.sectorTag}>{s}</span>
                  ))}
                  <span className={`${styles.impactBadge} ${impact.css}`}>
                    {impact.label}
                    {e.impact_score !== null && (
                      <span className={styles.impactScore}> {e.impact_score.toFixed(1)}</span>
                    )}
                  </span>
                  <span className={styles.eventTime} title={formatTime(e.published_at)}>
                    {relTime(e.published_at)}
                  </span>
                  <span className={styles.expandHint}>{isExpanded ? '▲' : '▼'}</span>
                </div>

                {isExpanded && (
                  <div className={styles.eventDetails}>
                    {e.ai_summary
                      ? <p className={styles.eventSummary}>{e.ai_summary}</p>
                      : <p className={styles.eventSummaryEmpty}>No AI summary available.</p>
                    }
                    {e.sectors && e.sectors.length > 0 && (
                      <div className={styles.detailRow}>
                        <span className={styles.detailLabel}>Sectors</span>
                        <div className={styles.sectorList}>
                          {e.sectors.map(s => <span key={s} className={styles.sectorTag}>{s}</span>)}
                        </div>
                      </div>
                    )}
                    <div className={styles.detailRow}>
                      <span className={styles.detailLabel}>Impact score</span>
                      <span className={styles.detailVal}>
                        {e.impact_score !== null ? `${e.impact_score.toFixed(1)} / 10` : '—'}
                      </span>
                    </div>
                    <div className={styles.detailRow}>
                      <span className={styles.detailLabel}>Published</span>
                      <span className={styles.detailVal}>{formatTime(e.published_at)}</span>
                    </div>
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