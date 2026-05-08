'use client'

import React from 'react'
import { useAccess } from '@/hooks/useAccess'
import { UPGRADE_PROMPTS, type Feature } from '@/lib/access-control'

// ─────────────────────────────────────────────
// FeatureGate
//
// Wraps any content that should be gated.
// Shows children if user has access, otherwise
// renders `fallback` (or a default upgrade nudge).
//
// Usage:
//   <FeatureGate feature="portfolio">
//     <PortfolioPage />
//   </FeatureGate>
//
//   <FeatureGate feature="live_feed" fallback={<LockedBanner />}>
//     <LiveFeed />
//   </FeatureGate>
// ─────────────────────────────────────────────
interface FeatureGateProps {
  feature: Feature
  children: React.ReactNode
  fallback?: React.ReactNode
  /** Show nothing (not even the upgrade nudge) when access is denied */
  silent?: boolean
}

export function FeatureGate({
  feature,
  children,
  fallback,
  silent = false,
}: FeatureGateProps) {
  const { can, loading } = useAccess()

  if (loading) return null
  if (can(feature)) return <>{children}</>
  if (silent) return null
  if (fallback) return <>{fallback}</>
  return <UpgradeNudge feature={feature} />
}

// ─────────────────────────────────────────────
// ProGate
//
// Shorthand for any pro-only content block.
// ─────────────────────────────────────────────
interface ProGateProps {
  children: React.ReactNode
  fallback?: React.ReactNode
}

export function ProGate({ children, fallback }: ProGateProps) {
  const { isPro, loading } = useAccess()

  if (loading) return null
  if (isPro) return <>{children}</>
  if (fallback) return <>{fallback}</>
  return null
}

// ─────────────────────────────────────────────
// AdminGate
// ─────────────────────────────────────────────
export function AdminGate({ children }: { children: React.ReactNode }) {
  const { isAdmin, loading } = useAccess()
  if (loading || !isAdmin) return null
  return <>{children}</>
}

// ─────────────────────────────────────────────
// UpgradeNudge
//
// Stub UI shown when access is denied.
// Replace with your real upgrade modal/page later.
// ─────────────────────────────────────────────
interface UpgradeNudgeProps {
  feature?: Feature
  message?: string
}

export function UpgradeNudge({ feature, message }: UpgradeNudgeProps) {
  const copy = message
    ?? (feature ? UPGRADE_PROMPTS[feature] : undefined)
    ?? 'This feature is available on the Pro plan.'

  // TODO: wire up to your upgrade flow / payment page
  return (
    <div className="upgrade-nudge">
      <span className="upgrade-nudge__icon">🔒</span>
      <p className="upgrade-nudge__text">{copy}</p>
      <button
        className="upgrade-nudge__button"
        onClick={() => {
          // TODO: open upgrade modal or navigate to /upgrade
          console.log('Upgrade flow not yet implemented')
        }}
      >
        Upgrade to Pro
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────
// withAccess — Higher-Order Component
//
// Wraps a page component with access control.
// Redirects to `redirectTo` if access is denied.
//
// Usage:
//   export default withAccess(PortfolioPage, 'portfolio')
//   export default withAccess(LiveFeedPage, 'live_feed', '/upgrade')
// ─────────────────────────────────────────────
export function withAccess<P extends object>(
  Component: React.ComponentType<P>,
  feature: Feature,
  redirectTo: string = '/upgrade'
) {
  return function AccessControlled(props: P) {
    const { can, loading } = useAccess()

    if (loading) {
      // TODO: replace with your app's loading skeleton
      return null
    }

    if (!can(feature)) {
      if (typeof window !== 'undefined') {
        window.location.replace(redirectTo)
      }
      return null
    }

    return <Component {...props} />
  }
}
