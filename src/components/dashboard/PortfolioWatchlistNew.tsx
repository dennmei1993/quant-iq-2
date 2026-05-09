'use client'
// src/components/dashboard/PortfolioWatchlistNew.tsx
// Per-portfolio watchlist with three add modes:
//   1. Manual ticker search
//   2. From portfolio universe (based on preferences)
//   3. From bullish themes / sectors in current market

import { useState, useEffect, useRef, useCallback } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface WatchlistEntry {
  id:        string
  ticker:    string
  name:      string | null
  notes:     string | null
  added_at:  string
  // enriched client-side from signals
  price_usd?:  number | null
  change_pct?: number | null
  signal?:     string | null
}

interface UniverseTicker {
  ticker: string
  name:   string | null
  signal: string | null
  score:  number | null
}

interface ThemeGroup {
  id:       string
  name:     string
  momentum: string | null
  tickers:  UniverseTicker[]
}

interface Props {
  portfolioId: string
  universe:    string[]   // from portfolio prefs e.g. ['mag7','sp500']
  themes:      { id: string; name: string; momentum: string | null; conviction: number | null }[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const sigCol = (s: string | null | undefined) => {
  if (s === 'buy')   return 'var(--signal-bull)'
  if (s === 'avoid') return 'var(--signal-bear)'
  if (s === 'watch') return 'var(--signal-neut)'
  return 'var(--text-4)'
}

const labelSt: React.CSSProperties = {
  fontSize: '8.5px', fontWeight: 500, color: 'var(--text-4)',
  textTransform: 'uppercase', letterSpacing: '0.07em',
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PortfolioWatchlistNew({ portfolioId, universe, themes }: Props) {
  const [entries,      setEntries]      = useState<WatchlistEntry[]>([])
  const [loading,      setLoading]      = useState(true)
  const [modalOpen,    setModalOpen]    = useState(false)
  const [tab,          setTab]          = useState<'manual' | 'universe' | 'themes'>('manual')
  const [removing,     setRemoving]     = useState<string | null>(null)

  // Manual search
  const [query,        setQuery]        = useState('')
  const [results,      setResults]      = useState<{ ticker: string; name: string; asset_type: string }[]>([])
  const [searching,    setSearching]    = useState(false)
  const [addingNote,   setAddingNote]   = useState('')
  const [selected,     setSelected]     = useState<{ ticker: string; name: string } | null>(null)
  const [saving,       setSaving]       = useState(false)

  // Universe suggestions
  const [uniTickers,   setUniTickers]   = useState<UniverseTicker[]>([])
  const [uniLoading,   setUniLoading]   = useState(false)
  const [uniFilter,    setUniFilter]    = useState<'all' | 'buy' | 'watch'>('buy')

  // Theme suggestions
  const [themeGroups,  setThemeGroups]  = useState<ThemeGroup[]>([])
  const [themeLoading, setThemeLoading] = useState(false)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef    = useRef<HTMLInputElement>(null)

  // ── Load watchlist ──────────────────────────────────────────────────────────

  const loadWatchlist = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/portfolio/watchlist?portfolio_id=${portfolioId}`)
      const data = await res.json()
      const raw: WatchlistEntry[] = data.watchlist ?? []

      // Enrich with live signals
      if (raw.length) {
        const tickers = raw.map(e => e.ticker).join(',')
        const sigRes  = await fetch(`/api/assets/signals?tickers=${tickers}`)
        const sigData = await sigRes.json()
        const sigMap  = Object.fromEntries((sigData.signals ?? []).map((s: any) => [s.ticker, s]))
        setEntries(raw.map(e => ({
          ...e,
          price_usd:  sigMap[e.ticker]?.price_usd  ?? null,
          change_pct: sigMap[e.ticker]?.change_pct ?? null,
          signal:     sigMap[e.ticker]?.signal     ?? null,
        })))
      } else {
        setEntries([])
      }
    } catch {
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [portfolioId])

  useEffect(() => { loadWatchlist() }, [loadWatchlist])

  // ── Manual ticker search ────────────────────────────────────────────────────

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query.trim() || selected) { setResults([]); return }
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res  = await fetch(`/api/assets/search?q=${encodeURIComponent(query)}&limit=6`)
        const data = await res.json()
        setResults(data.assets ?? [])
      } catch { setResults([]) }
      finally { setSearching(false) }
    }, 220)
  }, [query, selected])

  // ── Universe suggestions ────────────────────────────────────────────────────

  async function loadUniverse() {
    if (!universe.length) return
    setUniLoading(true)
    try {
      const res  = await fetch(`/api/assets/universe?sets=${universe.join(',')}&limit=60`)
      const data = await res.json()
      setUniTickers(data.tickers ?? [])
    } catch { setUniTickers([]) }
    finally { setUniLoading(false) }
  }

  // ── Theme suggestions ───────────────────────────────────────────────────────

  async function loadThemes() {
    if (!themes.length) return
    setThemeLoading(true)
    try {
      const ids  = themes.map(t => t.id).join(',')
      const res  = await fetch(`/api/themes/tickers?theme_ids=${ids}&signal=buy&limit=8`)
      const data = await res.json()
      // Group by theme
      const grouped: ThemeGroup[] = themes.map(t => ({
        id:       t.id,
        name:     t.name,
        momentum: t.momentum,
        tickers:  (data.tickers ?? []).filter((tk: any) => tk.theme_id === t.id),
      })).filter(g => g.tickers.length > 0)
      setThemeGroups(grouped)
    } catch { setThemeGroups([]) }
    finally { setThemeLoading(false) }
  }

  // ── Add to watchlist ────────────────────────────────────────────────────────

  async function addTicker(ticker: string, name: string | null, notes = '') {
    if (entries.some(e => e.ticker === ticker)) return // already on list
    setSaving(true)
    try {
      await fetch('/api/portfolio/watchlist', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ portfolio_id: portfolioId, ticker, name, notes }),
      })
      await loadWatchlist()
      // Reset manual form
      setQuery(''); setSelected(null); setAddingNote(''); setResults([])
    } catch {}
    finally { setSaving(false) }
  }

  // ── Remove ──────────────────────────────────────────────────────────────────

  async function remove(ticker: string) {
    setRemoving(ticker)
    await fetch(`/api/portfolio/watchlist?portfolio_id=${portfolioId}&ticker=${ticker}`, { method: 'DELETE' })
    setEntries(prev => prev.filter(e => e.ticker !== ticker))
    setRemoving(null)
  }

  // ── Computed ────────────────────────────────────────────────────────────────

  const watchedTickers = new Set(entries.map(e => e.ticker))

  const filteredUni = uniTickers.filter(t =>
    uniFilter === 'all' ? true : t.signal === uniFilter
  )

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Watchlist entries */}
      {loading ? (
        <div style={{ color: 'var(--text-4)', fontSize: 'var(--fs-sm)', padding: '10px 0' }}>Loading…</div>
      ) : entries.length === 0 ? (
        <div style={{ color: 'var(--text-4)', fontSize: 'var(--fs-sm)', padding: '8px 0', lineHeight: 1.5 }}>
          No tickers yet.{' '}
          <button onClick={() => setModalOpen(true)}
            style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 'var(--fs-sm)', padding: 0 }}>
            Add tickers ↗
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {entries.map(e => (
            <div key={e.id} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 0', borderBottom: '1px solid var(--border-subtle)',
            }}>
              {/* Signal dot */}
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: sigCol(e.signal), flexShrink: 0, display: 'inline-block' }} />

              {/* Ticker + name */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 500, color: 'var(--text)' }}>{e.ticker}</div>
                {e.name && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.name}</div>}
              </div>

              {/* Price + change */}
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                {e.price_usd != null && (
                  <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)' }}>${e.price_usd.toFixed(2)}</div>
                )}
                {e.change_pct != null && (
                  <div style={{ fontSize: 'var(--fs-xs)', color: e.change_pct >= 0 ? 'var(--signal-bull)' : 'var(--signal-bear)' }}>
                    {e.change_pct >= 0 ? '+' : ''}{e.change_pct.toFixed(2)}%
                  </div>
                )}
              </div>

              {/* Remove */}
              <button onClick={() => remove(e.ticker)} disabled={removing === e.ticker}
                style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: 13, lineHeight: 1, opacity: removing === e.ticker ? 0.4 : 1, flexShrink: 0 }}>×</button>
            </div>
          ))}

          {/* Add more */}
          <button onClick={() => setModalOpen(true)}
            style={{ marginTop: 6, background: 'none', border: '1px dashed var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-4)', fontSize: 'var(--fs-xs)', padding: '4px 0', cursor: 'pointer', width: '100%' }}>
            + Add tickers
          </button>
        </div>
      )}

      {/* ── Add modal ── */}
      {modalOpen && (
        <>
          <div onClick={() => setModalOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.4)' }} />
          <div onClick={e => e.stopPropagation()} style={{
            position: 'fixed', top: '50%', left: '50%',
            transform: 'translate(-50%,-50%)',
            zIndex: 201, background: 'var(--bg)',
            border: '1px solid var(--border)', borderRadius: 8,
            width: 520, maxHeight: '80vh',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 16px 48px rgba(0,0,0,0.15)',
          }}>

            {/* Modal header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 'var(--fs-heading)', fontWeight: 500, color: 'var(--text)' }}>Add to watchlist</span>
              <button onClick={() => setModalOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1 }}>×</button>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 16px' }}>
              {([
                { key: 'manual',   label: 'Search' },
                { key: 'universe', label: 'From universe' },
                { key: 'themes',   label: 'Bullish themes' },
              ] as const).map(({ key, label }) => (
                <button key={key}
                  onClick={() => {
                    setTab(key)
                    if (key === 'universe' && !uniTickers.length) loadUniverse()
                    if (key === 'themes'   && !themeGroups.length) loadThemes()
                  }}
                  style={{
                    padding: '8px 12px', background: 'transparent', border: 'none',
                    borderBottom: `2px solid ${tab === key ? 'var(--text)' : 'transparent'}`,
                    color: tab === key ? 'var(--text)' : 'var(--text-4)',
                    fontSize: 'var(--fs-sm)', fontWeight: tab === key ? 500 : 400,
                    cursor: 'pointer', marginBottom: -1, transition: 'all 0.1s',
                  }}>
                  {label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>

              {/* ── Manual search ── */}
              {tab === 'manual' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ position: 'relative' }}>
                    <input
                      ref={inputRef}
                      value={selected ? `${selected.ticker} — ${selected.name}` : query}
                      onChange={e => { setQuery(e.target.value.toUpperCase()); setSelected(null) }}
                      placeholder="Search ticker or company name…"
                      autoFocus
                      style={{
                        width: '100%', padding: '7px 10px',
                        background: 'var(--bg-subtle)', border: '1px solid var(--border)',
                        borderRadius: 'var(--r-md)', color: 'var(--text)',
                        fontSize: 'var(--fs-sm)', outline: 'none', fontFamily: 'inherit',
                        boxSizing: 'border-box',
                      }}
                    />
                    {searching && (
                      <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 'var(--fs-xs)', color: 'var(--text-4)' }}>…</span>
                    )}
                    {results.length > 0 && !selected && (
                      <div style={{
                        position: 'absolute', top: '100%', left: 0, right: 0,
                        zIndex: 10, background: 'var(--bg)',
                        border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
                        marginTop: 2, overflow: 'hidden',
                        boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
                      }}>
                        {results.map(r => (
                          <div key={r.ticker}
                            onClick={() => { setSelected({ ticker: r.ticker, name: r.name }); setResults([]) }}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 8,
                              padding: '7px 10px', cursor: 'pointer',
                              borderBottom: '1px solid var(--border-subtle)',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-subtle)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                          >
                            <span style={{ fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', minWidth: 52 }}>{r.ticker}</span>
                            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-3)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', textTransform: 'uppercase' }}>{r.asset_type}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {selected && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ padding: '8px 10px', background: 'var(--bg-subtle)', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text)' }}>{selected.ticker}</div>
                        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)' }}>{selected.name}</div>
                      </div>
                      <div>
                        <div style={{ ...labelSt, marginBottom: 4 }}>Note (optional)</div>
                        <input
                          value={addingNote}
                          onChange={e => setAddingNote(e.target.value)}
                          placeholder="e.g. Wait for pullback to $180"
                          style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text)', fontSize: 'var(--fs-sm)', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => { setSelected(null); setQuery('') }}
                          style={{ padding: '5px 12px', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-3)', fontSize: 'var(--fs-sm)', cursor: 'pointer', fontFamily: 'inherit' }}>
                          Clear
                        </button>
                        <button
                          onClick={() => addTicker(selected.ticker, selected.name, addingNote)}
                          disabled={saving || watchedTickers.has(selected.ticker)}
                          style={{
                            flex: 1, padding: '5px 12px',
                            background: watchedTickers.has(selected.ticker) ? 'var(--bg-subtle)' : 'var(--text)',
                            border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
                            color: watchedTickers.has(selected.ticker) ? 'var(--text-4)' : 'var(--bg)',
                            fontSize: 'var(--fs-sm)', fontWeight: 500, cursor: saving || watchedTickers.has(selected.ticker) ? 'default' : 'pointer',
                            fontFamily: 'inherit',
                          }}>
                          {watchedTickers.has(selected.ticker) ? 'Already on watchlist' : saving ? 'Adding…' : `Add ${selected.ticker}`}
                        </button>
                      </div>
                    </div>
                  )}

                  {!selected && !query && (
                    <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-4)', paddingTop: 4 }}>
                      Type a ticker (e.g. AAPL) or company name to search.
                    </div>
                  )}
                </div>
              )}

              {/* ── Universe suggestions ── */}
              {tab === 'universe' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {!universe.length ? (
                    <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-4)' }}>
                      No universe selected in portfolio settings. Add one to see suggestions here.
                    </div>
                  ) : uniLoading ? (
                    <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-4)' }}>Loading universe tickers…</div>
                  ) : (
                    <>
                      {/* Filter tabs */}
                      <div style={{ display: 'flex', gap: 4 }}>
                        {([['all','All'], ['buy','Buy signal'], ['watch','Watch']] as const).map(([val, lbl]) => (
                          <button key={val} onClick={() => setUniFilter(val)}
                            style={{
                              padding: '3px 10px', borderRadius: 'var(--r-pill)',
                              background: uniFilter === val ? 'var(--text)' : 'none',
                              border: `1px solid ${uniFilter === val ? 'var(--text)' : 'var(--border)'}`,
                              color: uniFilter === val ? 'var(--bg)' : 'var(--text-4)',
                              fontSize: 'var(--fs-xs)', cursor: 'pointer', fontFamily: 'inherit',
                            }}>{lbl}</button>
                        ))}
                        <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-xs)', color: 'var(--text-4)', alignSelf: 'center' }}>
                          From: {universe.join(', ')}
                        </span>
                      </div>

                      {/* Ticker grid */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {filteredUni.length === 0 ? (
                          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-4)', padding: '8px 0' }}>No tickers match this filter.</div>
                        ) : filteredUni.map(t => {
                          const onList = watchedTickers.has(t.ticker)
                          return (
                            <div key={t.ticker} style={{
                              display: 'flex', alignItems: 'center', gap: 8,
                              padding: '6px 8px', borderRadius: 'var(--r-md)',
                              background: onList ? 'var(--bg-subtle)' : 'transparent',
                              border: '1px solid transparent',
                            }}>
                              <span style={{ width: 5, height: 5, borderRadius: '50%', background: sigCol(t.signal), flexShrink: 0, display: 'inline-block' }} />
                              <span style={{ fontWeight: 600, fontSize: 'var(--fs-sm)', color: 'var(--text)', minWidth: 52 }}>{t.ticker}</span>
                              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                              {t.signal && (
                                <span style={{ fontSize: 'var(--fs-xs)', color: sigCol(t.signal), fontWeight: 500, textTransform: 'uppercase', flexShrink: 0 }}>{t.signal}</span>
                              )}
                              <button
                                onClick={() => !onList && addTicker(t.ticker, t.name, '')}
                                disabled={onList || saving}
                                style={{
                                  padding: '2px 8px', borderRadius: 'var(--r-sm)',
                                  background: onList ? 'none' : 'var(--text)',
                                  border: `1px solid ${onList ? 'var(--border)' : 'var(--text)'}`,
                                  color: onList ? 'var(--text-4)' : 'var(--bg)',
                                  fontSize: 'var(--fs-xs)', cursor: onList ? 'default' : 'pointer',
                                  fontFamily: 'inherit', flexShrink: 0,
                                }}>
                                {onList ? '✓' : '+'}
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* ── Bullish themes ── */}
              {tab === 'themes' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {!themes.length ? (
                    <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-4)' }}>No active themes available.</div>
                  ) : themeLoading ? (
                    <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-4)' }}>Loading theme tickers…</div>
                  ) : themeGroups.length === 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-4)' }}>
                        No buy-signal tickers found for current themes. Active themes:
                      </div>
                      {themes.map(t => (
                        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-3)' }}>{t.name}</span>
                          {t.momentum && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)' }}>{t.momentum}</span>}
                        </div>
                      ))}
                    </div>
                  ) : themeGroups.map(g => (
                    <div key={g.id}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 500, color: 'var(--text)' }}>{g.name}</span>
                        {g.momentum && (
                          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--signal-bull)', background: 'rgba(21,128,61,0.08)', padding: '1px 6px', borderRadius: 'var(--r-pill)' }}>
                            {g.momentum}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {g.tickers.map(t => {
                          const onList = watchedTickers.has(t.ticker)
                          return (
                            <div key={t.ticker} style={{
                              display: 'flex', alignItems: 'center', gap: 8,
                              padding: '5px 8px', borderRadius: 'var(--r-md)',
                              background: onList ? 'var(--bg-subtle)' : 'transparent',
                            }}>
                              <span style={{ width: 5, height: 5, borderRadius: '50%', background: sigCol(t.signal), flexShrink: 0, display: 'inline-block' }} />
                              <span style={{ fontWeight: 600, fontSize: 'var(--fs-sm)', color: 'var(--text)', minWidth: 52 }}>{t.ticker}</span>
                              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                              <button
                                onClick={() => !onList && addTicker(t.ticker, t.name, '')}
                                disabled={onList || saving}
                                style={{
                                  padding: '2px 8px', borderRadius: 'var(--r-sm)',
                                  background: onList ? 'none' : 'var(--text)',
                                  border: `1px solid ${onList ? 'var(--border)' : 'var(--text)'}`,
                                  color: onList ? 'var(--text-4)' : 'var(--bg)',
                                  fontSize: 'var(--fs-xs)', cursor: onList ? 'default' : 'pointer',
                                  fontFamily: 'inherit', flexShrink: 0,
                                }}>
                                {onList ? '✓' : '+'}
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)' }}>
                {entries.length} on watchlist
              </span>
              <button onClick={() => setModalOpen(false)}
                style={{ padding: '4px 14px', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-3)', fontSize: 'var(--fs-sm)', cursor: 'pointer', fontFamily: 'inherit' }}>
                Done
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
