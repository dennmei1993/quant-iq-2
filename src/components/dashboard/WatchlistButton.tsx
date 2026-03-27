'use client'
import { useState } from 'react'

export default function WatchlistButton({
  ticker,
  initialWatched,
}: {
  ticker:         string
  initialWatched: boolean
}) {
  const [watched,  setWatched]  = useState(initialWatched)
  const [loading,  setLoading]  = useState(false)

  async function toggle() {
    setLoading(true)
    try {
      const method = watched ? 'DELETE' : 'POST'
      const url    = watched
        ? `/api/watchlist/ticker?ticker=${ticker}`
        : '/api/watchlist/ticker'

      await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body:    watched ? undefined : JSON.stringify({ ticker }),
      })

      setWatched(w => !w)
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      style={{
        display:      'flex',
        alignItems:   'center',
        gap:          '0.5rem',
        padding:      '0.55rem 1.1rem',
        borderRadius: 7,
        border:       `1px solid ${watched ? 'rgba(78,202,153,0.4)' : 'rgba(200,169,110,0.3)'}`,
        background:   watched ? 'rgba(78,202,153,0.08)' : 'rgba(200,169,110,0.06)',
        color:        watched ? 'var(--signal-bull)' : 'var(--gold)',
        fontSize:     '0.82rem',
        fontWeight:   500,
        cursor:       loading ? 'wait' : 'pointer',
        opacity:      loading ? 0.6 : 1,
        transition:   'all 0.15s',
      }}
    >
      <span style={{ fontSize: '1rem' }}>{watched ? '★' : '☆'}</span>
      {watched ? 'Watching' : 'Add to Watchlist'}
    </button>
  )
}
