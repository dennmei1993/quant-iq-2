// src/app/api/admin/sync-prices/route.ts
/**
 * POST /api/admin/sync-prices?priority=1|2|3&tickers=AAPL,MSFT
 * Manual price sync with composite signal scoring.
 * Auth: logged-in session OR x-admin-secret header.
 */
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchPricesForTickers, fetchSparklinesForTickers } from '@/lib/polygon'
import { batchScoreSignals } from '@/lib/signal-scorer'

export const maxDuration = 300

async function isAuthorised(req: NextRequest): Promise<boolean> {
  // Accept admin secret header
  const secret = req.headers.get('x-admin-secret')
  if (secret && secret === process.env.ADMIN_SECRET) return true

  // Fall back to session check
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

export async function POST(req: NextRequest) {
  if (!await isAuthorised(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db       = createServiceClient()
  const log: string[] = []

  // Determine which tickers to sync
  const tickerParam  = req.nextUrl.searchParams.get('tickers')
  const priority     = parseInt(req.nextUrl.searchParams.get('priority') ?? '2')
  let tickers: string[]

  if (tickerParam) {
    tickers = tickerParam.split(',').map(t => t.trim().toUpperCase()).filter(Boolean)
  } else {
    const { data: assets } = await db
      .from('assets')
      .select('ticker')
      .eq('is_active', true)
      .lte('bootstrap_priority', priority)
      .order('bootstrap_priority')
      .order('ticker')
    tickers = (assets ?? []).map((a: any) => a.ticker)
  }

  log.push(`Syncing ${tickers.length} ticker(s)...`)

  try {
    const prices     = await fetchPricesForTickers(tickers)
    // Fetch sparklines for single-ticker requests (ticker page auto-sync)
    // Skip for bulk syncs to avoid timeout
    const sparklines = tickers.length <= 5
      ? await fetchSparklinesForTickers([...prices.keys()])
      : new Map()
    log.push(`Prices fetched: ${prices.size} / ${tickers.length}`)

    // Fetch supporting data for composite scoring
    const since7d = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString()

    const [eventsResult, themeTickersResult, macroResult] = await Promise.all([
      db.from('events')
        .select('tickers, sentiment_score, published_at')
        .eq('ai_processed', true)
        .gte('published_at', since7d)
        .not('sentiment_score', 'is', null),

      db.from('theme_tickers')
        .select('ticker, themes(conviction, is_active)')
        .in('ticker', tickers),

      db.from('macro_scores').select('score'),
    ])

    const macroScores = (macroResult.data ?? []).map((r: any) => r.score)
    const macroScore  = macroScores.length
      ? macroScores.reduce((a: number, b: number) => a + b, 0) / macroScores.length
      : 0

    const themeRows = (themeTickersResult.data ?? [])
      .filter((r: any) => r.themes?.is_active !== false)
      .map((r: any) => ({
        ticker:     r.ticker,
        conviction: (r.themes as any)?.conviction ?? 0,
      }))

    const priceInputs = [...prices.entries()].map(([ticker, p]) => ({
      ticker, change_pct: p.change_pct,
    }))

    const scored = batchScoreSignals({
      tickers:    priceInputs,
      events:     (eventsResult.data ?? []) as any,
      themes:     themeRows,
      macroScore,
    })

    const rows = [...prices.keys()].map(t => {
      const p    = prices.get(t)!
      const sig  = scored.get(t)
      const bars = sparklines.get(t) ?? []
      return {
        ticker:     t,
        price_usd:  p.price,
        change_pct: p.change_pct,
        signal:     sig?.signal ?? 'hold',
        score:      sig?.score  ?? 50,
        ...(bars.length > 0 && { sparkline: bars.map((b: any) => b.c) }),
        updated_at: new Date().toISOString(),
      }
    })

    if (rows.length > 0) {
      await (db.from('asset_signals') as any)
        .upsert(rows, { onConflict: 'ticker' })
    }

    log.push(`Done: ${rows.length} synced`)
    return NextResponse.json({ ok: true, synced: rows.length, total: tickers.length, log })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e), log }, { status: 500 })
  }
}
