'use client'
// src/components/dashboard/DashboardShell.tsx
// Desktop: sticky left sidebar
// Mobile : fixed bottom tab bar + "More" slide-up sheet
// NOTE: Mobile styles are inlined via <style> tag to bypass CSS module caching issues
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import styles from './DashboardShell.module.css'

interface Props {
  user: { email: string; fullName: string; plan: string }
  children: React.ReactNode
}

const NAV = [
  { href: '/dashboard',           label: 'Overview',  icon: '⬡', section: 'Core',     separator: false },
  { href: '/dashboard/events',    label: 'Events',    icon: '↯', section: null,        separator: false },
  { href: '/dashboard/themes',    label: 'Themes',    icon: '◈', section: 'Advisory',  separator: false },
  { href: '/dashboard/assets',    label: 'Screener',  icon: '▤', section: null,        separator: false },
  { href: '/dashboard/watchlist', label: 'Watchlist', icon: '★', section: null,        separator: true  },
  { href: '/dashboard/portfolio', label: 'Portfolio', icon: '▦', section: 'Account',   separator: false },
  { href: '/dashboard/alerts',    label: 'Alerts',    icon: '◉', section: null,        separator: false },
  { href: '/dashboard/profile',   label: 'Profile',   icon: '◎', section: null,        separator: false },
]

const PRIMARY_TABS = [
  { href: '/dashboard',           label: 'Home',     icon: '⬡' },
  { href: '/dashboard/events',    label: 'Events',   icon: '↯' },
  { href: '/dashboard/themes',    label: 'Themes',   icon: '◈' },
  { href: '/dashboard/assets',    label: 'Screener', icon: '▤' },
]

const MOBILE_CSS = `
  @media (max-width: 768px) {
    #qiq-sidebar   { display: none !important; }
    #qiq-shell     { grid-template-columns: 1fr !important; }
    #qiq-content   { padding: 1rem 1rem calc(60px + env(safe-area-inset-bottom)) !important; }
    #qiq-topbar    { padding: 0 1rem !important; height: 48px !important; }
    #qiq-toptime   { display: none !important; }
    #qiq-livebadge { display: none !important; }
    #qiq-bottomnav {
      display: flex !important;
      position: fixed;
      bottom: 0; left: 0; right: 0;
      z-index: 9999;
      background: rgba(2,3,10,0.97);
      border-top: 1px solid #1a2030;
      padding-bottom: env(safe-area-inset-bottom);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
    }
    .qiq-tab {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      padding: 8px 4px;
      min-height: 56px;
      text-decoration: none;
      color: #2a3a50;
      background: none;
      border: none;
      cursor: pointer;
      position: relative;
      font-family: 'DM Sans', sans-serif;
      -webkit-tap-highlight-color: transparent;
    }
    .qiq-tab-active {
      color: #4eff91 !important;
    }
    .qiq-tab-active::before {
      content: '';
      position: absolute;
      top: 0; left: 20%; right: 20%;
      height: 2px;
      background: #4eff91;
    }
    .qiq-tab-icon  { font-size: 1.2rem; line-height: 1; display: block; }
    .qiq-tab-label { font-size: 0.58rem; line-height: 1; display: block; }
    .qiq-alert-dot {
      position: absolute;
      top: 7px; right: calc(50% - 16px);
      width: 6px; height: 6px;
      border-radius: 50%;
      background: #ff4e6a;
      border: 1.5px solid #02030a;
    }
    #qiq-moreoverlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.65);
      z-index: 10000;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.22s ease;
    }
    #qiq-moreoverlay.open { opacity: 1; pointer-events: auto; }
    #qiq-moresheet {
      position: fixed;
      bottom: 0; left: 0; right: 0;
      z-index: 10001;
      background: #02030a;
      border-top: 1px solid #1a2030;
      border-radius: 12px 12px 0 0;
      padding-bottom: env(safe-area-inset-bottom);
      transform: translateY(100%);
      transition: transform 0.28s cubic-bezier(0.32,0.72,0,1);
      max-height: 80vh;
      overflow-y: auto;
    }
    #qiq-moresheet.open { transform: translateY(0); }
    .qiq-sheet-handle {
      width: 36px; height: 3px;
      background: #2a3a50;
      border-radius: 2px;
      margin: 10px auto 0;
    }
    .qiq-sheet-header {
      display: flex;
      align-items: center;
      padding: 1rem 1.2rem 0.6rem;
      border-bottom: 1px solid #1a2030;
      font-family: 'DM Mono', monospace;
      font-size: 0.62rem;
      color: #2a3a50;
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }
    .qiq-sheet-user {
      display: flex;
      align-items: center;
      gap: 0.8rem;
      padding: 0.9rem 1.2rem;
      border-bottom: 1px solid #1a2030;
    }
    .qiq-sheet-item {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.9rem 1.2rem;
      color: #8a9aaa;
      text-decoration: none;
      font-size: 0.9rem;
      font-weight: 300;
      border-bottom: 1px solid rgba(26,32,48,0.6);
      font-family: 'DM Sans', sans-serif;
      -webkit-tap-highlight-color: transparent;
    }
    .qiq-sheet-item-active { color: #4eff91 !important; }
    .qiq-sheet-icon { font-size: 1.1rem; width: 24px; text-align: center; opacity: 0.6; }
    .qiq-sheet-signout {
      display: block;
      width: 100%;
      text-align: left;
      padding: 0.9rem 1.2rem;
      background: none;
      border: none;
      border-top: 1px solid #1a2030;
      color: #4a5568;
      font-size: 0.88rem;
      font-weight: 300;
      font-family: 'DM Sans', sans-serif;
      cursor: pointer;
    }
  }
`

export default function DashboardShell({ user, children }: Props) {
  const [moreOpen, setMoreOpen] = useState(false)
  const pathname = usePathname()
  const router   = useRouter()
  const supabase = createClient()

  const initials = (user.fullName || user.email)
    .split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  const isMoreActive = !PRIMARY_TABS.some(t => t.href === pathname)

  const pageLabel = NAV.find(n => n.href === pathname)?.label ?? 'Dashboard'

  return (
    <>
      {/* Inject mobile styles — guaranteed to be in the DOM */}
      <style dangerouslySetInnerHTML={{ __html: MOBILE_CSS }} />

      <div id="qiq-shell" className={styles.shell}>

        {/* ── DESKTOP SIDEBAR ── */}
        <aside id="qiq-sidebar" className={styles.sidebar}>
          <div className={styles.sidebarLogo}>
            <span className={styles.logoDot} />
            Quant IQ
          </div>

          <nav className={styles.nav}>
            {NAV.map((item) => (
              <div key={item.href}>
                {item.separator && (
                  <div style={{ height: 1, background: 'var(--border-default)', margin: '0.35rem 1.2rem' }} />
                )}
                {item.section && (
                  <div className={styles.navSection}>// {item.section}</div>
                )}
                <Link
                  href={item.href}
                  className={`${styles.navItem} ${pathname === item.href ? styles.active : ''}`}
                >
                  <span className={styles.navIcon}>{item.icon}</span>
                  {item.label}
                  {item.label === 'Alerts' && (
                    <span className={styles.alertBadge}>3</span>
                  )}
                </Link>
              </div>
            ))}
          </nav>

          <div className={styles.sidebarBottom}>
            <div className={styles.userInfo}>
              <div className={styles.avatar}>{initials}</div>
              <div>
                <div className={styles.userName}>{user.fullName || user.email.split('@')[0]}</div>
                <div className={styles.userPlan}>{user.plan.toUpperCase()}</div>
              </div>
            </div>
            <button onClick={handleSignOut} className={styles.signOutBtn}>Sign out</button>
          </div>
        </aside>

        {/* ── MAIN CONTENT ── */}
        <div className={styles.main}>
          <header id="qiq-topbar" className={styles.topbar}>
            <h1 className={styles.pageTitle}>{pageLabel.toLowerCase().replace(/ /g, '_')}</h1>
            <div className={styles.topbarRight}>
              <span id="qiq-livebadge" className={styles.liveBadge}>
                <span className={styles.liveBadgeDot} />
                LIVE
              </span>
              <span id="qiq-toptime" className={styles.topbarTime}>
                {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            </div>
          </header>

          <main id="qiq-content" className={styles.content}>
            {children}
          </main>
        </div>

      </div>

      {/* ── MOBILE BOTTOM TAB BAR ── */}
      <nav id="qiq-bottomnav" style={{ display: 'none' }}>
        {PRIMARY_TABS.map(tab => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`qiq-tab ${pathname === tab.href ? 'qiq-tab-active' : ''}`}
          >
            <span className="qiq-tab-icon">{tab.icon}</span>
            <span className="qiq-tab-label">{tab.label}</span>
          </Link>
        ))}
        <button
          className={`qiq-tab ${isMoreActive ? 'qiq-tab-active' : ''}`}
          onClick={() => setMoreOpen(true)}
        >
          <span className="qiq-tab-icon">☰</span>
          <span className="qiq-tab-label">More</span>
          <span className="qiq-alert-dot" />
        </button>
      </nav>

      {/* ── MOBILE MORE OVERLAY ── */}
      <div
        id="qiq-moreoverlay"
        className={moreOpen ? 'open' : ''}
        onClick={() => setMoreOpen(false)}
      />

      {/* ── MOBILE MORE SHEET ── */}
      <div id="qiq-moresheet" className={moreOpen ? 'open' : ''}>
        <div className="qiq-sheet-handle" />
        <div className="qiq-sheet-header">// navigation</div>

        <div className="qiq-sheet-user">
          <div className={styles.avatar}>{initials}</div>
          <div>
            <div className={styles.userName}>{user.fullName || user.email.split('@')[0]}</div>
            <div className={styles.userPlan}>{user.plan.toUpperCase()}</div>
          </div>
        </div>

        {NAV.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={`qiq-sheet-item ${pathname === item.href ? 'qiq-sheet-item-active' : ''}`}
            onClick={() => setMoreOpen(false)}
          >
            <span className="qiq-sheet-icon">{item.icon}</span>
            {item.label}
          </Link>
        ))}

        <button onClick={handleSignOut} className="qiq-sheet-signout">
          Sign out
        </button>
      </div>
    </>
  )
}
