'use client'
// src/components/dashboard/DashboardShell.tsx
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
  { href: '/dashboard',           label: 'Overview',       icon: '⬡', section: 'Overview' },
  { href: '/dashboard/events',    label: 'Event Feed',     icon: '📡', section: null },
  { href: '/dashboard/themes',    label: 'Themes',         icon: '🎯', section: 'Advisory' },
  { href: '/dashboard/assets',    label: 'Asset Screener', icon: '📊', section: null },
  { href: '/dashboard/portfolio', label: 'My Portfolio',   icon: '🗂️', section: 'Portfolio' },
  { href: '/dashboard/alerts',    label: 'Alerts',         icon: '🔔', section: null },
]

export default function DashboardShell({ user, children }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  const initials = (user.fullName || user.email)
    .split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  const pageTitle = NAV.find(n => n.href === pathname)?.label ?? 'Dashboard'

  return (
    <div className={styles.shell}>
      {/* Sidebar */}
      <aside className={`${styles.sidebar} ${mobileOpen ? styles.open : ''}`}>
        <div className={styles.sidebarLogo}>
          <span className={styles.logoDot} />
          Quant IQ
        </div>

        <nav className={styles.nav}>
          {NAV.map((item, i) => (
            <div key={item.href}>
              {item.section && (
                <div className={styles.navSection}>{item.section}</div>
              )}
              <Link
                href={item.href}
                className={`${styles.navItem} ${pathname === item.href ? styles.active : ''}`}
                onClick={() => setMobileOpen(false)}
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
              <div className={styles.userPlan}>{user.plan.toUpperCase()} PLAN</div>
            </div>
          </div>
          <button onClick={handleSignOut} className={styles.signOutBtn}>Sign out</button>
        </div>
      </aside>

      {/* Main area */}
      <div className={styles.main}>
        <header className={styles.topbar}>
          <button className={styles.menuBtn} onClick={() => setMobileOpen(!mobileOpen)}>
            <span /><span /><span />
          </button>
          <h1 className={styles.pageTitle}>{pageTitle}</h1>
          <div className={styles.topbarRight}>
            <span className={styles.liveBadge}>⚡ Live</span>
            <span className={styles.topbarTime}>
              {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          </div>
        </header>

        <main className={styles.content}>
          {children}
        </main>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className={styles.overlay} onClick={() => setMobileOpen(false)} />
      )}
    </div>
  )
}
