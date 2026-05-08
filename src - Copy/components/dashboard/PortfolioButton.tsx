// src/components/dashboard/PortfolioButton.tsx
'use client'
import { useState } from 'react'

export default function PortfolioButton({
  ticker,
  name,
  initialAdded,
}: {
  ticker:       string
  name:         string
  initialAdded: boolean
}) {
  const [added,   setAdded]   = useState(initialAdded)
  const [loading, setLoading] = useState(false)

  async function handleAdd() {
    if (added) return
    setLoading(true)
    try {
      await fetch('/api/portfolio', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ticker, name, quantity: 0 }),
      })
      setAdded(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleAdd}
      disabled={loading || added}
      style={{
        display:    'flex',
        alignItems: 'center',
        gap:        '0.5rem',
        padding:    '0.55rem 1.1rem',
        borderRadius: 7,
        border:     `1px solid ${added ? 'rgba(232,226,217,0.15)' : 'rgba(200,169,110,0.3)'}`,
        background: added ? 'rgba(255,255,255,0.03)' : 'rgba(200,169,110,0.06)',
        color:      added ? 'rgba(232,226,217,0.3)'  : 'var(--gold)',
        fontSize:   '0.82rem',
        fontWeight: 500,
        cursor:     added ? 'default' : loading ? 'wait' : 'pointer',
        opacity:    loading ? 0.6 : 1,
        transition: 'all 0.15s',
      }}
    >
      <span style={{ fontSize: '1rem' }}>{added ? '✓' : '+'}</span>
      {added ? 'In Portfolio' : 'Add to Portfolio'}
    </button>
  )
}
