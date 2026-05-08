// src/components/dashboard/SyncPriceButton.tsx
'use client'
import { useState } from 'react'

export default function SyncPriceButton({ ticker }: { ticker: string }) {
  const [loading, setLoading] = useState(false)
  const [done,    setDone]    = useState(false)
  const [error,   setError]   = useState('')

  async function handleSync() {
    setLoading(true); setDone(false); setError('')
    try {
      const res  = await fetch(`/api/admin/sync-prices?tickers=${ticker}`, { method: 'POST' })
      const data = await res.json()
      if (data.ok) setDone(true)
      else setError(data.error ?? 'Failed')
    } catch (e) {
      setError(String(e))
    }
    setLoading(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.2rem' }}>
      <button
        onClick={handleSync}
        disabled={loading}
        title="Sync latest price from Polygon"
        style={{
          display:    'flex', alignItems: 'center', gap: '0.4rem',
          padding:    '0.55rem 1.1rem', borderRadius: 7,
          border:     `1px solid ${done ? 'rgba(78,202,153,0.3)' : 'rgba(232,226,217,0.1)'}`,
          background: done ? 'rgba(78,202,153,0.06)' : 'rgba(255,255,255,0.03)',
          color:      done ? '#4eca99' : 'rgba(232,226,217,0.4)',
          fontSize:   '0.82rem', fontWeight: 500,
          cursor:     loading ? 'wait' : 'pointer',
          opacity:    loading ? 0.6 : 1,
          transition: 'all 0.15s',
        }}
      >
        <span>{loading ? '⟳' : done ? '✓' : '↻'}</span>
        {loading ? 'Syncing…' : done ? 'Synced' : 'Sync Price'}
      </button>
      {error && <div style={{ fontSize: '0.65rem', color: '#e87070' }}>{error}</div>}
    </div>
  )
}