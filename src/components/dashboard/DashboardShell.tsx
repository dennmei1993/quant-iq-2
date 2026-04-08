'use client'
// src/components/dashboard/DashboardShell.tsx
// Desktop: sticky left sidebar
// Mobile : fixed bottom tab bar + "More" slide-up sheet
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

// All nav items — used by both sidebar and More sheet
const NAV = [
  { href: '/dashboard',           label: 'Overview',  icon: '⬡', section: 'Core',     separator: false },
  { href: '/dashboard/events',    label: 'Events',    icon: '↯', section: null,       separator: false },
  { href: '/dashboard/themes',    label: 'Themes',    icon: '◈', section: 'Advisory', separator: false },
  { href: '/dashboard/assets',    label: 'Screener',  icon: '▤', section: null,       separator: false },
  { href: '/dashboard/watchlist', label: 'Watchlist', icon: '★', section: null,       separator: true  },
  { href: '/dashboard/portfolio', label: 'Portfolio', icon: '▦', section: 'Account',  separator: false },
  { href: '/dashboard/alerts',    label: 'Alerts',    icon: '◉', section: null,       separator: false },
  { href: '/dashboard/profile',   label: 'Profile',   icon: '◎', section: null,       separator: false },
]

// The 4 tabs shown in the bottom bar.
// Everything else appears in the "More" sheet.
const PRIMARY_TABS = [
  { href: '/dashboard',        label: 'Home',    icon: '⬡' },
  { href: '/dashboard/events', label: 'Events',  icon: '↯' },
  { href: '/dashboard/themes', label: 'Themes',  icon: '◈' },
  { href: '/dashboard/assets', label: 'Screener',icon: '▤' },
]

export default function DashboardShell({ user, children }: Props) {
  const [moreOpen, setMoreOpen] = useState(false)
  const pathname  = usePathname()
  const router    = useRouter()
  const supabase  = createClient()

  const initials = (user.fullName || user.email)
    .split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  function closeMore() { setMoreOpen(false) }

  const pageLabel = NAV.find(n => n.href === pathname)?.label ?? 'Dashboard'

  // Is the current page one of the primary tabs or in the More sheet?
  const isMoreActive = !PRIMARY_TABS.some(t => t.href === pathname)

  return (
    <div className={styles.shell}>

      {/* ────────────────────────────────────────
          DESKTOP SIDEBAR
      ──────────────────────────────────────── */}
      <aside className={styles.sidebar}>
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

      {/* ────────────────────────────────────────
          MAIN CONTENT
      ──────────────────────────────────────── */}
      <div className={styles.main}>
        <header className={styles.topbar}>
          <h1 className={styles.pageTitle}>{pageLabel.toLowerCase().replace(/ /g, '_')}</h1>
          <div className={styles.topbarRight}>
            <span className={styles.liveBadge}>
              <span className={styles.liveBadgeDot} />
              LIVE
            </span>
            <span className={styles.topbarTime}>
              {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          </div>
        </header>

        <main className={styles.content}>
          {children}
        </main>
      </div>

      {/* ────────────────────────────────────────
          MOBILE BOTTOM TAB BAR
          4 primary tabs + "More" button
      ──────────────────────────────────────── */}
      <nav className={styles.bottomNav}>

        {PRIMARY_TABS.map(tab => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`${styles.bottomTab} ${pathname === tab.href ? styles.bottomTabActive : ''}`}
          >
            <span className={styles.bottomTabIcon}>{tab.icon}</span>
            <span className={styles.bottomTabLabel}>{tab.label}</span>
          </Link>
        ))}

        {/* "More" button — opens slide-up sheet */}
        <button
          className={`${styles.bottomTab} ${isMoreActive ? styles.bottomTabActive : ''}`}
          onClick={() => setMoreOpen(true)}
          aria-label="More navigation"
        >
          <span className={styles.bottomTabIcon}>≡</span>
          <span className={styles.bottomTabLabel}>More</span>
          {/* Alert dot if alerts page is active */}
          <span className={styles.bottomTabAlertDot} />
        </button>
      </nav>

      {/* ────────────────────────────────────────
          MOBILE MORE SHEET
      ──────────────────────────────────────── */}
      {/* Dim overlay */}
      <div
        className={`${styles.moreOverlay} ${moreOpen ? styles.open : ''}`}
        onClick={closeMore}
      />

      {/* Sheet panel */}
      <div className={`${styles.moreSheet} ${moreOpen ? styles.open : ''}`}>
        <div className={styles.moreSheetHandle} />

        <div className={styles.moreSheetHeader}>
          <span className={styles.moreSheetTitle}>// navigation</span>
        </div>

        {/* User info */}
        <div className={styles.moreSheetUser}>
          <div className={styles.avatar}>{initials}</div>
          <div>
            <div className={styles.userName}>{user.fullName || user.email.split('@')[0]}</div>
            <div className={styles.userPlan}>{user.plan.toUpperCase()}</div>
          </div>
        </div>

        {/* All nav items (including ones not in primary tabs) */}
        {NAV.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={`${styles.moreSheetItem} ${pathname === item.href ? styles.moreSheetItemActive : ''}`}
            onClick={closeMore}
          >
            <span className={styles.moreSheetItemIcon}>{item.icon}</span>
            {item.label}
            {item.label === 'Alerts' && (
              <span className={styles.alertBadge} style={{ marginLeft: 'auto' }}>3</span>
            )}
          </Link>
        ))}

        <button onClick={handleSignOut} className={styles.moreSheetSignOut}>
          Sign out
        </button>
      </div>

    </div>
  )
}
// v2
