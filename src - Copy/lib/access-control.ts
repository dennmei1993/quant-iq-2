/**
 * ACCESS CONTROL CONFIG
 *
 * Single source of truth for feature gating.
 * Add/modify permissions here — no need to touch components.
 *
 * Tiers: 'free' | 'pro' | 'admin'
 * Admin inherits all pro permissions automatically.
 */

export type UserTier = 'free' | 'pro' | 'admin'

export type Feature =
  | 'news_feed'           // Daily news & signal updates
  | 'live_feed'           // Real-time live feed
  | 'portfolio'           // Portfolio management
  | 'event_details'       // Event detail pages
  | 'theme_details'       // Theme detail pages
  | 'ticker_details'      // Ticker/asset detail pages
  | 'ai_memos'            // AI advisory memos
  | 'alerts'              // Price/signal alerts
  | 'advanced_signals'    // Full signal data (free gets basic only)
  | 'admin_panel'         // Admin dashboard

/**
 * Which tiers can access each feature.
 * 'admin' always inherits 'pro' permissions — list only the minimum required tier.
 */
export const FEATURE_ACCESS: Record<Feature, UserTier[]> = {
  // Free + paid
  news_feed:        ['free', 'pro', 'admin'],

  // Pro only
  live_feed:        ['pro', 'admin'],
  portfolio:        ['pro', 'admin'],
  event_details:    ['pro', 'admin'],
  theme_details:    ['pro', 'admin'],
  ticker_details:   ['pro', 'admin'],
  ai_memos:         ['pro', 'admin'],
  alerts:           ['pro', 'admin'],
  advanced_signals: ['pro', 'admin'],

  // Admin only
  admin_panel:      ['admin'],
}

/**
 * Check whether a given tier can access a feature.
 */
export function canAccess(tier: UserTier | null | undefined, feature: Feature): boolean {
  if (!tier) return false
  return FEATURE_ACCESS[feature].includes(tier)
}

/**
 * Human-readable labels for each tier (used in upgrade prompts).
 */
export const TIER_LABELS: Record<UserTier, string> = {
  free:  'Free',
  pro:   'Pro',
  admin: 'Admin',
}

/**
 * Upgrade prompt copy per feature — customise as needed.
 */
export const UPGRADE_PROMPTS: Partial<Record<Feature, string>> = {
  live_feed:        'Live feed is available on the Pro plan.',
  portfolio:        'Portfolio management is available on the Pro plan.',
  event_details:    'Event details are available on the Pro plan.',
  theme_details:    'Theme details are available on the Pro plan.',
  ticker_details:   'Full ticker analysis is available on the Pro plan.',
  ai_memos:         'AI advisory memos are available on the Pro plan.',
  alerts:           'Price alerts are available on the Pro plan.',
  advanced_signals: 'Advanced signals are available on the Pro plan.',
}
