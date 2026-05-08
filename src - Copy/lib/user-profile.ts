// src/lib/user-profile.ts
// Fetch user profile and apply filters to queries
// If no profile exists (qa_completed = false), no filters are applied

import { createServiceClient } from '@/lib/supabase/server'

export interface UserProfile {
  risk_score:     number | null
  horizon:        'short' | 'medium' | 'long' | null
  style:          string | null
  volatility_tol: 'low' | 'medium' | 'high' | null
  min_signal:     'buy' | 'watch' | 'hold' | null
  min_conviction: number | null
  sector_exclude: string[]
  asset_types:    string[]
  qa_completed:   boolean
}

// Null profile = no filters applied
export const NULL_PROFILE: UserProfile = {
  risk_score:     null,
  horizon:        null,
  style:          null,
  volatility_tol: null,
  min_signal:     null,
  min_conviction: null,
  sector_exclude: [],
  asset_types:    ['stock', 'etf', 'crypto', 'commodity'],
  qa_completed:   false,
}

export async function getUserProfile(userId: string): Promise<UserProfile> {
  if (!userId) return NULL_PROFILE

  const db = createServiceClient()
  const { data } = await (db as any)
    .from('user_profiles')
    .select('risk_score, horizon, style, volatility_tol, min_signal, min_conviction, sector_exclude, asset_types, qa_completed')
    .eq('user_id', userId)
    .maybeSingle()

  if (!data || !data.qa_completed) return NULL_PROFILE

  return {
    risk_score:     data.risk_score     ?? null,
    horizon:        (data.horizon        ?? null) as UserProfile['horizon'],
    style:          (data.style          ?? null) as UserProfile['style'],
    volatility_tol: (data.volatility_tol ?? null) as UserProfile['volatility_tol'],
    min_signal:     (data.min_signal     ?? null) as UserProfile['min_signal'],
    min_conviction: data.min_conviction  ?? null,
    sector_exclude: data.sector_exclude  ?? [],
    asset_types:    data.asset_types     ?? ['stock', 'etf'],
    qa_completed:   true,
  }
}

// ── Filter helpers ─────────────────────────────────────────────────────────────

const SIGNAL_ORDER = { buy: 0, watch: 1, hold: 2, avoid: 3 }

/** Returns true if the signal meets the user's minimum threshold */
export function signalMeetsThreshold(
  signal:     string | null,
  profile:    UserProfile
): boolean {
  if (!profile.qa_completed || !profile.min_signal) return true
  if (!signal) return false
  return SIGNAL_ORDER[signal as keyof typeof SIGNAL_ORDER] <=
         SIGNAL_ORDER[profile.min_signal]
}

/** Returns true if the theme conviction meets the user's minimum */
export function convictionMeetsThreshold(
  conviction: number | null,
  profile:    UserProfile
): boolean {
  if (!profile.qa_completed || !profile.min_conviction) return true
  return (conviction ?? 0) >= profile.min_conviction
}

/** Returns true if the sector is not excluded */
export function sectorAllowed(
  sector:  string | null,
  profile: UserProfile
): boolean {
  if (!profile.qa_completed || profile.sector_exclude.length === 0) return true
  if (!sector) return true
  return !profile.sector_exclude.includes(sector)
}

/** Returns theme timeframes the user should see based on horizon */
export function allowedTimeframes(profile: UserProfile): string[] {
  if (!profile.qa_completed || !profile.horizon) return ['1m', '3m', '6m']
  return {
    short:  ['1m'],
    medium: ['1m', '3m'],
    long:   ['3m', '6m'],
  }[profile.horizon]
}

/** Filter an array of tickers by user profile */
export function filterByProfile<T extends {
  signal?:     string | null
  sector?:     string | null
  conviction?: number | null
}>(items: T[], profile: UserProfile): T[] {
  if (!profile.qa_completed) return items
  return items.filter(item => {
    if (item.signal    !== undefined && !signalMeetsThreshold(item.signal, profile))        return false
    if (item.sector    !== undefined && !sectorAllowed(item.sector, profile))               return false
    if (item.conviction !== undefined && !convictionMeetsThreshold(item.conviction, profile)) return false
    return true
  })
}
