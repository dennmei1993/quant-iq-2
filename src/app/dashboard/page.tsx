// src/app/dashboard/page.tsx — Home / Overview
// Server component: fetches regime, macro, themes, events, portfolios in parallel.
// Holdings are fetched client-side by HomeClient via /api/portfolio.

import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import HomeClient from './HomeClient'

export const dynamic   = 'force-dynamic'
export const revalidate = 0

// ── Types ─────────────────────────────────────────────────────────────────────

export type Regime = {
  id:               string
  label:            string
  risk_bias:        string
  style_bias:       string | null
  confidence:       number
  rationale:        string | null
  favoured_sectors: string[] | null
  avoid_sectors:    string[] | null
  cycle_phase:      string | null
  cash_bias:        string | null
  refreshed_at:     string
}

export type MacroSnapshot = {
  avg_sentiment: number | null
  signals_today: number
  high_impact:   number
  active_themes: number
  buy_signals:   number
  avoid_signals: number
}

export type HomeTheme = {
  id:         string
  name:       string
  timeframe:  string
  conviction: number | null
  momentum:   string | null
  brief:      string | null
}

export type HomeEvent = {
  id:              string
  headline:        string
  sentiment_score: number | null
  impact_score:    number | null
  event_type:      string | null
  published_at:    string
}

export type PortfolioSummary = {
  total_value:    number | null
  total_pnl:      number | null
  total_pnl_pct:  number | null
  holdings_count: number
  risk_score:     number | null
}

export type PortfolioAlert = {
  id:         string
  title:      string
  body:       string | null
  created_at: string
  type:       string
}

export type Portfolio = {
  id:             string
  name:           string
  total_capital:  number
  cash_pct:       number
  universe:       string[]
  moomoo_account: string | null
}

// ── Auth helper ────────────────────────────────────────────────────────────────

async function getUserId(): Promise<string | null> {
  try {
    const cookieStore = await cookies()
    const authClient  = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get: (n: string) => cookieStore.get(n)?.value, set: () => {}, remove: () => {} } }
    )
    const { data: { user } } = await authClient.auth.getUser()
    return user?.id ?? null
  } catch {
    return null
  }
}

async function q<T>(query: any): Promise<T | null> {
  const result = await query
  return (result as any).data as T | null
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function DashboardHome() {
  const userId = await getUserId()
  if (!userId) redirect('/auth/login')

  const db = createServiceClient()

  const [
    regimeRows,
    themes,
    events,
    portfoliosData,
    alerts,
  ] = await Promise.all([

    // Market regime
    q<Regime[]>(
      (db as any).from('market_regime')
        .select('id, label, risk_bias, style_bias, confidence, rationale, favoured_sectors, avoid_sectors, cycle_phase, cash_bias, refreshed_at')
        .order('refreshed_at', { ascending: false })
        .limit(1)
    ),

    // Top themes by conviction
    q<HomeTheme[]>(
      db.from('themes')
        .select('id, name, timeframe, conviction, momentum, brief')
        .eq('is_active', true)
        .order('conviction', { ascending: false })
        .limit(5)
    ),

    // High-impact events in last 24h
    q<HomeEvent[]>(
      db.from('events')
        .select('id, headline, sentiment_score, impact_score, event_type, published_at')
        .eq('ai_processed', true)
        .gte('published_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('impact_score', { ascending: false })
        .limit(4)
    ),

    // All user portfolios — total_capital + cash_pct needed for client-side metrics
    q<Portfolio[]>(
      db.from('portfolios')
        .select('id, name, total_capital, cash_pct, universe, moomoo_account')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
    ),

    // Most recent unread alert
    q<PortfolioAlert[]>(
      db.from('alerts')
        .select('id, title, body, created_at, type')
        .eq('user_id', userId)
        .eq('is_read', false)
        .order('created_at', { ascending: false })
        .limit(1)
    ),
  ])

  const regime      = regimeRows?.[0] ?? null
  const latestAlert = (alerts ?? [])[0] ?? null
  const topThemes   = (themes ?? []).slice(0, 5)

  return (
    <HomeClient
      regime={regime}
      themes={topThemes}
      portfolios={portfoliosData ?? []}
      latestAlert={latestAlert}
    />
  )
}
