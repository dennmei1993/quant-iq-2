// src/app/api/admin/sync-prices/route.ts
/**
 * POST /api/admin/sync-prices?priority=1|2|3&tickers=AAPL,MSFT
 * Manual price sync with two-dimensional signal scoring.
 * Auth: logged-in session OR x-admin-secret header.
 */
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchPricesForTickers, fetchSparklinesForTickers } from '@/lib/polygon'
import { batchScoreSignals } from '@/lib/signal-scorer'

export const maxDuration = 300

// ─── Types ────────────────────────────────────────────────────────────────────

type AssetRow = {
  ticker:         string
  asset_type:     string
  sector:         string | null
  pe_ratio:       number | null
  profit_margin:  number | null
  eps:            number | null
  analyst_rating: string | null
}

type ThemeRow = {
  ticker:     string
  conviction: number
}

type MacroRow = {
  aspect: string
  score:  number
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function isAuthorised(req: NextRequest): Promise<boolean> {
  const secret = req.headers.get('x-admin-secret')
  if (secret && secret === process.env.ADMIN_SECRET) return true
  try {
    const cookieStore = await cookies()
    const authClient  = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get: (n: string) => cookieStore.get(n)?.value, set: () => {}, remove: () => {} } }
    )
    const { data: { user } } = await authClient.auth.getUser()
    return !!user
  } catch { return false }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!await isAuthorised(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db        = createServiceClient()
  const log: string[] = []

  // ── Resolve ticker list ───────────────────────────────────────────────────
  const tickerParam = req.nextUrl.searchParams.get('tickers')
  const priority    = parseInt(req.nextUrl.searchParams.get('priority') ?? '2')
  let tickerList: string[]

  if (tickerParam) {
    tickerList = tickerParam.split(',').map(t => t.trim().toUpperCase()).filter(Boolean)
  } else {
    const { data: assetRows } = await db
      .from('assets')
      .select('ticker')
      .eq('is_active', true)
      .lte('bootstrap_priority', priority)
      .order('bootstrap_priority')
      .order('ticker')
    tickerList = (assetRows ?? []).map((a: { ticker: string }) => a.ticker)
  }

  log.push(`Syncing prices for ${tickerList.length} tickers (priority ≤ ${priority})...`)

  try {
    // ── Prices + sparklines ─────────────────────────────────────────────────
    const prices     = await fetchPricesForTickers(tickerList)
    const sparklines = await fetchSparklinesForTickers([...prices.keys()])

    // SPY sparkline for relative strength calculation
    const spyMap       = await fetchSparklinesForTickers(['SPY'])
    const spySparkline = (spyMap.get('SPY') ?? []).map((b: { c: number }) => b.c)

    // ── Asset fundamentals ──────────────────────────────────────────────────
    const { data: assetsRaw } = await db
      .from('assets')
      .select('ticker, asset_type, sector, pe_ratio, profit_margin, eps, analyst_rating')
      .in('ticker', tickerList)
    const assets: AssetRow[] = (assetsRaw ?? []) as AssetRow[]

    // ── Theme + macro data ──────────────────────────────────────────────────
    const [themeResult, macroResult] = await Promise.all([
      db.from('theme_tickers')
        .select('ticker, themes(conviction, is_active)')
        .in('ticker', tickerList),
      db.from('macro_scores').select('aspect, score'),
    ])

    const themeRows: ThemeRow[] = (themeResult.data ?? [])
      .filter((r: any) => r.themes?.is_active !== false)
      .map((r: any) => ({
        ticker:     r.ticker as string,
        conviction: (r.themes?.conviction ?? 0) as number,
      }))

    const macroScores: MacroRow[] = (macroResult.data ?? []).map((r: any) => ({
      aspect: r.aspect as string,
      score:  r.score  as number,
    }))

    // ── Score signals ───────────────────────────────────────────────────────
    const tickerInputs = [...prices.entries()].map(([ticker, p]) => ({
      ticker,
      asset_type: assets.find(a => a.ticker === ticker)?.asset_type ?? 'stock',
      change_pct: p.change_pct,
      sparkline:  (sparklines.get(ticker) ?? []).map((b: { c: number }) => b.c),
    }))

    const scored = batchScoreSignals({
      tickers:      tickerInputs,
      assets,
      themes:       themeRows,
      macroScores,
      sectorPEs:    [],
      spySparkline,
    })

    // ── Build upsert rows ───────────────────────────────────────────────────
    const now  = new Date().toISOString()
    const rows = [...prices.keys()].map(ticker => {
      const p    = prices.get(ticker)!
      const sig  = scored.get(ticker)
      const bars = sparklines.get(ticker) ?? []
      return {
        ticker,
        price_usd:         p.price,
        change_pct:        p.change_pct,
        signal:            sig?.signal            ?? 'hold',
        score:             sig?.score             ?? 50,
        fundamental_score: sig?.fundamental_score ?? null,
        technical_score:   sig?.technical_score   ?? null,
        f_components:      sig?.f_components      ?? null,
        t_components:      sig?.t_components      ?? null,
        ...(bars.length > 0 && { sparkline: bars.map((b: { c: number }) => b.c) }),
        signal_updated_at: now,
        updated_at:        now,
      }
    })

    if (rows.length > 0) {
      await (db.from('asset_signals') as any)
        .upsert(rows, { onConflict: 'ticker' })
    }

    log.push(`Done: ${rows.length} / ${tickerList.length} synced`)
    return NextResponse.json({ ok: true, synced: rows.length, total: tickerList.length, log })
  } catch (e) {
    console.error('[sync-prices]', e)
    return NextResponse.json({ ok: false, error: String(e), log }, { status: 500 })
  }
}
