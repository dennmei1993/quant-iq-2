// src/app/dashboard/page.tsx — Home / Overview
// Server component: fetches regime, macro, themes, events, portfolio in parallel
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import HomeClient from './HomeClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// ── Types ─────────────────────────────────────────────────────────────────────

export type Regime = {
  id:          string
  label:       string           // e.g. "Risk-off · Defensive"
  bias:        string           // 'bullish' | 'bearish' | 'neutral'
  conviction:  number           // 0–100
  description: string | null
  updated_at:  string
}

export type MacroSnapshot = {
  avg_sentiment:   number | null
  signals_today:   number
  high_impact:     number
  active_themes:   number
  buy_signals:     number
  avoid_signals:   number
}

export type HomeTheme = {
  id:         string
  name:       string
  timeframe:  string
  conviction: number | null
  momentum:   string | null
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
  total_value:   number | null
  total_pnl:     number | null
  total_pnl_pct: number | null
  holdings_count: number
  risk_score:    number | null   // 0-100, derived from macro exposure
}

export type PortfolioAlert = {
  id:         string
  title:      string
  body:       string | null
  created_at: string
  alert_type: string
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

  // Fetch everything in parallel — no waterfalls
  const [
    regimeRows,
    themes,
    events,
    portfolioHoldings,
    alerts,
    signals,
  ] = await Promise.all([

    // Market regime — most recent active record
    q<Regime[]>(
      db.from('market_regimes')
        .select('id, label, bias, conviction, description, updated_at')
        .eq('is_active', true)
        .order('updated_at', { ascending: false })
        .limit(1)
    ),

    // Top themes by conviction, 1m first
    q<HomeTheme[]>(
      db.from('themes')
        .select('id, name, timeframe, conviction, momentum')
        .eq('is_active', true)
        .order('conviction', { ascending: false })
        .limit(5)
    ),

    // Top events by impact, last 24h
    q<HomeEvent[]>(
      db.from('events')
        .select('id, headline, sentiment_score, impact_score, event_type, published_at')
        .eq('ai_processed', true)
        .gte('published_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('impact_score', { ascending: false })
        .limit(4)
    ),

    // Portfolio holdings for this user
    q<{ id: string; ticker: string; quantity: number | null; cost_basis: number | null }[]>(
      db.from('user_portfolio')
        .select('id, ticker, quantity, cost_basis')
        .eq('user_id', userId)
    ),

    // Most recent unread alerts
    q<PortfolioAlert[]>(
      db.from('alerts')
        .select('id, title, body, created_at, alert_type')
        .eq('user_id', userId)
        .eq('is_read', false)
        .order('created_at', { ascending: false })
        .limit(1)
    ),

    // Asset signals for portfolio tickers (fetched after holdings, or empty)
    // We fetch all signals and filter client-side to avoid a dependent query
    q<{ ticker: string; signal: string | null; score: number | null; price_usd: number | null; change_pct: number | null }[]>(
      db.from('asset_signals')
        .select('ticker, signal, score, price_usd, change_pct')
        .order('score', { ascending: false })
        .limit(100)
    ),
  ])

  // ── Derive macro snapshot from events + themes ────────────────────────────

  const recentEvents = events ?? []
  const avgSentiment = recentEvents.length
    ? recentEvents.reduce((s, e) => s + (e.sentiment_score ?? 0), 0) / recentEvents.length
    : null

  const allSignals = signals ?? []
  const macro: MacroSnapshot = {
    avg_sentiment:  avgSentiment !== null ? Math.round(avgSentiment * 100) / 100 : null,
    signals_today:  recentEvents.length,
    high_impact:    recentEvents.filter(e => (e.impact_score ?? 0) >= 7).length,
    active_themes:  (themes ?? []).length,
    buy_signals:    allSignals.filter(s => s.signal === 'buy').length,
    avoid_signals:  allSignals.filter(s => s.signal === 'avoid').length,
  }

  // ── Derive portfolio summary ──────────────────────────────────────────────

  const holdings = portfolioHoldings ?? []
  const signalMap = new Map(allSignals.map(s => [s.ticker, s]))

  let totalValue = 0
  let totalCost  = 0
  let hasValue   = false

  for (const h of holdings) {
    const sig = signalMap.get(h.ticker)
    if (sig?.price_usd && h.quantity) {
      totalValue += sig.price_usd * h.quantity
      hasValue = true
    }
    if (h.cost_basis && h.quantity) {
      totalCost += h.cost_basis * h.quantity
    }
  }

  const totalPnl    = hasValue && totalCost > 0 ? totalValue - totalCost : null
  const totalPnlPct = hasValue && totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : null

  const portfolio: PortfolioSummary = {
    total_value:    hasValue ? Math.round(totalValue * 100) / 100 : null,
    total_pnl:      totalPnl !== null ? Math.round(totalPnl * 100) / 100 : null,
    total_pnl_pct:  totalPnlPct !== null ? Math.round(totalPnlPct * 10) / 10 : null,
    holdings_count: holdings.length,
    risk_score:     null, // TODO: compute from macro exposure cross-reference
  }

  // ── Suggested actions (derived, not from DB) ──────────────────────────────

  const topThemes  = (themes ?? []).slice(0, 3)
  const regime     = regimeRows?.[0] ?? null
  const latestAlert = (alerts ?? [])[0] ?? null

  return (
    <HomeClient
      regime={regime}
      macro={macro}
      themes={topThemes}
      events={recentEvents.slice(0, 3)}
      portfolio={portfolio}
      latestAlert={latestAlert}
      hasHoldings={holdings.length > 0}
    />
  )
}
