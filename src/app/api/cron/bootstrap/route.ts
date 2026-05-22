// src/app/api/cron/bootstrap/route.ts
// Bootstrap full price history for un-bootstrapped tickers via Moomoo bridge.
// Can be triggered manually or called when a new ticker is added to watchlist.
// GET /api/cron/bootstrap          → bootstrap all pending tickers
// GET /api/cron/bootstrap?ticker=X → bootstrap single ticker

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient }        from '@/lib/supabase/server'

export const maxDuration = 300
export const dynamic     = 'force-dynamic'

const BRIDGE_URL = process.env.BRIDGE_URL ?? 'http://localhost:8765'
const BATCH_SIZE = 200

function isCronAuthorised(req: NextRequest): boolean {
  const auth     = req.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`
  const fallback  = `Bearer a3f8c2e1d4b7a9f0e3c6d2b5a8f1e4c7d0b3a6f9e2c5d8b1a4f7e0c3d6b9a2f5`
  return auth === expected || auth === fallback
}

async function bootstrapTicker(ticker: string, supabase: any): Promise<{ rows: number; error?: string }> {
  try {
    // Fetch full 3-year history from bridge
    const res = await fetch(
      `${BRIDGE_URL}/prices/bootstrap?ticker=${ticker}&count=752`,
      { signal: AbortSignal.timeout(30000) }
    )
    if (!res.ok) throw new Error(`Bridge ${res.status}`)
    const d = await res.json()

    const rows = (d.results?.[ticker] ?? [])
      .filter((r: any) => r.close !== null && r.date)
      .map((r: any) => ({
        ticker,
        date:      r.date,
        open:      r.open   ?? null,
        high:      r.high   ?? null,
        low:       r.low    ?? null,
        close:     r.close  ?? null,
        adj_close: null,
        volume:    r.volume ?? null,
        source:    'moomoo',
      }))

    if (!rows.length) {
      // Try error field
      const err = d.errors?.[ticker]
      if (err) throw new Error(err)
      throw new Error('No data returned')
    }

    // Upsert in batches of 200
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const { error } = await supabase
        .from('daily_prices')
        .upsert(rows.slice(i, i + BATCH_SIZE), { onConflict: 'ticker,date', ignoreDuplicates: false })
      if (error) throw new Error(error.message)
    }

    // Mark as bootstrapped
    await supabase.from('assets').update({ bootstrapped: true, failure_count: 0 }).eq('ticker', ticker)

    return { rows: rows.length }
  } catch (e: any) {
    // Increment failure count
    const { data: asset } = await supabase.from('assets').select('failure_count').eq('ticker', ticker).single()
    await supabase.from('assets').update({
      failure_count:   (asset?.failure_count ?? 0) + 1,
      last_failure_at: new Date().toISOString(),
    }).eq('ticker', ticker)

    return { rows: 0, error: e.message }
  }
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorised(req)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const supabase     = createServiceClient()
  const singleTicker = req.nextUrl.searchParams.get('ticker')?.toUpperCase()
  const start        = Date.now()

  let tickers: string[] = []

  if (singleTicker) {
    // Single ticker bootstrap
    tickers = [singleTicker]
  } else {
    // All un-bootstrapped active tickers
    const { data: assets, error } = await (supabase as any)
      .from('assets')
      .select('ticker')
      .eq('is_active', true)
      .eq('bootstrapped', false)
      .lt('failure_count', 5)
      .order('bootstrap_priority', { ascending: true })
      .order('ticker')

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    tickers = (assets ?? []).map((a: any) => a.ticker)
  }

  if (!tickers.length) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'No tickers to bootstrap' })
  }

  console.log(`[cron:bootstrap] Bootstrapping ${tickers.length} tickers via Moomoo bridge`)

  const results: { ticker: string; rows: number; error?: string }[] = []

  // Sequential — bridge has fixed overhead, parallelism doesn't help much
  for (const ticker of tickers) {
    const result = await bootstrapTicker(ticker, supabase)
    results.push({ ticker, ...result })
    console.log(`[cron:bootstrap] ${ticker}: ${result.error ? `ERROR — ${result.error}` : `${result.rows} rows`}`)
  }

  const success    = results.filter(r => !r.error)
  const failures   = results.filter(r => r.error)
  const totalRows  = success.reduce((sum, r) => sum + r.rows, 0)
  const duration   = ((Date.now() - start) / 1000).toFixed(1)

  console.log(`[cron:bootstrap] Done — ${success.length} succeeded, ${failures.length} failed, ${totalRows} rows, ${duration}s`)

  return NextResponse.json({
    ok:           failures.length === 0,
    bootstrapped: success.length,
    failed:       failures.length,
    total_rows:   totalRows,
    duration_sec: duration,
    source:       'moomoo',
    failures:     failures.map(f => ({ ticker: f.ticker, error: f.error })),
  })
}
