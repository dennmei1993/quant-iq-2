'use client'
// src/app/dashboard/watchlist/page.tsx
// Two-panel layout:
//   Left  — current portfolio's watchlist (ticker list)
//   Right — selection panel (search / universe / themes)
// Always scoped to the active portfolio from sessionStorage.

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Portfolio {
  id:       string
  name:     string
  universe: string[]
}

interface Theme {
  id:         string
  name:       string
  momentum:   string | null
  conviction: number | null
}

interface WatchlistEntry {
  id:         string
  ticker:     string
  name:       string | null
  notes:      string | null
  added_at:   string
  price_usd?:  number | null
  change_pct?: number | null
  signal?:     string | null
}

interface UniverseTicker {
  ticker: string
  name:   string | null
  signal: string | null
}

interface ThemeGroup {
  id:       string
  name:     string
  momentum: string | null
  tickers:  UniverseTicker[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const sigCol = (s: string | null | undefined) => {
  if (s === 'buy')   return 'var(--signal-bull)'
  if (s === 'avoid') return 'var(--signal-bear)'
  if (s === 'watch') return 'var(--signal-neut)'
  return 'var(--text-4)'
}

const ls: React.CSSProperties = {
  fontSize: '8.5px', fontWeight: 500, color: 'var(--text-4)',
  textTransform: 'uppercase', letterSpacing: '0.07em', display: 'block', marginBottom: 4,
}

const inputSt = (extra?: React.CSSProperties): React.CSSProperties => ({
  width: '100%', padding: '6px 9px',
  background: 'var(--bg-subtle)', border: '1px solid var(--border)',
  borderRadius: 'var(--r-md)', color: 'var(--text)',
  fontSize: 'var(--fs-sm)', outline: 'none', fontFamily: 'inherit',
  boxSizing: 'border-box', ...extra,
})

// ── Left panel: Watchlist ticker list ────────────────────────────────────────

function WatchlistPanel({
  portfolioId,
  entries,
  loading,
  removing,
  onRemove,
  onBuy,
}: {
  portfolioId: string
  entries:     WatchlistEntry[]
  loading:     boolean
  removing:    string | null
  onRemove:    (ticker: string) => void
  onBuy:       (ticker: string, name: string | null) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {loading ? (
        <div style={{ color: 'var(--text-4)', fontSize: 'var(--fs-sm)', padding: '12px 0' }}>Loading…</div>
      ) : entries.length === 0 ? (
        <div style={{ color: 'var(--text-4)', fontSize: 'var(--fs-sm)', padding: '12px 0', lineHeight: 1.6 }}>
          No tickers on this watchlist yet. Use the panel on the right to add some.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {/* Table header */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 72px 72px 60px 48px 24px',
            gap: 6, padding: '0 0 6px',
            borderBottom: '1px solid var(--border)',
            fontSize: 'var(--fs-label)', fontWeight: 500,
            color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>
            <span>Ticker</span>
            <span style={{ textAlign: 'right' }}>Price</span>
            <span style={{ textAlign: 'right' }}>Day chg</span>
            <span style={{ textAlign: 'right' }}>Signal</span>
            <span />
            <span />
          </div>

          {entries.map(e => (
            <div key={e.id} style={{
              display: 'grid', gridTemplateColumns: '1fr 72px 72px 60px 48px 24px',
              gap: 6, padding: '9px 0', borderBottom: '1px solid var(--border-subtle)',
              alignItems: 'center',
            }}>
              {/* Ticker + name */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: sigCol(e.signal), flexShrink: 0, display: 'inline-block' }} />
                  <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text)' }}>{e.ticker}</span>
                </div>
                {e.name && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', marginTop: 1, paddingLeft: 11 }}>{e.name}</div>}
                {e.notes && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: 1, paddingLeft: 11, fontStyle: 'italic' }}>{e.notes}</div>}
              </div>
              {/* Price */}
              <div style={{ textAlign: 'right', fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                {e.price_usd != null ? `$${e.price_usd.toFixed(2)}` : '—'}
              </div>
              {/* Day change */}
              <div style={{ textAlign: 'right', fontSize: 'var(--fs-sm)', fontWeight: 500, color: e.change_pct != null ? (e.change_pct >= 0 ? 'var(--signal-bull)' : 'var(--signal-bear)') : 'var(--text-4)' }}>
                {e.change_pct != null ? `${e.change_pct >= 0 ? '+' : ''}${e.change_pct.toFixed(2)}%` : '—'}
              </div>
              {/* Signal */}
              <div style={{ textAlign: 'right' }}>
                {e.signal && (
                  <span style={{ fontSize: 9, fontWeight: 600, color: sigCol(e.signal), textTransform: 'uppercase' }}>{e.signal}</span>
                )}
              </div>
              {/* Add to portfolio */}
              <button
                onClick={() => onBuy(e.ticker, e.name ?? null)}
                style={{ fontSize: 9.5, padding: '2px 7px', background: 'rgba(21,128,61,0.08)', border: '1px solid rgba(21,128,61,0.25)', color: 'var(--signal-bull)', borderRadius: 3, cursor: 'pointer', fontWeight: 500, fontFamily: 'inherit' }}
              >Buy</button>
              {/* Remove */}
              <button
                onClick={() => onRemove(e.ticker)}
                disabled={removing === e.ticker}
                style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: 14, lineHeight: 1, opacity: removing === e.ticker ? 0.4 : 1, padding: 0, textAlign: 'center' }}
                title="Remove"
              >×</button>
            </div>
          ))}
        </div>
      )}
      {/* ── Buy modal ── */}
      {txModal && (
        <>
          <div onClick={() => setTxModal(null)} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.4)' }} />
          <div onClick={e => e.stopPropagation()} style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            zIndex: 201, background: 'var(--bg)', border: '1px solid var(--border)',
            borderRadius: 8, padding: '1.4rem', width: 360,
            boxShadow: '0 16px 48px rgba(0,0,0,0.15)',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <div>
                <div style={{ ...ls, marginBottom: 2 }}>Add to portfolio</div>
                <div style={{ fontSize: 'var(--fs-heading)', fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{txModal.ticker}</div>
                {txModal.name && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)' }}>{txModal.name}</div>}
              </div>
              <button onClick={() => setTxModal(null)} style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1 }}>×</button>
            </div>

            {/* Fields */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '0.9rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div>
                  <div style={ls}>Quantity</div>
                  <input value={txQty} onChange={e => setTxQty(e.target.value)} placeholder="0" type="number" style={inputSt()} />
                </div>
                <div>
                  <div style={ls}>Buy price ($)</div>
                  <input value={txPrice} onChange={e => setTxPrice(e.target.value)} placeholder="0.00" type="number" style={inputSt()} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div>
                  <div style={ls}>Date</div>
                  <input value={txDate} onChange={e => setTxDate(e.target.value)} type="date" style={inputSt()} />
                </div>
                <div>
                  <div style={ls}>Fees ($)</div>
                  <input value={txFees} onChange={e => setTxFees(e.target.value)} placeholder="0.00" type="number" style={inputSt()} />
                </div>
              </div>
              <div>
                <div style={ls}>Notes (optional)</div>
                <input value={txNotes} onChange={e => setTxNotes(e.target.value)} placeholder="e.g. Earnings play" style={inputSt()} />
              </div>
            </div>

            {/* Total preview */}
            {txQty && txPrice && (
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-3)', marginBottom: '0.8rem', padding: '0.4rem 0.7rem', background: 'var(--bg-subtle)', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
                Total cost: <strong style={{ color: 'var(--text)' }}>
                  ${(parseFloat(txQty || '0') * parseFloat(txPrice || '0') + parseFloat(txFees || '0')).toFixed(2)}
                </strong>
              </div>
            )}

            {txError && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--signal-bear)', marginBottom: '0.8rem' }}>{txError}</div>}

            {/* Actions */}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setTxModal(null)}
                style={{ padding: '4px 12px', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-3)', fontSize: 'var(--fs-sm)', cursor: 'pointer', fontFamily: 'inherit' }}>
                Cancel
              </button>
              <button onClick={handleBuy} disabled={txSaving}
                style={{ padding: '4px 14px', background: 'rgba(21,128,61,0.1)', border: '1px solid rgba(21,128,61,0.3)', color: 'var(--signal-bull)', fontWeight: 600, borderRadius: 'var(--r-md)', cursor: txSaving ? 'not-allowed' : 'pointer', fontSize: 'var(--fs-sm)', opacity: txSaving ? 0.6 : 1, fontFamily: 'inherit' }}>
                {txSaving ? '…' : 'Record Buy'}
              </button>
            </div>
          </div>
        </>
      )}

    </div>
  )
}

// ── Right panel: Selection ────────────────────────────────────────────────────

function SelectionPanel({
  universe,
  themes,
  watchedTickers,
  onAdd,
  adding,
}: {
  universe:       string[]
  themes:         Theme[]
  watchedTickers: Set<string>
  onAdd:          (ticker: string, name: string | null, notes: string) => Promise<void>
  adding:         boolean
}) {
  const [tab,          setTab]          = useState<'manual' | 'universe' | 'themes'>('manual')

  // Manual
  const [query,        setQuery]        = useState('')
  const [results,      setResults]      = useState<{ ticker: string; name: string; asset_type: string }[]>([])
  const [searching,    setSearching]    = useState(false)
  const [selected,     setSelected]     = useState<{ ticker: string; name: string } | null>(null)
  const [note,         setNote]         = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Universe
  const [uniTickers,   setUniTickers]   = useState<UniverseTicker[]>([])
  const [uniLoading,   setUniLoading]   = useState(false)
  const [uniLoaded,    setUniLoaded]    = useState(false)
  const [uniFilter,    setUniFilter]    = useState<'all' | 'buy' | 'watch'>('buy')

  // Themes
  const [themeGroups,  setThemeGroups]  = useState<ThemeGroup[]>([])
  const [themeLoading, setThemeLoading] = useState(false)
  const [themeLoaded,  setThemeLoaded]  = useState(false)

  // Manual search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query.trim() || selected) { setResults([]); return }
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res  = await fetch(`/api/assets/search?q=${encodeURIComponent(query)}&limit=8`)
        const data = await res.json()
        setResults(data.assets ?? [])
      } catch { setResults([]) }
      finally   { setSearching(false) }
    }, 220)
  }, [query, selected])

  async function loadUniverse() {
    if (!universe.length || uniLoaded) return
    setUniLoading(true)
    try {
      const res  = await fetch(`/api/assets/universe?sets=${universe.join(',')}&limit=80`)
      const data = await res.json()
      setUniTickers(data.tickers ?? [])
      setUniLoaded(true)
    } catch {}
    finally { setUniLoading(false) }
  }

  async function loadThemes() {
    if (!themes.length || themeLoaded) return
    setThemeLoading(true)
    try {
      const ids  = themes.map(t => t.id).join(',')
      const res  = await fetch(`/api/themes/tickers?theme_ids=${ids}&signal=buy&limit=10`)
      const data = await res.json()
      const grouped: ThemeGroup[] = themes.map(t => ({
        id:       t.id,
        name:     t.name,
        momentum: t.momentum,
        tickers:  (data.tickers ?? []).filter((tk: any) => tk.theme_id === t.id),
      })).filter(g => g.tickers.length > 0)
      setThemeGroups(grouped)
      setThemeLoaded(true)
    } catch {}
    finally { setThemeLoading(false) }
  }

  async function handleAdd(ticker: string, name: string | null, notes = '') {
    await onAdd(ticker, name, notes)
    setSelected(null); setQuery(''); setNote(''); setResults([])
  }

  const filtered = uniTickers.filter(t => uniFilter === 'all' || t.signal === uniFilter)

  const tabBtn = (key: typeof tab, label: string) => (
    <button key={key} onClick={() => {
      setTab(key)
      if (key === 'universe') loadUniverse()
      if (key === 'themes')   loadThemes()
    }} style={{
      padding: '6px 12px', background: 'transparent', border: 'none',
      borderBottom: `2px solid ${tab === key ? 'var(--text)' : 'transparent'}`,
      color: tab === key ? 'var(--text)' : 'var(--text-4)',
      fontSize: 'var(--fs-sm)', fontWeight: tab === key ? 500 : 400,
      cursor: 'pointer', marginBottom: -1, fontFamily: 'inherit',
    }}>{label}</button>
  )

  const addBtn = (ticker: string, name: string | null) => {
    const on = watchedTickers.has(ticker)
    return (
      <button
        onClick={() => !on && handleAdd(ticker, name)}
        disabled={on || adding}
        style={{
          padding: '2px 10px', borderRadius: 'var(--r-sm)',
          background: on ? 'none' : 'var(--text)',
          border: `1px solid ${on ? 'var(--border)' : 'var(--text)'}`,
          color: on ? 'var(--text-4)' : 'var(--bg)',
          fontSize: 'var(--fs-xs)', cursor: on ? 'default' : 'pointer',
          fontFamily: 'inherit', flexShrink: 0,
        }}
      >{on ? '✓' : '+'}</button>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 14 }}>
        {tabBtn('manual',   'Search')}
        {tabBtn('universe', 'Universe')}
        {tabBtn('themes',   'Bullish themes')}
      </div>

      {/* ── Search ── */}
      {tab === 'manual' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ position: 'relative' }}>
            <input
              value={selected ? `${selected.ticker} — ${selected.name}` : query}
              onChange={e => { setQuery(e.target.value.toUpperCase()); setSelected(null) }}
              placeholder="Ticker or company name…"
              autoFocus
              style={inputSt()}
            />
            {searching && <span style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', fontSize: 'var(--fs-xs)', color: 'var(--text-4)' }}>…</span>}
            {results.length > 0 && !selected && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', marginTop: 2, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.1)' }}>
                {results.map(r => (
                  <div key={r.ticker}
                    onClick={() => { setSelected({ ticker: r.ticker, name: r.name }); setResults([]) }}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)' }}
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
              <div style={{ padding: '8px 10px', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)' }}>
                <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text)' }}>{selected.ticker}</div>
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)' }}>{selected.name}</div>
              </div>
              <div>
                <label style={ls}>Note (optional)</label>
                <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Wait for pullback to $180" style={inputSt()} />
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => { setSelected(null); setQuery('') }}
                  style={{ padding: '5px 12px', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-3)', fontSize: 'var(--fs-sm)', cursor: 'pointer', fontFamily: 'inherit' }}>
                  Clear
                </button>
                <button
                  onClick={() => handleAdd(selected.ticker, selected.name, note)}
                  disabled={adding || watchedTickers.has(selected.ticker)}
                  style={{
                    flex: 1, padding: '5px 12px',
                    background: watchedTickers.has(selected.ticker) ? 'var(--bg-subtle)' : 'var(--text)',
                    border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
                    color: watchedTickers.has(selected.ticker) ? 'var(--text-4)' : 'var(--bg)',
                    fontSize: 'var(--fs-sm)', fontWeight: 500, cursor: adding || watchedTickers.has(selected.ticker) ? 'default' : 'pointer', fontFamily: 'inherit',
                  }}>
                  {watchedTickers.has(selected.ticker) ? 'Already on watchlist' : adding ? 'Adding…' : `Add ${selected.ticker}`}
                </button>
              </div>
            </div>
          )}

          {!selected && !query && (
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-4)' }}>Type a ticker or company name to search.</div>
          )}
        </div>
      )}

      {/* ── Universe ── */}
      {tab === 'universe' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {!universe.length ? (
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-4)' }}>
              No universe selected in portfolio settings.
            </div>
          ) : uniLoading ? (
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-4)' }}>Loading…</div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {(['all', 'buy', 'watch'] as const).map(f => (
                  <button key={f} onClick={() => setUniFilter(f)} style={{
                    padding: '3px 10px', borderRadius: 'var(--r-pill)',
                    background: uniFilter === f ? 'var(--text)' : 'none',
                    border: `1px solid ${uniFilter === f ? 'var(--text)' : 'var(--border)'}`,
                    color: uniFilter === f ? 'var(--bg)' : 'var(--text-4)',
                    fontSize: 'var(--fs-xs)', cursor: 'pointer', fontFamily: 'inherit',
                  }}>{f === 'all' ? 'All' : f === 'buy' ? 'Buy signal' : 'Watch'}</button>
                ))}
                <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-xs)', color: 'var(--text-4)' }}>
                  {universe.join(', ')}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, overflowY: 'auto', maxHeight: 420 }}>
                {filtered.length === 0 ? (
                  <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-4)', padding: '8px 0' }}>No tickers match.</div>
                ) : filtered.map(t => (
                  <div key={t.ticker} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', borderRadius: 'var(--r-md)', background: watchedTickers.has(t.ticker) ? 'var(--bg-subtle)' : 'transparent' }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: sigCol(t.signal), flexShrink: 0, display: 'inline-block' }} />
                    <span style={{ fontWeight: 600, fontSize: 'var(--fs-sm)', color: 'var(--text)', minWidth: 52 }}>{t.ticker}</span>
                    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                    {t.signal && <span style={{ fontSize: 9, color: sigCol(t.signal), fontWeight: 600, textTransform: 'uppercase', flexShrink: 0 }}>{t.signal}</span>}
                    {addBtn(t.ticker, t.name)}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Themes ── */}
      {tab === 'themes' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', maxHeight: 480 }}>
          {!themes.length ? (
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-4)' }}>No active themes.</div>
          ) : themeLoading ? (
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-4)' }}>Loading…</div>
          ) : themeGroups.length === 0 ? (
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-4)' }}>No buy-signal tickers found for active themes.</div>
          ) : themeGroups.map(g => (
            <div key={g.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 500, color: 'var(--text)' }}>{g.name}</span>
                {g.momentum && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--signal-bull)', background: 'rgba(21,128,61,0.08)', padding: '1px 6px', borderRadius: 'var(--r-pill)' }}>{g.momentum}</span>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {g.tickers.map(t => (
                  <div key={t.ticker} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', borderRadius: 'var(--r-md)', background: watchedTickers.has(t.ticker) ? 'var(--bg-subtle)' : 'transparent' }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: sigCol(t.signal), flexShrink: 0, display: 'inline-block' }} />
                    <span style={{ fontWeight: 600, fontSize: 'var(--fs-sm)', color: 'var(--text)', minWidth: 52 }}>{t.ticker}</span>
                    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                    {addBtn(t.ticker, t.name)}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WatchlistPage() {
  const supabase = createClient()
  const router   = useRouter()

  const [portfolio,  setPortfolio]  = useState<Portfolio | null>(null)
  const [themes,     setThemes]     = useState<Theme[]>([])
  const [entries,    setEntries]    = useState<WatchlistEntry[]>([])
  const [loading,    setLoading]    = useState(true)
  const [listLoad,   setListLoad]   = useState(true)
  const [removing,   setRemoving]   = useState<string | null>(null)
  const [adding,     setAdding]     = useState(false)

  // Transaction (Buy) modal
  const [txModal,  setTxModal]  = useState<{ ticker: string; name: string | null } | null>(null)
  const [txQty,    setTxQty]    = useState('')
  const [txPrice,  setTxPrice]  = useState('')
  const [txDate,   setTxDate]   = useState(new Date().toISOString().split('T')[0])
  const [txFees,   setTxFees]   = useState('')
  const [txNotes,  setTxNotes]  = useState('')
  const [txSaving, setTxSaving] = useState(false)
  const [txError,  setTxError]  = useState('')

  // Load portfolio + themes
  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const saved = sessionStorage.getItem('quant_iq_selected_portfolio')

      const [portRes, themeRes] = await Promise.all([
        supabase
          .from('portfolios')
          .select('id, name, universe')
          .eq('user_id', user.id)
          .order('created_at', { ascending: true }),
        supabase
          .from('themes')
          .select('id, name, momentum, conviction')
          .eq('is_active', true)
          .order('conviction', { ascending: false })
          .limit(8),
      ])

      const ports = portRes.data ?? []
      const active = (saved && ports.find(p => p.id === saved)) ? ports.find(p => p.id === saved)! : ports[0]
      setPortfolio(active ?? null)
      setThemes(themeRes.data ?? [])
      setLoading(false)
    }
    load()
  }, [])

  // Load watchlist entries whenever portfolio changes
  useEffect(() => {
    if (!portfolio) return
    loadEntries(portfolio.id)
  }, [portfolio?.id])

  async function loadEntries(portfolioId: string) {
    setListLoad(true)
    try {
      const res  = await fetch(`/api/portfolio/watchlist?portfolio_id=${portfolioId}`)
      const data = await res.json()
      const raw: WatchlistEntry[] = data.watchlist ?? []

      // Show entries immediately — no dependency on signals API
      setEntries(raw)
      setListLoad(false)

      // Enrich with live signals if tickers exist — fail silently
      if (raw.length) {
        try {
          const tickers = raw.map(e => e.ticker).join(',')
          const sigRes  = await fetch(`/api/assets/signals?tickers=${tickers}`)
          if (sigRes.ok) {
            const sigData = await sigRes.json()
            const sigMap  = Object.fromEntries((sigData.signals ?? []).map((s: any) => [s.ticker, s]))
            setEntries(raw.map(e => ({
              ...e,
              price_usd:  sigMap[e.ticker]?.price_usd  ?? null,
              change_pct: sigMap[e.ticker]?.change_pct ?? null,
              signal:     sigMap[e.ticker]?.signal     ?? null,
            })))
          }
        } catch {
          // Signals API unavailable — entries already shown without enrichment
        }
      }
    } catch {
      setEntries([])
      setListLoad(false)
    }
  }

  async function handleAdd(ticker: string, name: string | null, notes: string) {
    if (!portfolio) return
    setAdding(true)
    try {
      await fetch('/api/portfolio/watchlist', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ portfolio_id: portfolio.id, ticker, name, notes }),
      })
      await loadEntries(portfolio.id)
    } catch {}
    finally { setAdding(false) }
  }

  async function handleRemove(ticker: string) {
    if (!portfolio) return
    setRemoving(ticker)
    await fetch(`/api/portfolio/watchlist?portfolio_id=${portfolio.id}&ticker=${ticker}`, { method: 'DELETE' })
    setEntries(prev => prev.filter(e => e.ticker !== ticker))
    setRemoving(null)
  }

  async function handleBuy() {
    if (!txModal || !portfolio) return
    const qty   = parseFloat(txQty)
    const price = parseFloat(txPrice)
    if (isNaN(qty)   || qty   <= 0) { setTxError('Enter a valid quantity'); return }
    if (isNaN(price) || price <= 0) { setTxError('Enter a valid price');    return }
    setTxSaving(true); setTxError('')
    const res = await fetch('/api/portfolio/transaction', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        portfolio_id: portfolio.id,
        ticker:       txModal.ticker,
        type:         'buy',
        quantity:     qty,
        price,
        fees:         parseFloat(txFees) || 0,
        executed_at:  new Date(txDate).toISOString(),
        notes:        txNotes || undefined,
      }),
    })
    const d = await res.json()
    if (!res.ok) { setTxError(d.error ?? 'Failed'); setTxSaving(false); return }
    setTxModal(null)
    setTxQty(''); setTxPrice(''); setTxFees(''); setTxNotes('')
    setTxDate(new Date().toISOString().split('T')[0])
    setTxSaving(false)
  }

  const watchedTickers = new Set(entries.map(e => e.ticker))

  if (loading) {
    return <div style={{ color: 'var(--text-4)', fontSize: 'var(--fs-sm)', padding: '2rem 0' }}>Loading…</div>
  }

  if (!portfolio) {
    return <div style={{ color: 'var(--text-4)', fontSize: 'var(--fs-sm)' }}>No portfolio found. <button onClick={() => router.push('/dashboard/portfolio')} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 'var(--fs-sm)' }}>Create one ↗</button></div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>

      {/* Page header */}
      <div className="page-header">
        <div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Watchlist</div>
          <div className="page-title">{portfolio.name}</div>
        </div>
        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-4)' }}>
          {entries.length} {entries.length === 1 ? 'ticker' : 'tickers'}
        </span>
      </div>

      {/* Two-panel layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '30% 70%', gap: 'var(--sp-5)', alignItems: 'start' }}>

        {/* Left: Ticker list */}
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
          <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)' }}>
            <span className="section-label">Tickers on watchlist</span>
          </div>
          <div style={{ padding: '4px 14px 14px' }}>
            <WatchlistPanel
              portfolioId={portfolio.id}
              entries={entries}
              loading={listLoad}
              removing={removing}
              onRemove={handleRemove}
              onBuy={(ticker, name) => {
                setTxModal({ ticker, name })
                setTxQty(''); setTxPrice(''); setTxFees(''); setTxNotes('')
                setTxDate(new Date().toISOString().split('T')[0])
                setTxError('')
              }}
            />
          </div>
        </div>

        {/* Right: Selection panel */}
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
          <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)' }}>
            <span className="section-label">Add to watchlist</span>
          </div>
          <div style={{ padding: '14px' }}>
            <SelectionPanel
              universe={portfolio.universe ?? []}
              themes={themes}
              watchedTickers={watchedTickers}
              onAdd={handleAdd}
              adding={adding}
            />
          </div>
        </div>

      </div>
    </div>
  )
}
