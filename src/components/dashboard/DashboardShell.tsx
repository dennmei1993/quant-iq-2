'use client'
// src/components/dashboard/DashboardShell.tsx
// Uses global CSS classes from globals.css (shell-* prefix).
// DashboardShell.module.css can be deleted — all styles merged into globals.css.

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface Portfolio {
  id:   string
  name: string
}

interface Props {
  user: { email: string; fullName: string; plan: string }
  children: React.ReactNode
}

const NAV = [
  { href: '/dashboard',           label: 'Overview',       icon: '⬡',  section: 'Overview',  },
  { href: '/dashboard/events',    label: 'Event Feed',     icon: '📡', section: null,        },
  { href: '/dashboard/themes',    label: 'Themes',         icon: '🎯', section: 'Advisory',  },
  { href: '/dashboard/assets',    label: 'Asset Screener', icon: '📊', section: null,        },
  { href: '/dashboard/portfolio', label: 'My Portfolio',   icon: '🗂️', section: 'Portfolio', },
  { href: '/dashboard/alerts',    label: 'Alerts',         icon: '🔔', section: null,        },
  { href: '/dashboard/options',   label: 'Options Wheel',  icon: '⚙️', section: 'Options',   },
  { href: '/dashboard/settings',  label: 'Settings',       icon: '⚙',  section: 'Account',   },
]

const PAGE_TITLE: Record<string, string> = Object.fromEntries(NAV.map(n => [n.href, n.label]))

export default function DashboardShell({ user, children }: Props) {
  const [mobileOpen,      setMobileOpen]      = useState(false)
  const [portfolios,      setPortfolios]      = useState<Portfolio[]>([])
  const [activePortfolio, setActivePortfolio] = useState<string>('')

  const pathname = usePathname()
  const router   = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const { data: { user: u } } = await supabase.auth.getUser()
      if (!u) return
      const { data } = await supabase
        .from('portfolios')
        .select('id, name')
        .eq('user_id', u.id)
        .order('created_at', { ascending: true })
      if (data?.length) {
        setPortfolios(data)
        const saved = sessionStorage.getItem('quant_iq_selected_portfolio')
        setActivePortfolio(saved && data.find((p: Portfolio) => p.id === saved) ? saved : data[0].id)
      }
    }
    load()
  }, [])

  function selectPortfolio(id: string) {
    setActivePortfolio(id)
    sessionStorage.setItem('quant_iq_selected_portfolio', id)
    window.dispatchEvent(new Event('portfolio-changed'))
    if (pathname !== '/dashboard') router.push('/dashboard')
    setMobileOpen(false)
  }

  const initials = (user.fullName || user.email)
    .split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  const pageTitle = PAGE_TITLE[pathname] ?? 'Dashboard'

  return (
    <div className="shell">
      <aside className={`shell-sidebar${mobileOpen ? ' open' : ''}`}>

        {/* Logo */}
        <div className="shell-logo">
          <span className="shell-logo-dot" />
          Quant IQ
        </div>

        <nav className="shell-nav">
          {NAV.map(item => {
            const isOverview = item.href === '/dashboard'
            const isActive   = pathname === item.href ||
              (item.href !== '/dashboard' && pathname.startsWith(item.href))

            return (
              <div key={item.href}>
                {item.section && (
                  <div className="shell-nav-section">{item.section}</div>
                )}

                {/* Overview — parent link + portfolio submenu */}
                {isOverview ? (
                  <>
                    <Link
                      href="/dashboard"
                      className={`shell-nav-item${pathname === '/dashboard' ? ' active' : ''}`}
                      onClick={() => setMobileOpen(false)}
                    >
                      <span className="shell-nav-icon">{item.icon}</span>
                      {item.label}
                    </Link>

                    {/* Portfolio submenu — always visible under Overview */}
                    <div className="shell-submenu">
                      {portfolios.map(p => (
                        <button
                          key={p.id}
                          className={`shell-submenu-item${p.id === activePortfolio ? ' active' : ''}`}
                          onClick={() => selectPortfolio(p.id)}
                        >
                          {p.id === activePortfolio && (
                            <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0, display: 'inline-block' }} />
                          )}
                          {p.name}
                        </button>
                      ))}
                      <button
                        className="shell-submenu-add"
                        onClick={() => { router.push('/dashboard/portfolio'); setMobileOpen(false) }}
                      >
                        <i className="ti ti-plus" style={{ fontSize: 11 }} aria-hidden /> New portfolio
                      </button>
                    </div>
                  </>
                ) : (
                  <Link
                    href={item.href}
                    className={`shell-nav-item${isActive ? ' active' : ''}`}
                    onClick={() => setMobileOpen(false)}
                  >
                    <span className="shell-nav-icon">{item.icon}</span>
                    {item.label}
                    {item.label === 'Alerts' && (
                      <span className="shell-alert-badge">3</span>
                    )}
                  </Link>
                )}
              </div>
            )
          })}
        </nav>

        {/* Bottom user section */}
        <div className="shell-bottom">
          <div className="shell-user-info">
            <div className="shell-avatar">{initials}</div>
            <div>
              <div className="shell-user-name">{user.fullName || user.email.split('@')[0]}</div>
              <div className="shell-user-plan">{user.plan.toUpperCase()} PLAN</div>
            </div>
          </div>
          <button onClick={handleSignOut} className="shell-signout">Sign out</button>
        </div>
      </aside>

      {/* Main area */}
      <div className="shell-main">
        <header className="shell-topbar">
          <button className="shell-menu-btn" onClick={() => setMobileOpen(!mobileOpen)} aria-label="Toggle menu">
            <span /><span /><span />
          </button>
          <h1 className="shell-page-title">{pageTitle}</h1>
          <div className="shell-topbar-right">
            <span className="shell-live-badge">⚡ Live</span>
            <span className="shell-topbar-time">
              {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          </div>
        </header>

        <main className="shell-content">
          {children}
        </main>
      </div>

      {mobileOpen && (
        <div className="shell-overlay" onClick={() => setMobileOpen(false)} />
      )}
    </div>
  )
}
