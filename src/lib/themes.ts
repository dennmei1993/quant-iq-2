// src/lib/themes.ts
// Shared data fetching for theme detail — used by:
//   - src/app/dashboard/themes/page.tsx (server component, all themes)
//   - src/app/api/themes/[id]/route.ts  (API route, single theme for inline panel)

import { createServiceClient } from '@/lib/supabase/server'

// ── Types ──────────────────────────────────────────────────────────────────────

export type TickerWeight = {
  ticker:       string
  final_weight: number
  relevance:    number
  rationale:    string | null
  asset_type:   string | null
}

export type ThemeSignal = {
  signal:     string | null
  score:      number | null
  price_usd:  number | null
  change_pct: number | null
}

export type SignalMap = Record<string, ThemeSignal>

export type ThemeWithTickers = {
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

// ── Helpers ────────────────────────────────────────────────────────────────────

async function q<T>(query: any): Promise<T | null> {
  const result = await query
  return (result as any).data as T | null
}

function coerceTicker(row: any, assets: any): TickerWeight {
  return {
    ticker:       row.ticker,
    final_weight: row.final_weight ?? 0,
    relevance:    row.relevance    ?? 0,
    rationale:    row.rationale    ?? null,
    asset_type:   assets?.asset_type ?? null,
  }
}

// ── Fetch single theme detail ──────────────────────────────────────────────────
// Used by the API route for the home page inline panel

export async function fetchThemeDetail(id: string): Promise<{
  theme:     ThemeWithTickers | null
  signalMap: SignalMap
}> {
  const db = createServiceClient()

  const [themeRes, tickerRes] = await Promise.all([
    db.from('themes')
      .select('id, name, label, timeframe, conviction, momentum, brief, anchor_reason, anchored_since, expires_at, theme_type')
      .eq('id', id)
      .single(),
    db.from('theme_tickers')
      .select('ticker, final_weight, relevance, rationale, assets!inner(asset_type)')
      .eq('theme_id', id)
      .order('final_weight', { ascending: false })
      .limit(10),
  ])

  if (themeRes.error || !themeRes.data) return { theme: null, signalMap: {} }

  const rawTickers = tickerRes.data ?? []
  const ticker_weights: TickerWeight[] = rawTickers.map((r: any) =>
    coerceTicker(r, r.assets)
  )

  // Fetch signals
  const symbols = ticker_weights.map(t => t.ticker)
  const signalRows = symbols.length > 0
    ? await q<{ ticker: string; signal: string | null; score: number | null; price_usd: number | null; change_pct: number | null }[]>(
        db.from('asset_signals')
          .select('ticker, signal, score, price_usd, change_pct')
          .in('ticker', symbols)
      ) ?? []
    : []

  const signalMap: SignalMap = Object.fromEntries(
    signalRows.map(s => [s.ticker, {
      signal:     s.signal,
      score:      s.score,
      price_usd:  s.price_usd,
      change_pct: s.change_pct,
    }])
  )

  return {
    theme: { ...themeRes.data, ticker_weights },
    signalMap,
  }
}

// ── Fetch all active themes ────────────────────────────────────────────────────
// Used by the themes page server component

export async function fetchAllThemes(): Promise<{
  themes:    ThemeWithTickers[]
  regime:    Regime | null
  signalMap: SignalMap
}> {
  const db = createServiceClient()

  const [allThemes, regimeRows] = await Promise.all([
    q<Omit<ThemeWithTickers, 'ticker_weights'>[]>(
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
  const themeIds = themes.map(t => t.id)

  const tickerRows = themeIds.length > 0
    ? await q<any[]>(
        db.from('theme_tickers')
          .select('theme_id, ticker, final_weight, relevance, rationale, assets!inner(asset_type)')
          .in('theme_id', themeIds)
          .order('final_weight', { ascending: false })
      ) ?? []
    : []

  // Build ticker map per theme
  const weightsByTheme = new Map<string, TickerWeight[]>()
  for (const row of tickerRows) {
    const { theme_id, assets, ...rest } = row
    const entry = coerceTicker(rest, assets)
    if (!weightsByTheme.has(theme_id)) weightsByTheme.set(theme_id, [])
    weightsByTheme.get(theme_id)!.push(entry)
  }

  // Fetch signals for all tickers
  const allTickers = [...new Set(tickerRows.map((r: any) => r.ticker))]
  const signalRows = allTickers.length > 0
    ? await q<{ ticker: string; signal: string | null; score: number | null; price_usd: number | null; change_pct: number | null }[]>(
        db.from('asset_signals')
          .select('ticker, signal, score, price_usd, change_pct')
          .in('ticker', allTickers)
      ) ?? []
    : []

  const signalMap: SignalMap = Object.fromEntries(
    signalRows.map(s => [s.ticker, {
      signal:     s.signal,
      score:      s.score,
      price_usd:  s.price_usd,
      change_pct: s.change_pct,
    }])
  )

  const hydratedThemes: ThemeWithTickers[] = themes.map(t => ({
    ...t,
    ticker_weights: weightsByTheme.get(t.id) ?? [],
  }))

  return {
    themes:    hydratedThemes,
    regime:    regimeRows?.[0] ?? null,
    signalMap,
  }
}
