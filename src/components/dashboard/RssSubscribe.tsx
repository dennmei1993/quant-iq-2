/**
 * components/dashboard/RssSubscribe.tsx
 *
 * Embeddable component — drop into any dashboard page to expose RSS feed links.
 * Shows a clean list of available feeds with one-click copy and direct subscribe buttons.
 *
 * Usage:
 *   import RssSubscribe from '@/components/dashboard/RssSubscribe'
 *   <RssSubscribe />
 *
 * Or in the alerts page / settings page sidebar.
 */

'use client'

import { useEffect, useState } from 'react'
import styles from './RssSubscribe.module.css'

interface Feed {
  id:          string
  title:       string
  description: string
  url:         string
}

export default function RssSubscribe() {
  const [feeds,   setFeeds]   = useState<Feed[]>([])
  const [copied,  setCopied]  = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/rss/feeds')
      .then(r => r.json())
      .then(d => setFeeds(d.feeds ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function copy(url: string, id: string) {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(id)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  if (loading) return null

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.icon}>
          {/* RSS icon SVG */}
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="3" cy="11" r="1.5" fill="currentColor"/>
            <path d="M1.5 7.5C4.5 7.5 6.5 9.5 6.5 12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none"/>
            <path d="M1.5 3.5C7 3.5 10.5 7 10.5 12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none"/>
          </svg>
        </span>
        <h3 className={styles.title}>Subscribe via RSS</h3>
      </div>
      <p className={styles.sub}>
        Add any feed to your RSS reader — Feedly, Reeder, NetNewsWire, or any other client.
      </p>

      <div className={styles.feedList}>
        {feeds.map(feed => (
          <div key={feed.id} className={styles.feedRow}>
            <div className={styles.feedInfo}>
              <span className={styles.feedTitle}>{feed.title}</span>
              <span className={styles.feedDesc}>{feed.description}</span>
            </div>
            <div className={styles.feedActions}>
              <button
                className={styles.copyBtn}
                onClick={() => copy(feed.url, feed.id)}
                title="Copy feed URL"
              >
                {copied === feed.id ? '✓ Copied' : 'Copy URL'}
              </button>
              <a
                href={`feed:${feed.url}`}
                className={styles.subscribeBtn}
                title="Open in RSS reader"
              >
                Subscribe
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
