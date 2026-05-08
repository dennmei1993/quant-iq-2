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
    <div ref={dropRef}>
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
        <>
          {/* Backdrop */}
          <div
            onClick={() => setOpen(false)}
            style={{
              position:   'fixed',
              inset:      0,
              zIndex:     200,
              background: 'rgba(0,0,0,0.55)',
            }}
          />

          {/* Modal */}
          <div style={{
            position:  'fixed',
            top:       '50%',
            left:      '50%',
            transform: 'translate(-50%, -50%)',
            zIndex:    201,
            background: 'var(--navy2, #0d1829)',
            border:    '1px solid var(--dash-border, rgba(255,255,255,0.1))',
            borderRadius: 8,
            width:     320,
            boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
            overflow:  'hidden',
          }}>

            {/* Modal header */}
            <div style={{
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'space-between',
              padding:        '12px 16px',
              borderBottom:   '1px solid rgba(255,255,255,0.07)',
            }}>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'rgba(232,226,217,0.45)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 3 }}>
                  Add to portfolio
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', fontWeight: 700, color: 'var(--gold)' }}>
                  {ticker}
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(232,226,217,0.4)', fontSize: '1.1rem', lineHeight: 1, padding: '2px 4px' }}
              >
                ×
              </button>
            </div>

            {/* Portfolio list */}
            <div style={{ maxHeight: 280, overflowY: 'auto' }}>
              {portfolios.length === 0 ? (
                <div style={{ padding: '24px 16px', fontSize: '0.78rem', color: 'rgba(232,226,217,0.45)', textAlign: 'center', lineHeight: 1.6 }}>
                  No portfolios yet.{' '}
                  <a href="/dashboard/portfolio" style={{ color: 'var(--gold)', opacity: 0.7, textDecoration: 'none' }}>
                    Create one ↗
                  </a>
                </div>
              ) : (
                portfolios.map(p => {
                  const isAdded  = added.has(p.id)
                  const isAdding = adding === p.id
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
                        padding:        '12px 16px',
                        background:     'none',
                        border:         'none',
                        borderBottom:   '1px solid rgba(255,255,255,0.05)',
                        cursor:         isAdded ? 'default' : 'pointer',
                        textAlign:      'left',
                        transition:     'background 0.1s',
                      }}
                      onMouseEnter={e => { if (!isAdded) e.currentTarget.style.background = 'rgba(200,169,110,0.05)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
                    >
                      <div>
                        <div style={{ fontSize: '0.82rem', color: isAdded ? 'rgba(232,226,217,0.40)' : 'rgba(232,226,217,0.88)', fontFamily: 'var(--font-sans)', marginBottom: 2 }}>
                          {p.name}
                        </div>
                      </div>
                      <span style={{
                        fontSize:    '0.65rem',
                        fontFamily:  'var(--font-mono)',
                        padding:     '2px 8px',
                        borderRadius: 3,
                        border:      '1px solid',
                        borderColor: isAdded ? 'rgba(78,202,153,0.3)' : 'rgba(200,169,110,0.3)',
                        color:       isAdded ? '#4eca99' : 'rgba(200,169,110,0.8)',
                        flexShrink:  0,
                        marginLeft:  12,
                      }}>
                        {isAdding ? '…' : isAdded ? '✓ added' : '+ add'}
                      </span>
                    </button>
                  )
                })
              )}
            </div>

            {error && (
              <div style={{ padding: '10px 16px', fontSize: '0.72rem', color: '#e87070', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                {error}
              </div>
            )}

            {/* Footer */}
            <div style={{ padding: '10px 16px', borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setOpen(false)}
                style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', padding: '5px 14px', background: 'none', border: '1px solid rgba(232,226,217,0.2)', borderRadius: 4, color: 'rgba(232,226,217,0.55)', cursor: 'pointer', letterSpacing: '0.06em' }}
              >
                Done
              </button>
            </div>

          </div>
        </>
      )}
    </div>
  )
}
