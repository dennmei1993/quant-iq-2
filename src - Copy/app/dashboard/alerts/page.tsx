'use client'
// src/app/dashboard/alerts/page.tsx
import { useEffect, useState } from 'react'
import styles from './alerts.module.css'
import panelStyles from '@/components/dashboard/ui.module.css'

interface Alert {
  id: string
  alert_type: string
  title: string
  body: string | null
  is_read: boolean
  created_at: string
}

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

const TYPE_ICON: Record<string, string> = {
  portfolio_risk: '⚠',
  new_theme:      '🎯',
  macro_shift:    '📡',
  theme_update:   '✅',
}
const TYPE_COLOR: Record<string, string> = {
  portfolio_risk: 'bear',
  new_theme:      'bull',
  macro_shift:    'neutral',
  theme_update:   'bull',
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/alerts')
      .then(r => r.json())
      .then(d => { setAlerts(d.alerts ?? []); setLoading(false) })
  }, [])

  async function markAllRead() {
    const unread = alerts.filter(a => !a.is_read).map(a => a.id)
    if (!unread.length) return
    await fetch('/api/alerts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: unread }),
    })
    setAlerts(prev => prev.map(a => ({ ...a, is_read: true })))
  }

  const unreadCount = alerts.filter(a => !a.is_read).length

  return (
    <div>
      <div className={panelStyles.panel}>
        <div className={panelStyles.panelTitle}>
          Alerts
          {unreadCount > 0 && (
            <span className={styles.unreadBadge}>{unreadCount} unread</span>
          )}
          {unreadCount > 0 && (
            <button className={styles.markReadBtn} onClick={markAllRead}>
              Mark all read
            </button>
          )}
        </div>

        {loading && <div className={panelStyles.empty}>Loading alerts…</div>}
        {!loading && alerts.length === 0 && (
          <div className={panelStyles.empty}>No alerts yet — they'll appear here when signals affect your portfolio or a new theme is detected.</div>
        )}

        {alerts.map(a => {
          const color = TYPE_COLOR[a.alert_type] ?? 'neutral'
          return (
            <div key={a.id} className={`${styles.alertItem} ${!a.is_read ? styles.unread : ''} ${styles[color]}`}>
              <div className={styles.alertIcon}>{TYPE_ICON[a.alert_type] ?? '🔔'}</div>
              <div className={styles.alertBody}>
                <div className={styles.alertTitle}>{a.title}</div>
                {a.body && <div className={styles.alertText}>{a.body}</div>}
                <div className={styles.alertMeta}>
                  <span>{a.alert_type.replace('_', ' ')}</span>
                  <span>{relTime(a.created_at)}</span>
                </div>
              </div>
              {!a.is_read && <div className={styles.unreadDot} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}
