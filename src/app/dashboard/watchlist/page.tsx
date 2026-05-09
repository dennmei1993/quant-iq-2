'use client'
// src/app/dashboard/watchlist/page.tsx
// Standalone watchlist page — per-portfolio, with all three add modes.

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import PortfolioWatchlistNew from '@/components/dashboard/PortfolioWatchlistNew'

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

export default function WatchlistPage() {
  const supabase = createClient()

  const [portfolios,   setPortfolios]   = useState<Portfolio[]>([])
  const [activeId,     setActiveId]     = useState<string>('')
  const [themes,       setThemes]       = useState<Theme[]>([])
  const [loading,      setLoading]      = useState(true)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

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
      setPortfolios(ports)

      // Restore last selected portfolio
      const saved = sessionStorage.getItem('quant_iq_selected_portfolio')
      setActiveId(saved && ports.find(p => p.id === saved) ? saved : ports[0]?.id ?? '')

      setThemes(themeRes.data ?? [])
      setLoading(false)
    }
    load()
  }, [])

  function selectPortfolio(id: string) {
    setActiveId(id)
    sessionStorage.setItem('quant_iq_selected_portfolio', id)
  }

  const activePortfolio = portfolios.find(p => p.id === activeId)

  if (loading) {
    return (
      <div style={{ color: 'var(--text-4)', fontSize: 'var(--fs-sm)', padding: '2rem 0' }}>
        Loading…
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)', maxWidth: 800 }}>

      {/* Page header */}
      <div className="page-header">
        <div className="page-title">Watchlist</div>
      </div>

      {/* Portfolio tabs */}
      {portfolios.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, borderBottom: '1px solid var(--border)' }}>
          {portfolios.map(p => (
            <button
              key={p.id}
              onClick={() => selectPortfolio(p.id)}
              style={{
                padding:      '6px 14px',
                background:   'transparent',
                border:       'none',
                borderBottom: `2px solid ${p.id === activeId ? 'var(--accent)' : 'transparent'}`,
                color:        p.id === activeId ? 'var(--text)' : 'var(--text-4)',
                fontSize:     'var(--fs-sm)',
                fontWeight:   p.id === activeId ? 500 : 400,
                cursor:       'pointer',
                marginBottom: -1,
                transition:   'all 0.1s',
                fontFamily:   'inherit',
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {/* Watchlist component — full width on this page */}
      {activeId ? (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="section-label">
              {activePortfolio?.name ?? 'Portfolio'} watchlist
            </span>
          </div>
          <div style={{ padding: '14px 16px' }}>
            <PortfolioWatchlistNew
              portfolioId={activeId}
              universe={activePortfolio?.universe ?? []}
              themes={themes}
            />
          </div>
        </div>
      ) : (
        <div style={{ color: 'var(--text-4)', fontSize: 'var(--fs-sm)' }}>
          No portfolios found. Create one first.
        </div>
      )}
    </div>
  )
}
