'use client'
// src/components/dashboard/ThemeTickerManager.tsx
// Manages tickers within a theme card.
// - Lists existing theme tickers with weight/rationale
// - Search panel filters existing tickers only
// - Add new tickers via global asset search (separate panel)
// - Remove tickers from theme
// - Quick actions: Open ticker page, Add to Watchlist

import { useState, useRef, useEffect, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type TickerWeight = {
  ticker:       string
  final_weight: number
  relevance:    number
  rationale:    string | null
}

type AssetResult = {
  ticker:     string
  name:       string
  asset_type: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Component ────────────────────────────────────────────────────────────────

export default function ThemeTickerManager({
  themeId,
  initialTickers,
}: {
  themeId:        string
  initialTickers: TickerWeight[]
}) {
  const [tickers,     setTickers]     = useState<TickerWeight[]>(initialTickers)
  const [filterQuery, setFilterQuery] = useState('')       // filters existing tickers
  const [showAdd,     setShowAdd]     = useState(false)    // show global asset search
  const [addQuery,    setAddQuery]    = useState('')       // global search query
  const [addResults,  setAddResults]  = useState<AssetResult[]>([])
  const [assetType,   setAssetType]   = useState<'all' | 'stock' | 'etf' | 'crypto'>('all')
  const [weight,      setWeight]      = useState(0.5)
  const [addRationale,setAddRationale]= useState('')
  const [adding,      setAdding]      = useState<string | null>(null)
  const [removing,    setRemoving]    = useState<string | null>(null)
  const [watchlisted, setWatchlisted] = useState<Set<string>>(new Set())
  const [error,       setError]       = useState('')
  const [showAll,     setShowAll]     = useState(false)
  const addInputRef = useRef<HTMLInputElement>(null)

  // Focus add-ticker input when panel opens
  useEffect(() => {
    if (showAdd) setTimeout(() => addInputRef.current?.focus(), 50)
  }, [showAdd])

  // ── Filter existing tickers ──────────────────────────────────────────────
  const displayedTickers = showAll ? tickers : tickers.slice(0, 6)
  const filteredTickers = filterQuery.length > 0
    ? displayedTickers.filter(t =>
        t.ticker.toUpperCase().includes(filterQuery.toUpperCase()) ||
        (t.rationale ?? '').toLowerCase().includes(filterQuery.toLowerCase())
      )
    : displayedTickers

  // ── Global asset search (debounced) ─────────────────────────────────────
  const searchAssets = useCallback(async (q: string) => {
    if (q.length < 1) { setAddResults([]); return }
    try {
      const typeParam = assetType !== 'all' ? `&asset_type=${assetType}` : ''
      const res  = await fetch(`/api/assets/search?q=${encodeURIComponent(q)}&limit=8${typeParam}`)
      const data = await res.json()
      setAddResults(data.assets ?? [])
    } catch { setAddResults([]) }
  }, [assetType])

  useEffect(() => {
    const t = setTimeout(() => searchAssets(addQuery), 200)
    return () => clearTimeout(t)
  }, [addQuery, assetType, searchAssets])

  // ── Add ticker to theme ───────────────────────────────────────────────────
  async function handleAdd(ticker: string) {
    setAdding(ticker)
    setError('')
    try {
      const res  = await fetch('/api/themes/tickers', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ theme_id: themeId, ticker, final_weight: weight, rationale: addRationale }),
      })
      const data = await res.json()
      if (!data.ok) { setError(data.error ?? 'Failed to add'); return }

      const existing = tickers.findIndex(t => t.ticker === ticker)
      if (existing >= 0) {
        setTickers(prev => prev.map(t => t.ticker === ticker
          ? { ...t, final_weight: weight, rationale: addRationale || null }
          : t
        ))
      } else {
        setTickers(prev => [...prev, {
          ticker,
          final_weight: weight,
          relevance:    Math.round(weight * 100),
          rationale:    addRationale || null,
        }].sort((a, b) => b.final_weight - a.final_weight))
      }

      setAddQuery('')
      setAddResults([])
      setAddRationale('')
      setWeight(0.5)
      setShowAdd(false)
    } catch (e) {
      setError(String(e))
    } finally {
      setAdding(null)
    }
  }

  // ── Remove ticker from theme ──────────────────────────────────────────────
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

  // ── Add to watchlist ──────────────────────────────────────────────────────
  async function handleWatchlist(ticker: string) {
    try {
      const res = await fetch('/api/watchlist/ticker', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ticker }),
      })
      if (res.ok) setWatchlisted(prev => new Set([...prev, ticker]))
    } catch { /* silent */ }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div>

      {/* ── Header: label + filter + add button ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem', gap: '0.5rem' }}>
        <div style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.22)', textTransform: 'uppercase', letterSpacing: '0.1em', flexShrink: 0 }}>
          Associated Assets · {tickers.length}
        </div>

        {/* Add new ticker button */}
        <button
          onClick={() => { setShowAdd(!showAdd); setError('') }}
          style={{
            fontSize: '0.65rem', flexShrink: 0,
            color: showAdd ? 'rgba(232,112,112,0.6)' : 'rgba(200,169,110,0.6)',
            background: 'none', border: 'none', cursor: 'pointer', padding: '0.1rem 0.3rem',
          }}
        >
          {showAdd ? '✕ Cancel' : '+ Add'}
        </button>
      </div>

      {/* ── Empty state ── */}
      {tickers.length === 0 && !showAdd && (
        <p style={{ fontSize: '0.75rem', color: 'rgba(232,226,217,0.18)', fontStyle: 'italic', margin: 0 }}>
          No tickers mapped yet — click + Add to get started.
        </p>
      )}

      {/* ── Existing ticker rows ── */}
      {filteredTickers.map(tw => (
        <div key={tw.ticker} style={{
          display: 'grid', gridTemplateColumns: '64px 1fr 100px 68px 24px',
          alignItems: 'center', gap: '0.6rem',
          padding: '0.45rem 0.6rem', marginBottom: '0.35rem',
          background: 'rgba(255,255,255,0.02)', borderRadius: 5,
          border: '1px solid rgba(255,255,255,0.03)',
        }}>

          {/* Ticker — opens detail page */}
          <a
            href={`/dashboard/tickers/${tw.ticker}`}
            style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--gold)', fontFamily: 'monospace', textDecoration: 'none' }}
          >
            {tw.ticker}
          </a>

          {/* Rationale */}
          <span style={{ fontSize: '0.68rem', color: 'rgba(232,226,217,0.38)', lineHeight: 1.4 }}>
            {tw.rationale ?? '—'}
          </span>

          {/* Weight bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
              <div style={{ width: `${tw.final_weight * 100}%`, height: '100%', background: weightColor(tw.final_weight), borderRadius: 2 }} />
            </div>
            <span style={{ fontSize: '0.6rem', color: weightColor(tw.final_weight), minWidth: '2rem', textAlign: 'right', fontWeight: 600 }}>
              {(tw.final_weight * 100).toFixed(0)}%
            </span>
          </div>

          {/* Weight label */}
          <span style={{
            fontSize: '0.55rem', fontWeight: 500, textAlign: 'center',
            background: `${weightColor(tw.final_weight)}18`, color: weightColor(tw.final_weight),
            padding: '0.1rem 0.3rem', borderRadius: 3,
          }}>
            {weightLabel(tw.final_weight)}
          </span>

          {/* Remove */}
          <button
            onClick={() => handleRemove(tw.ticker)}
            disabled={removing === tw.ticker}
            title="Remove from theme"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: removing === tw.ticker ? 'rgba(232,112,112,0.25)' : 'rgba(232,112,112,0.35)',
              fontSize: '0.75rem', padding: 0, lineHeight: 1,
            }}
          >
            {removing === tw.ticker ? '…' : '✕'}
          </button>
        </div>
      ))}

      {filterQuery && filteredTickers.length === 0 && (
        <div style={{ fontSize: '0.7rem', color: 'rgba(232,226,217,0.2)', padding: '0.4rem 0' }}>
          No tickers match "{filterQuery}"
        </div>
      )}

      {/* Show All / Show Less toggle */}
      {tickers.length > 6 && (
        <button
          onClick={() => setShowAll(!showAll)}
          style={{
            fontSize: '0.62rem', color: 'rgba(200,169,110,0.5)',
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '0.3rem 0', display: 'block', marginTop: '0.2rem',
          }}
        >
          {showAll ? `↑ Show less` : `↓ Show all ${tickers.length} tickers`}
        </button>
      )}

      {/* ── Add new ticker panel ── */}
      {showAdd && (
        <div style={{
          marginTop: '0.75rem',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(200,169,110,0.2)',
          borderRadius: 8, padding: '0.85rem 1rem',
        }}>

          {/* Asset type filter */}
          <div style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.5rem' }}>
            {(['all', 'stock', 'etf', 'crypto'] as const).map(type => (
              <button
                key={type}
                onClick={() => setAssetType(type)}
                style={{
                  fontSize: '0.6rem', fontWeight: 600, textTransform: 'uppercase',
                  padding: '0.2rem 0.5rem', borderRadius: 4, cursor: 'pointer',
                  border: `1px solid ${assetType === type ? 'rgba(200,169,110,0.5)' : 'rgba(232,226,217,0.08)'}`,
                  background: assetType === type ? 'rgba(200,169,110,0.12)' : 'transparent',
                  color: assetType === type ? 'var(--gold)' : 'rgba(232,226,217,0.3)',
                }}
              >
                {type === 'all' ? 'All' : type === 'stock' ? 'Stocks' : type === 'etf' ? 'ETFs' : 'Crypto'}
              </button>
            ))}
          </div>

          {/* Search input */}
          <input
            ref={addInputRef}
            value={addQuery}
            onChange={e => setAddQuery(e.target.value)}
            placeholder="Search ticker or company name…"
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(232,226,217,0.1)',
              borderRadius: 5, padding: '0.5rem 0.75rem',
              color: 'var(--cream)', fontSize: '0.82rem', outline: 'none',
            }}
          />

          {/* Search results */}
          {addResults.length > 0 && (
            <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              {addResults.map(r => {
                const inTheme = tickers.some(t => t.ticker === r.ticker)
                return (
                  <div key={r.ticker} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '0.45rem 0.6rem', borderRadius: 5,
                    background: 'rgba(255,255,255,0.03)',
                    border: `1px solid ${inTheme ? 'rgba(200,169,110,0.15)' : 'rgba(255,255,255,0.04)'}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--gold)', fontFamily: 'monospace' }}>
                        {r.ticker}
                      </span>
                      <span style={{ fontSize: '0.68rem', color: 'rgba(232,226,217,0.35)' }}>
                        {r.name}
                      </span>
                      {r.asset_type && (
                        <span style={{ fontSize: '0.55rem', color: 'rgba(232,226,217,0.2)',
                          background: 'rgba(255,255,255,0.04)', padding: '0.05rem 0.3rem', borderRadius: 3 }}>
                          {r.asset_type}
                        </span>
                      )}
                      {inTheme && (
                        <span style={{ fontSize: '0.55rem', color: 'rgba(200,169,110,0.5)',
                          background: 'rgba(200,169,110,0.08)', padding: '0.05rem 0.3rem', borderRadius: 3 }}>
                          in theme
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '0.3rem' }}>
                      {/* Watchlist */}
                      <button
                        onClick={() => handleWatchlist(r.ticker)}
                        style={{
                          fontSize: '0.58rem', fontWeight: 500,
                          color: watchlisted.has(r.ticker) ? 'rgba(78,202,153,0.7)' : 'rgba(200,169,110,0.55)',
                          background: watchlisted.has(r.ticker) ? 'rgba(78,202,153,0.06)' : 'rgba(200,169,110,0.05)',
                          border: `1px solid ${watchlisted.has(r.ticker) ? 'rgba(78,202,153,0.2)' : 'rgba(200,169,110,0.12)'}`,
                          borderRadius: 4, padding: '0.15rem 0.45rem', cursor: 'pointer',
                        }}
                      >
                        {watchlisted.has(r.ticker) ? '✓ Watchlist' : '+ Watchlist'}
                      </button>
                      {/* Add to theme */}
                      <button
                        onClick={() => handleAdd(r.ticker)}
                        disabled={adding === r.ticker}
                        style={{
                          fontSize: '0.58rem', fontWeight: 600,
                          color: inTheme ? 'rgba(200,169,110,0.5)' : 'rgba(78,202,153,0.8)',
                          background: inTheme ? 'rgba(200,169,110,0.06)' : 'rgba(78,202,153,0.08)',
                          border: `1px solid ${inTheme ? 'rgba(200,169,110,0.18)' : 'rgba(78,202,153,0.2)'}`,
                          borderRadius: 4, padding: '0.15rem 0.45rem',
                          cursor: adding === r.ticker ? 'wait' : 'pointer',
                        }}
                      >
                        {adding === r.ticker ? '…' : inTheme ? '↻ Update' : '+ Theme'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {addQuery.length > 0 && addResults.length === 0 && (
            <div style={{ fontSize: '0.7rem', color: 'rgba(232,226,217,0.2)', marginTop: '0.5rem' }}>
              No assets found for "{addQuery}"
            </div>
          )}

          {/* Weight + rationale */}
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '0.75rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ fontSize: '0.62rem', color: 'rgba(232,226,217,0.3)' }}>Weight</span>
              <input
                type="range" min="0.1" max="1.0" step="0.05"
                value={weight}
                onChange={e => setWeight(parseFloat(e.target.value))}
                style={{ width: 80, accentColor: weightColor(weight) }}
              />
              <span style={{ fontSize: '0.65rem', fontWeight: 600, color: weightColor(weight), fontFamily: 'monospace', minWidth: 26 }}>
                {(weight * 100).toFixed(0)}%
              </span>
              <span style={{ fontSize: '0.58rem', color: 'rgba(232,226,217,0.22)' }}>
                ({weightLabel(weight)})
              </span>
            </div>
            <input
              value={addRationale}
              onChange={e => setAddRationale(e.target.value)}
              placeholder="Rationale (optional)"
              style={{
                flex: 1, minWidth: 140,
                background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(232,226,217,0.07)',
                borderRadius: 4, padding: '0.28rem 0.55rem',
                color: 'var(--cream)', fontSize: '0.7rem', outline: 'none',
              }}
            />
          </div>

          {error && (
            <div style={{ fontSize: '0.68rem', color: '#e87070', marginTop: '0.5rem' }}>{error}</div>
          )}
        </div>
      )}
    </div>
  )
}
