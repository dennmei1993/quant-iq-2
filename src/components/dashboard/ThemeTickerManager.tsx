'use client'
// src/components/dashboard/ThemeTickerManager.tsx
// Inline ticker search and management within a theme card.
// Allows adding tickers with optional weight/rationale, and removing existing ones.

import { useState, useRef, useEffect, useCallback } from 'react'

type TickerWeight = {
  ticker:       string
  final_weight: number
  relevance:    number
  rationale:    string | null
}

type SearchResult = {
  ticker: string
  name:   string
}

function weightColor(w: number) {
  if (w >= 0.7) return 'var(--signal-bull)'
  if (w >= 0.4) return 'var(--signal-neut)'
  return 'rgba(232,226,217,0.35)'
}

function weightLabel(w: number) {
  if (w >= 0.8) return 'Primary'
  if (w >= 0.6) return 'Strong'
  if (w >= 0.4) return 'Moderate'
  return 'Peripheral'
}

export default function ThemeTickerManager({
  themeId,
  initialTickers,
}: {
  themeId:        string
  initialTickers: TickerWeight[]
}) {
  const [tickers,    setTickers]    = useState<TickerWeight[]>(initialTickers)
  const [showSearch, setShowSearch] = useState(false)
  const [query,      setQuery]      = useState('')
  const [results,    setResults]    = useState<SearchResult[]>([])
  const [searching,  setSearching]  = useState(false)
  const [adding,     setAdding]     = useState<string | null>(null)
  const [removing,   setRemoving]   = useState<string | null>(null)
  const [assetType,  setAssetType]  = useState<'all' | 'stock' | 'etf'>('all')
  const [weight,     setWeight]     = useState(0.5)
  const [rationale,  setRationale]  = useState('')
  const [error,      setError]      = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-focus search input when opened
  useEffect(() => {
    if (showSearch) setTimeout(() => inputRef.current?.focus(), 50)
  }, [showSearch])

  // Debounced search
  const search = useCallback(async (q: string) => {
    if (q.length < 1) { setResults([]); return }
    setSearching(true)
    try {
      const type = assetType !== 'all' ? `&asset_type=${assetType}` : ''
      const res  = await fetch(`/api/assets/search?q=${encodeURIComponent(q)}&limit=6${type}`)
      const data = await res.json()
      setResults(data.results ?? [])
    } catch { setResults([]) }
    finally { setSearching(false) }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => search(query), 200)
    return () => clearTimeout(t)
  }, [query, assetType, search])

  async function handleAdd(ticker: string, name: string) {
    setAdding(ticker)
    setError('')
    try {
      const res  = await fetch('/api/themes/tickers', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ theme_id: themeId, ticker, final_weight: weight, rationale }),
      })
      const data = await res.json()
      if (!data.ok) { setError(data.error ?? 'Failed to add'); return }

      // Update local state
      const existing = tickers.findIndex(t => t.ticker === ticker)
      if (existing >= 0) {
        setTickers(prev => prev.map(t => t.ticker === ticker
          ? { ...t, final_weight: weight, rationale: rationale || null }
          : t
        ))
      } else {
        setTickers(prev => [...prev, {
          ticker,
          final_weight: weight,
          relevance:    Math.round(weight * 100),
          rationale:    rationale || null,
        }].sort((a, b) => b.final_weight - a.final_weight))
      }

      // Reset search
      setQuery('')
      setResults([])
      setRationale('')
      setWeight(0.5)
      setShowSearch(false)
    } catch (e) {
      setError(String(e))
    } finally {
      setAdding(null)
    }
  }

  async function handleRemove(ticker: string) {
    setRemoving(ticker)
    setError('')
    try {
      const res  = await fetch('/api/themes/tickers', {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ theme_id: themeId, ticker }),
      })
      const data = await res.json()
      if (!data.ok) { setError(data.error ?? 'Failed to remove'); return }
      setTickers(prev => prev.filter(t => t.ticker !== ticker))
    } catch (e) {
      setError(String(e))
    } finally {
      setRemoving(null)
    }
  }

  return (
    <div>
      {/* ── Ticker list ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
        <div style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.22)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          Associated Assets · {tickers.length} tickers
        </div>
        <button
          onClick={() => { setShowSearch(!showSearch); setError('') }}
          style={{
            fontSize: '0.65rem', color: showSearch ? 'rgba(232,112,112,0.6)' : 'rgba(200,169,110,0.6)',
            background: 'none', border: 'none', cursor: 'pointer', padding: '0.1rem 0.3rem',
          }}
        >
          {showSearch ? '✕ Cancel' : '+ Add Ticker'}
        </button>
      </div>

      {tickers.length === 0 && !showSearch && (
        <p style={{ fontSize: '0.75rem', color: 'rgba(232,226,217,0.18)', fontStyle: 'italic', margin: 0 }}>
          No tickers mapped yet — click Add Ticker to get started.
        </p>
      )}

      {tickers.map(tw => (
        <div key={tw.ticker} style={{
          display: 'grid', gridTemplateColumns: '72px 1fr 110px 76px 28px',
          alignItems: 'center', gap: '0.7rem',
          padding: '0.5rem 0.7rem', marginBottom: '0.4rem',
          background: 'rgba(255,255,255,0.02)', borderRadius: 5,
          border: '1px solid rgba(255,255,255,0.035)',
        }}>
          <a
            href={`/dashboard/tickers/${tw.ticker}`}
            style={{ fontSize: '0.83rem', fontWeight: 700, color: 'var(--gold)', fontFamily: 'monospace', textDecoration: 'none' }}
          >
            {tw.ticker}
          </a>

          <span style={{ fontSize: '0.71rem', color: 'rgba(232,226,217,0.4)', lineHeight: 1.4 }}>
            {tw.rationale ?? '—'}
          </span>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
              <div style={{ width: `${tw.final_weight * 100}%`, height: '100%', background: weightColor(tw.final_weight), borderRadius: 2 }} />
            </div>
            <span style={{ fontSize: '0.63rem', color: weightColor(tw.final_weight), minWidth: '2.2rem', textAlign: 'right', fontWeight: 600 }}>
              {(tw.final_weight * 100).toFixed(0)}%
            </span>
          </div>

          <span style={{
            fontSize: '0.58rem', fontWeight: 500, textAlign: 'center',
            background: `${weightColor(tw.final_weight)}18`, color: weightColor(tw.final_weight),
            padding: '0.12rem 0.35rem', borderRadius: 3,
          }}>
            {weightLabel(tw.final_weight)}
          </span>

          <button
            onClick={() => handleRemove(tw.ticker)}
            disabled={removing === tw.ticker}
            title="Remove from theme"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: removing === tw.ticker ? 'rgba(232,112,112,0.3)' : 'rgba(232,112,112,0.4)',
              fontSize: '0.8rem', padding: 0, lineHeight: 1,
            }}
          >
            {removing === tw.ticker ? '…' : '✕'}
          </button>
        </div>
      ))}

      {/* ── Inline search panel ── */}
      {showSearch && (
        <div style={{
          marginTop: '0.75rem',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(200,169,110,0.2)',
          borderRadius: 8, padding: '0.9rem 1rem',
        }}>
          {/* Asset type filter */}
          <div style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.5rem' }}>
            {(['all', 'stock', 'etf'] as const).map(type => (
              <button
                key={type}
                onClick={() => setAssetType(type)}
                style={{
                  fontSize: '0.62rem', fontWeight: 600, textTransform: 'uppercase',
                  padding: '0.25rem 0.6rem', borderRadius: 4, cursor: 'pointer',
                  border: `1px solid ${assetType === type ? 'rgba(200,169,110,0.5)' : 'rgba(232,226,217,0.1)'}`,
                  background: assetType === type ? 'rgba(200,169,110,0.12)' : 'transparent',
                  color: assetType === type ? 'var(--gold)' : 'rgba(232,226,217,0.35)',
                }}
              >
                {type === 'all' ? 'All' : type === 'stock' ? 'Stocks' : 'ETFs'}
              </button>
            ))}
          </div>

          {/* Search input */}
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search ticker or company name…"
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(232,226,217,0.1)',
              borderRadius: 5, padding: '0.5rem 0.75rem',
              color: 'var(--cream)', fontSize: '0.82rem',
              outline: 'none',
            }}
          />

          {/* Search results */}
          {results.length > 0 && (
            <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              {results.map(r => {
                const alreadyAdded = tickers.some(t => t.ticker === r.ticker)
                return (
                  <div
                    key={r.ticker}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '0.45rem 0.6rem', borderRadius: 5,
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.04)',
                    }}
                  >
                    <div>
                      <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--gold)', fontFamily: 'monospace' }}>
                        {r.ticker}
                      </span>
                      <span style={{ fontSize: '0.72rem', color: 'rgba(232,226,217,0.4)', marginLeft: '0.5rem' }}>
                        {r.name}
                      </span>
                    </div>
                    <button
                      onClick={() => handleAdd(r.ticker, r.name)}
                      disabled={adding === r.ticker}
                      style={{
                        fontSize: '0.65rem', fontWeight: 600,
                        color: alreadyAdded ? 'rgba(200,169,110,0.5)' : 'rgba(78,202,153,0.8)',
                        background: alreadyAdded ? 'rgba(200,169,110,0.08)' : 'rgba(78,202,153,0.08)',
                        border: `1px solid ${alreadyAdded ? 'rgba(200,169,110,0.2)' : 'rgba(78,202,153,0.2)'}`,
                        borderRadius: 4, padding: '0.2rem 0.55rem',
                        cursor: adding === r.ticker ? 'wait' : 'pointer',
                      }}
                    >
                      {adding === r.ticker ? '…' : alreadyAdded ? 'Update' : '+ Add'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {query.length > 0 && results.length === 0 && !searching && (
            <div style={{ fontSize: '0.72rem', color: 'rgba(232,226,217,0.2)', marginTop: '0.5rem' }}>
              No tickers found for "{query}"
            </div>
          )}

          {/* Weight + rationale controls */}
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '0.75rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.3)' }}>Weight</span>
              <input
                type="range" min="0.1" max="1.0" step="0.05"
                value={weight}
                onChange={e => setWeight(parseFloat(e.target.value))}
                style={{ width: 80, accentColor: weightColor(weight) }}
              />
              <span style={{ fontSize: '0.68rem', fontWeight: 600, color: weightColor(weight), fontFamily: 'monospace', minWidth: 28 }}>
                {(weight * 100).toFixed(0)}%
              </span>
              <span style={{ fontSize: '0.6rem', color: 'rgba(232,226,217,0.25)' }}>
                ({weightLabel(weight)})
              </span>
            </div>
            <input
              value={rationale}
              onChange={e => setRationale(e.target.value)}
              placeholder="Rationale (optional)"
              style={{
                flex: 1, minWidth: 160,
                background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(232,226,217,0.08)',
                borderRadius: 4, padding: '0.3rem 0.6rem',
                color: 'var(--cream)', fontSize: '0.72rem', outline: 'none',
              }}
            />
          </div>

          {error && (
            <div style={{ fontSize: '0.7rem', color: '#e87070', marginTop: '0.5rem' }}>{error}</div>
          )}
        </div>
      )}
    </div>
  )
}
