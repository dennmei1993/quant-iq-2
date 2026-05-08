// src/components/dashboard/RemoveWatchlistButton.tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function RemoveWatchlistButton({ ticker }: { ticker: string }) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleRemove() {
    setLoading(true)
    try {
      await fetch(`/api/watchlist/ticker?ticker=${ticker}`, { method: 'DELETE' })
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleRemove}
      disabled={loading}
      title={`Remove ${ticker} from watchlist`}
      style={{
        width:        28,
        height:       28,
        borderRadius: 6,
        border:       '1px solid rgba(232,226,217,0.08)',
        background:   'transparent',
        color:        'rgba(232,226,217,0.2)',
        fontSize:     '0.9rem',
        cursor:       loading ? 'wait' : 'pointer',
        display:      'flex',
        alignItems:   'center',
        justifyContent: 'center',
        transition:   'all 0.15s',
        opacity:      loading ? 0.4 : 1,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'rgba(232,80,80,0.1)'
        e.currentTarget.style.color      = '#e87070'
        e.currentTarget.style.borderColor = 'rgba(232,80,80,0.2)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background  = 'transparent'
        e.currentTarget.style.color       = 'rgba(232,226,217,0.2)'
        e.currentTarget.style.borderColor = 'rgba(232,226,217,0.08)'
      }}
    >
      ✕
    </button>
  )
}
