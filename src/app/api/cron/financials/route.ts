// src/app/api/cron/financials/route.ts
/**
 * Daily cron — syncs prices for priority-1 tickers and computes
 * two-dimensional signals (fundamental + technical).
 *
 * Schedule: 0 6 * * 1  (Monday 6am UTC, vercel.json)
 */
import { NextRequest, NextResponse } from 'next/server'
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

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const isVercelCron = req.headers.get('x-vercel-cron') === '1'
  const isManualRun  = req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
  if (!isVercelCron && !isManualRun) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db  = createServiceClient()
  const log: string[] = []

  try {
    // ── Priority-1 assets ───────────────────────────────────────────────────
    const { data: assetsRaw } = await db
      .from('assets')
      .select('ticker, asset_type, sector, pe_ratio, profit_margin, eps, analyst_rating')
      .eq('is_active', true)
      .eq('bootstrap_priority', 1)
      .order('ticker')
    const assets: AssetRow[] = (assetsRaw ?? []) as AssetRow[]
    const tickers = assets.map(a => a.ticker)

    log.push(`Scoring signals for ${tickers.length} priority-1 tickers...`)

    // ── Prices + sparklines ─────────────────────────────────────────────────
    const prices     = await fetchPricesForTickers(tickers)
    const sparklines = await fetchSparklinesForTickers([...prices.keys()])
    log.push(`Prices fetched: ${prices.size} / ${tickers.length}`)

    // SPY sparkline for relative strength
    const spyMap       = await fetchSparklinesForTickers(['SPY'])
    const spySparkline = (spyMap.get('SPY') ?? []).map((b: { c: number }) => b.c)

    // ── Supporting data ─────────────────────────────────────────────────────
    const [themeResult, macroResult] = await Promise.all([
      db.from('theme_tickers')
        .select('ticker, themes(conviction, is_active)')
        .in('ticker', tickers),
      db.from('macro_scores').select('aspect, score'),
    ])

    const themeRows: ThemeRow[] = (themeResult.data ?? [])
      .filter((r: any) => r.themes?.is_active !== false)
      .map((r: any) => ({
        ticker:     r.ticker     as string,
        conviction: (r.themes?.conviction ?? 0) as number,
      }))

    const macroScores: MacroRow[] = (macroResult.data ?? []).map((r: any) => ({
      aspect: r.aspect as string,
      score:  r.score  as number,
    }))

    // ── Batch score ─────────────────────────────────────────────────────────
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
      sectorPEs:    [],   // future: FMP sector-pe-snapshot
      spySparkline,
    })

    // ── Upsert rows ─────────────────────────────────────────────────────────
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
        sparkline:         bars.map((b: { c: number }) => b.c),
        signal_updated_at: now,
        updated_at:        now,
      }
    })

    if (rows.length > 0) {
      await (db.from('asset_signals') as any)
        .upsert(rows, { onConflict: 'ticker' })
    }

    // Signal distribution summary
    const dist = { buy: 0, watch: 0, hold: 0, avoid: 0 }
    for (const s of scored.values()) dist[s.signal as keyof typeof dist]++
    log.push(`Signals: buy=${dist.buy} watch=${dist.watch} hold=${dist.hold} avoid=${dist.avoid}`)
    log.push(`Done: ${rows.length} / ${tickers.length} updated`)

    return NextResponse.json({ ok: true, synced: rows.length, total: tickers.length, log })
  } catch (e) {
    console.error('[cron/financials]', e)
    return NextResponse.json({ ok: false, error: String(e), log }, { status: 500 })
  }
}
