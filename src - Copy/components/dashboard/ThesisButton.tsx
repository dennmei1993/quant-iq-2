'use client'
import { useState } from 'react'

export default function ThesisButton({ ticker }: { ticker: string }) {
  const [thesis,  setThesis]  = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(false)

  async function generate() {
    setLoading(true)
    setError(false)
    try {
      const res  = await fetch(`/api/tickers/${ticker}/thesis`, { method: 'POST' })
      const data = await res.json()
      if (data.thesis) setThesis(data.thesis)
      else setError(true)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  if (thesis) return (
    <div style={{
      background:   'rgba(78,202,153,0.06)',
      border:       '1px solid rgba(78,202,153,0.15)',
      borderRadius: 8,
      padding:      '1rem 1.2rem',
    }}>
      <div style={{ fontSize: '0.65rem', color: 'rgba(78,202,153,0.6)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.5rem' }}>
        AI Investment Thesis
      </div>
      <p style={{ fontSize: '0.85rem', color: 'rgba(232,226,217,0.7)', lineHeight: 1.65, margin: 0 }}>
        {thesis}
      </p>
      <button
        onClick={() => setThesis(null)}
        style={{ marginTop: '0.6rem', fontSize: '0.7rem', color: 'rgba(232,226,217,0.25)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        Regenerate ↺
      </button>
    </div>
  )

  return (
    <button
      onClick={generate}
      disabled={loading}
      style={{
        display:      'flex',
        alignItems:   'center',
        gap:          '0.5rem',
        padding:      '0.55rem 1.1rem',
        borderRadius: 7,
        border:       '1px solid rgba(122,180,232,0.3)',
        background:   'rgba(122,180,232,0.06)',
        color:        '#7ab4e8',
        fontSize:     '0.82rem',
        fontWeight:   500,
        cursor:       loading ? 'wait' : 'pointer',
        opacity:      loading ? 0.6 : 1,
      }}
    >
      {loading ? '⟳ Generating…' : error ? '⚠ Retry' : '✦ Generate AI Thesis'}
    </button>
  )
}
