// src/app/api/cron/financials/route.ts
/**
 * Daily cron — syncs prices for priority-1 tickers and computes
 * composite signals using weighted scoring model.
 *
 * Signal = 30% price momentum + 35% news sentiment + 25% theme conviction + 10% macro
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchPricesForTickers, fetchSparklinesForTickers } from '@/lib/polygon'
import { batchScoreSignals } from '@/lib/signal-scorer'

export const maxDuration = 300

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db  = createServiceClient()
  const log: string[] = []

  try {
    // ── Fetch priority-1 tickers ──────────────────────────────────────────────
    const { data: assets } = await db
      .from('assets')
      .select('ticker')
      .eq('is_active', true)
      .eq('bootstrap_priority', 1)
      .order('ticker')

    const tickers = (assets ?? []).map((a: any) => a.ticker)
    log.push(`Scoring signals for ${tickers.length} priority-1 tickers...`)

    // ── Fetch prices ──────────────────────────────────────────────────────────
    const prices     = await fetchPricesForTickers(tickers)
    const sparklines = await fetchSparklinesForTickers([...prices.keys()])
    log.push(`Prices fetched: ${prices.size} / ${tickers.length}`)

    // ── Fetch supporting data for composite scoring ───────────────────────────
    const since7d = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString()

    const [eventsResult, themeTickersResult, macroResult] = await Promise.all([
      db.from('events')
        .select('tickers, sentiment_score, published_at')
        .eq('ai_processed', true)
        .gte('published_at', since7d)
        .not('sentiment_score', 'is', null),

      db.from('theme_tickers')
        .select('ticker, themes(conviction, is_active)'),

      db.from('macro_scores')
        .select('score'),
    ])

    // Overall macro score = average of all aspects
    const macroScores = (macroResult.data ?? []).map((r: any) => r.score)
    const macroScore  = macroScores.length
      ? macroScores.reduce((a: number, b: number) => a + b, 0) / macroScores.length
      : 0

    // Flatten theme_tickers with conviction
    const themeRows = (themeTickersResult.data ?? [])
      .filter((r: any) => r.themes?.is_active !== false)
      .map((r: any) => ({
        ticker:     r.ticker,
        conviction: (r.themes as any)?.conviction ?? 0,
      }))

    log.push(`Macro score: ${macroScore.toFixed(2)}, theme rows: ${themeRows.length}`)

    // ── Batch score all tickers ───────────────────────────────────────────────
    const priceInputs = [...prices.entries()].map(([ticker, p]) => ({
      ticker,
      change_pct: p.change_pct,
    }))

    const scored = batchScoreSignals({
      tickers:    priceInputs,
      events:     (eventsResult.data ?? []) as any,
      themes:     themeRows,
      macroScore,
    })

    // ── Build upsert rows ─────────────────────────────────────────────────────
    const rows = [...prices.keys()].map(t => {
      const p       = prices.get(t)!
      const bars    = sparklines.get(t) ?? []
      const sig     = scored.get(t)
      return {
        ticker:     t,
        price_usd:  p.price,
        change_pct: p.change_pct,
        signal:     sig?.signal ?? 'hold',
        score:      sig?.score  ?? 50,
        sparkline:  bars.map((b: any) => b.c),
        updated_at: new Date().toISOString(),
      }
    })

    if (rows.length > 0) {
      await (db.from('asset_signals') as any)
        .upsert(rows, { onConflict: 'ticker' })
    }

    // Log signal distribution
    const dist = { buy: 0, watch: 0, hold: 0, avoid: 0 }
    for (const s of scored.values()) dist[s.signal]++
    log.push(`Signals: buy=${dist.buy} watch=${dist.watch} hold=${dist.hold} avoid=${dist.avoid}`)
    log.push(`Done: ${rows.length} tickers updated`)

    return NextResponse.json({ ok: true, synced: rows.length, total: tickers.length, log })
  } catch (e) {
    console.error('[cron/financials]', e)
    return NextResponse.json({ ok: false, error: String(e), log }, { status: 500 })
  }
}
