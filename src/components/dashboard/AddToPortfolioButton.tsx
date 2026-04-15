'use client'
// src/components/dashboard/AddToPortfolioButton.tsx
// Watchlist row button — opens a dropdown to pick which portfolio to add the ticker to

import { useState, useRef, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'

interface Portfolio {
  id:   string
  name: string
}

interface Props {
  ticker:     string
  assetName?: string
}

export default function AddToPortfolioButton({ ticker, assetName }: Props) {
  const [open,       setOpen]       = useState(false)
  const [portfolios, setPortfolios] = useState<Portfolio[]>([])
  const [loading,    setLoading]    = useState(false)
  const [adding,     setAdding]     = useState<string | null>(null)  // portfolio id being added
  const [added,      setAdded]      = useState<Set<string>>(new Set()) // portfolios already containing ticker
  const [error,      setError]      = useState<string | null>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  async function handleOpen() {
    if (open) { setOpen(false); return }
    setLoading(true)
    setError(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setError('Not logged in'); setLoading(false); return }

      // Fetch user's portfolios
      const { data: ports, error: portErr } = await supabase
        .from('portfolios')
        .select('id, name')
        .eq('user_id', user.id)
        .order('created_at')

      if (portErr) throw portErr

      // Check which portfolios already have this ticker
      const portIds = (ports ?? []).map(p => p.id)
      const { data: existing } = portIds.length > 0
        ? await supabase
            .from('holdings')
            .select('portfolio_id')
            .eq('ticker', ticker)
            .in('portfolio_id', portIds)
        : { data: [] }

      setAdded(new Set((existing ?? []).map(h => h.portfolio_id)))
      setPortfolios(ports ?? [])
      setOpen(true)
    } catch (e: any) {
      setError(e.message ?? 'Failed to load portfolios')
    } finally {
      setLoading(false)
    }
  }

  async function handleAdd(portfolioId: string, portfolioName: string) {
    setAdding(portfolioId)
    setError(null)
    try {
      const { error: insertErr } = await supabase
        .from('holdings')
        .insert({
          portfolio_id: portfolioId,
          ticker,
          name:         assetName ?? ticker,
          asset_type:   'stock',
          quantity:     null,
          avg_cost:     null,
        })

      if (insertErr) throw insertErr

      setAdded(prev => new Set([...prev, portfolioId]))
    } catch (e: any) {
      setError(e.message ?? 'Failed to add to portfolio')
    } finally {
      setAdding(null)
    }
  }

  const btnStyle: React.CSSProperties = {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    width:          28,
    height:         28,
    background:     'none',
    border:         '1px solid rgba(200,169,110,0.25)',
    borderRadius:   4,
    cursor:         'pointer',
    color:          'rgba(200,169,110,0.6)',
    fontSize:       '0.9rem',
    lineHeight:     1,
    transition:     'all 0.12s',
    padding:        0,
    flexShrink:     0,
  }

  return (
    <div ref={dropRef} style={{ position: 'relative' }}>
      <button
        onClick={handleOpen}
        style={btnStyle}
        title={`Add ${ticker} to portfolio`}
        onMouseEnter={e => {
          const t = e.currentTarget
          t.style.borderColor = 'rgba(200,169,110,0.6)'
          t.style.color = 'rgba(200,169,110,0.9)'
          t.style.background = 'rgba(200,169,110,0.06)'
        }}
        onMouseLeave={e => {
          const t = e.currentTarget
          t.style.borderColor = 'rgba(200,169,110,0.25)'
          t.style.color = 'rgba(200,169,110,0.6)'
          t.style.background = 'none'
        }}
      >
        {loading ? '…' : '+'}
      </button>

      {open && (
        <div style={{
          position:        'absolute',
          right:           0,
          top:             'calc(100% + 4px)',
          zIndex:          100,
          background:      'var(--navy2, #0d1829)',
          border:          '1px solid var(--dash-border, rgba(255,255,255,0.08))',
          borderRadius:    6,
          minWidth:        200,
          boxShadow:       '0 8px 24px rgba(0,0,0,0.4)',
          overflow:        'hidden',
        }}>
          {/* Header */}
          <div style={{
            padding:      '8px 12px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            fontSize:     '0.6rem',
            color:        'rgba(232,226,217,0.45)',
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            fontFamily:   'var(--font-mono)',
          }}>
            Add {ticker} to portfolio
          </div>

          {portfolios.length === 0 ? (
            <div style={{ padding: '14px 12px', fontSize: '0.75rem', color: 'rgba(232,226,217,0.4)', textAlign: 'center' }}>
              No portfolios yet.{' '}
              <a href="/dashboard/portfolio" style={{ color: 'var(--gold)', opacity: 0.7, textDecoration: 'none' }}>
                Create one ↗
              </a>
            </div>
          ) : (
            portfolios.map(p => {
              const isAdded   = added.has(p.id)
              const isAdding  = adding === p.id
              return (
                <button
                  key={p.id}
                  onClick={() => !isAdded && handleAdd(p.id, p.name)}
                  disabled={isAdded || isAdding}
                  style={{
                    display:        'flex',
                    alignItems:     'center',
                    justifyContent: 'space-between',
                    width:          '100%',
                    padding:        '9px 12px',
                    background:     'none',
                    border:         'none',
                    borderBottom:   '1px solid rgba(255,255,255,0.04)',
                    cursor:         isAdded ? 'default' : 'pointer',
                    textAlign:      'left',
                    transition:     'background 0.1s',
                  }}
                  onMouseEnter={e => {
                    if (!isAdded) e.currentTarget.style.background = 'rgba(200,169,110,0.05)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'none'
                  }}
                >
                  <span style={{
                    fontSize:   '0.78rem',
                    color:      isAdded ? 'rgba(232,226,217,0.35)' : 'rgba(232,226,217,0.82)',
                    fontFamily: 'var(--font-sans)',
                  }}>
                    {p.name}
                  </span>
                  <span style={{
                    fontSize:   '0.62rem',
                    fontFamily: 'var(--font-mono)',
                    color:      isAdded ? 'var(--signal-bull, #4eca99)' : 'rgba(232,226,217,0.3)',
                    marginLeft: 8,
                    flexShrink: 0,
                  }}>
                    {isAdding ? '…' : isAdded ? '✓ added' : '+ add'}
                  </span>
                </button>
              )
            })
          )}

          {error && (
            <div style={{ padding: '8px 12px', fontSize: '0.7rem', color: 'var(--signal-bear, #e87070)' }}>
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
