// src/app/dashboard/themes/page.tsx
// Server component — fetches themes, ticker weights, regime, and signals in parallel

import { createServiceClient } from '@/lib/supabase/server'
import ThemesClient from './ThemesClient'

export const dynamic   = 'force-dynamic'
export const revalidate = 0

// ── Types ─────────────────────────────────────────────────────────────────────

export type TickerWeight = {
  ticker:       string
  final_weight: number        // ThemeTickerManager expects non-nullable
  relevance:    number
  rationale:    string | null
  asset_type:   string | null
}

export type Theme = {
  id:             string
  name:           string
  label:          string | null
  timeframe:      string
  conviction:     number | null
  momentum:       string | null
  brief:          string | null
  anchor_reason:  string | null
  anchored_since: string | null
  expires_at:     string | null
  theme_type:     string
  ticker_weights: TickerWeight[]
}

export type Regime = {
  label:            string
  risk_bias:        string
  confidence:       number
  favoured_sectors: string[] | null
  avoid_sectors:    string[] | null
  style_bias:       string | null
}

export type SignalMap = Record<string, {
  signal:    string | null
  score:     number | null
  price_usd: number | null
  change_pct: number | null
}>

async function q<T>(query: any): Promise<T | null> {
  const result = await query
  return (result as any).data as T | null
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ThemesPage() {
  const db = createServiceClient()

  const [allThemes, regimeRows] = await Promise.all([
    q<Omit<Theme, 'ticker_weights'>[]>(
      db.from('themes')
        .select('id, name, label, timeframe, conviction, momentum, brief, anchor_reason, anchored_since, expires_at, theme_type')
        .eq('is_active', true)
        .order('conviction', { ascending: false })
    ),
    q<Regime[]>(
      (db as any).from('market_regime')
        .select('label, risk_bias, confidence, favoured_sectors, avoid_sectors, style_bias')
        .order('refreshed_at', { ascending: false })
        .limit(1)
    ),
  ])

  const themes = allThemes ?? []

  // Fetch ticker weights for all themes
  const themeIds   = themes.map(t => t.id)
  const tickerRows = themeIds.length > 0
    ? await q<(TickerWeight & { theme_id: string })[]>(
        db.from('theme_tickers')
          .select('theme_id, ticker, final_weight, relevance, rationale, assets!inner(asset_type)')
          .in('theme_id', themeIds)
          .order('final_weight', { ascending: false })
      ) ?? []
    : []

  // Build ticker map per theme
  const weightsByTheme = new Map<string, TickerWeight[]>()
  for (const row of tickerRows) {
    const { theme_id, assets, ...rest } = row as any
    const entry: TickerWeight = {
      ...rest,
      final_weight: rest.final_weight ?? 0,
      relevance:    rest.relevance    ?? 0,
      asset_type:   (assets as any)?.asset_type ?? null,
    }
    if (!weightsByTheme.has(theme_id)) weightsByTheme.set(theme_id, [])
    weightsByTheme.get(theme_id)!.push(entry)
  }

  // Fetch signals for all tickers across all themes
  const allTickers = [...new Set(tickerRows.map(r => r.ticker))]
  const signalRows = allTickers.length > 0
    ? await q<{ ticker: string; signal: string | null; score: number | null; price_usd: number | null; change_pct: number | null }[]>(
        db.from('asset_signals')
          .select('ticker, signal, score, price_usd, change_pct')
          .in('ticker', allTickers)
      ) ?? []
    : []

  const signalMap: SignalMap = Object.fromEntries(
    signalRows.map(s => [s.ticker, { signal: s.signal, score: s.score, price_usd: s.price_usd, change_pct: s.change_pct }])
  )

  const hydratedThemes: Theme[] = themes.map(t => ({
    ...t,
    ticker_weights: weightsByTheme.get(t.id) ?? [],
  }))

  const regime = regimeRows?.[0] ?? null

  return (
    <ThemesClient
      themes={hydratedThemes}
      regime={regime}
      signalMap={signalMap}
    />
  )
}
