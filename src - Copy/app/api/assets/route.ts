/**
 * GET /api/assets
 * Returns assets with signals and active theme coverage.
 * Public — no auth required.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

type AssetRow       = { ticker: string; name: string; asset_type: string; sector: string | null }
type SignalRow       = { ticker: string; signal: string | null; score: number | null; price_usd: number | null; change_pct: number | null; sparkline: number[] | null; rationale: string | null; updated_at: string | null }
type ThemeRow       = { id: string; name: string; timeframe: string; conviction: number | null }
type ThemeTicker    = { ticker: string; theme_id: string; final_weight: number }
type ThemeCoverage  = { theme_id: string; theme_name: string; timeframe: string; final_weight: number; conviction: number | null }

async function query<T>(q: any): Promise<T | null> {
  const result = await q
  return (result as any).data as T | null
}

export async function GET(req: NextRequest) {
  try {
    const supabase = createServiceClient()
    const p        = req.nextUrl.searchParams
    const type     = p.get('type')
    const signal   = p.get('signal')

    // ── 1. Fetch assets ───────────────────────────────────────────────────
    let assetQ = supabase.from('assets').select('ticker, name, asset_type, sector').order('ticker')
    if (type) assetQ = assetQ.eq('asset_type', type)
    const assets = await query<AssetRow[]>(assetQ) ?? []
    if (!assets.length) return NextResponse.json({ assets: [] })

    const tickers = assets.map(a => a.ticker)

    // ── 2. Fetch signals ──────────────────────────────────────────────────
    const signals = await query<SignalRow[]>(
      supabase.from('asset_signals')
        .select('ticker, signal, score, price_usd, change_pct, sparkline, rationale, updated_at')
        .in('ticker', tickers)
    ) ?? []
    const signalMap = new Map(signals.map(s => [s.ticker, s]))

    // ── 3. Fetch active themes ────────────────────────────────────────────
    const activeThemes = await query<ThemeRow[]>(
      supabase.from('themes')
        .select('id, name, timeframe, conviction')
        .eq('is_active', true)
    ) ?? []
    const themeMap = new Map(activeThemes.map(t => [t.id, t]))
    const activeThemeIds = activeThemes.map(t => t.id)

    // ── 4. Fetch theme_tickers for active themes only ─────────────────────
    const themeTickerRows = activeThemeIds.length > 0
      ? await query<ThemeTicker[]>(
          supabase.from('theme_tickers')
            .select('ticker, theme_id, final_weight')
            .in('theme_id', activeThemeIds)
            .in('ticker', tickers)
            .order('final_weight', { ascending: false })
        ) ?? []
      : []

    // Group theme coverage by ticker
    const coverageMap = new Map<string, ThemeCoverage[]>()
    for (const row of themeTickerRows) {
      const theme = themeMap.get(row.theme_id)
      if (!theme) continue
      if (!coverageMap.has(row.ticker)) coverageMap.set(row.ticker, [])
      coverageMap.get(row.ticker)!.push({
        theme_id:    row.theme_id,
        theme_name:  theme.name,
        timeframe:   theme.timeframe,
        final_weight: row.final_weight,
        conviction:  theme.conviction,
      })
    }

    // ── 5. Assemble + sort ────────────────────────────────────────────────
    let result = assets.map(asset => {
      const sig    = signalMap.get(asset.ticker)
      const themes = coverageMap.get(asset.ticker) ?? []
      return {
        ...asset,
        signal:           sig?.signal    ?? null,
        score:            sig?.score     ?? null,
        price_usd:        sig?.price_usd ?? null,
        change_pct:       sig?.change_pct ?? null,
        sparkline:        sig?.sparkline  ?? null,
        rationale:        sig?.rationale  ?? null,
        updated_at:       sig?.updated_at ?? null,
        themes,
        theme_count:      themes.length,
        max_theme_weight: themes.length > 0 ? Math.max(...themes.map(t => t.final_weight)) : 0,
      }
    })

    if (signal) result = result.filter(a => a.signal === signal)

    // Assets in active themes float to top, then by signal score
    result.sort((a, b) =>
      b.max_theme_weight !== a.max_theme_weight
        ? b.max_theme_weight - a.max_theme_weight
        : (b.score ?? 0) - (a.score ?? 0)
    )

    return NextResponse.json({ assets: result, count: result.length })
  } catch (e) {
    console.error('[api/assets]', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
