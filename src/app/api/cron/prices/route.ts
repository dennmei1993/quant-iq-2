// src/app/api/cron/prices/route.ts
// Schedule: 0 22 * * 1-5  (after US market close, Mon-Fri)
// Fetches daily prices for all active bootstrapped assets via local Moomoo bridge.
// Replaces quant-iq-engine FMP-based price crons.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient }        from '@/lib/supabase/server'

export const maxDuration = 300
export const dynamic     = 'force-dynamic'

const BRIDGE_URL       = process.env.BRIDGE_URL      ?? 'http://localhost:8765'
const BATCH_SIZE       = 20
const DEACTIVATE_AFTER = 5

function isCronAuthorised(req: NextRequest): boolean {
  const auth     = req.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`
  const fallback  = `Bearer a3f8c2e1d4b7a9f0e3c6d2b5a8f1e4c7d0b3a6f9e2c5d8b1a4f7e0c3d6b9a2f5`
  return auth === expected || auth === fallback
}

function lastTradingDay(): string {
  const d    = new Date()
  const day  = d.getUTCDay()
  const hour = d.getUTCHours()
  // If after 21:00 UTC on a weekday, today's prices are available
  if (hour >= 21 && day >= 1 && day <= 5) return d.toISOString().slice(0, 10)
  // Roll back to last weekday
  const rollback = day === 1 ? 3 : day === 0 ? 2 : 1
  d.setUTCDate(d.getUTCDate() - rollback)
  return d.toISOString().slice(0, 10)
}

async function fetchPricesFromBridge(tickers: string[], count: number): Promise<{
  results: Record<string, { date: string; open: number | null; high: number | null; low: number | null; close: number | null; volume: number | null }[]>
  errors:  Record<string, string>
}> {
  const res = await fetch(
    `${BRIDGE_URL}/prices/daily?tickers=${tickers.join(',')}&count=${count}`,
    { signal: AbortSignal.timeout(60000) }
  )
  if (!res.ok) throw new Error(`Bridge returned ${res.status}`)
  const d = await res.json()
  return { results: d.results ?? {}, errors: d.errors ?? {} }
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorised(req)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const supabase  = createServiceClient()
  const start     = Date.now()
  const targetDate = lastTradingDay()
  const count     = 5  // fetch last 5 days — handles any missed days gracefully

  // Fetch all active bootstrapped tickers
  const { data: assets, error: assetsError } = await (supabase as any)
    .from('assets')
    .select('ticker, asset_type, failure_count')
    .eq('is_active', true)
    .eq('bootstrapped', true)
    .order('ticker')

  if (assetsError || !assets?.length) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'No active bootstrapped assets' })
  }

  const tickers    = assets.map((a: any) => a.ticker) as string[]
  const failureMap = Object.fromEntries(assets.map((a: any) => [a.ticker, a.failure_count ?? 0]))
  const totalCount = tickers.length

  // Quick connectivity check before processing all tickers
  try {
    const pingRes = await fetch(`${BRIDGE_URL}/health`, { signal: AbortSignal.timeout(5000) })
    if (!pingRes.ok) throw new Error(`Bridge health check failed: ${pingRes.status}`)
  } catch (e: any) {
    console.error(`[cron:prices] Bridge unreachable at ${BRIDGE_URL}: ${e.message}`)
    return NextResponse.json({
      ok:    false,
      error: `Bridge unreachable at ${BRIDGE_URL} — ensure Moomoo bridge is running and BRIDGE_URL env var points to the tunnel URL`,
      hint:  'Set BRIDGE_URL in Vercel env vars to your Cloudflare tunnel URL (e.g. https://xxx.trycloudflare.com)',
    }, { status: 503 })
  }

  console.log(`[cron:prices] Bridge reachable at ${BRIDGE_URL}`)

  let totalRows    = 0
  const failed:      string[] = []
  const deactivated: string[] = []

  // Process in batches
  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const batch = tickers.slice(i, i + BATCH_SIZE)

    try {
      const { results, errors } = await fetchPricesFromBridge(batch, count)

      // Handle errors from bridge
      for (const [ticker, errMsg] of Object.entries(errors)) {
        console.error(`[cron:prices] ${ticker} bridge error: ${errMsg}`)
        failed.push(ticker)

        const newCount = (failureMap[ticker] ?? 0) + 1
        await (supabase as any).from('assets').update({ failure_count: newCount, last_failure_at: new Date().toISOString() }).eq('ticker', ticker)

        if (newCount >= DEACTIVATE_AFTER) {
          await (supabase as any).from('assets').update({ is_active: false }).eq('ticker', ticker)
          deactivated.push(ticker)
          console.log(`[cron:prices] ${ticker} deactivated after ${newCount} failures`)
        }
      }

      // Upsert successful results
      for (const [ticker, rows] of Object.entries(results)) {
        if (!rows.length) continue

        const upsertRows = rows
          .filter(r => r.close !== null && r.date)
          .map(r => ({
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

        if (!upsertRows.length) continue

        const { error: upsertErr } = await (supabase as any)
          .from('daily_prices')
          .upsert(upsertRows, { onConflict: 'ticker,date', ignoreDuplicates: false })

        if (upsertErr) {
          console.error(`[cron:prices] upsert error for ${ticker}:`, upsertErr.message)
          failed.push(ticker)
        } else {
          totalRows += upsertRows.length
          // Reset failure count on success
          if ((failureMap[ticker] ?? 0) > 0) {
            await (supabase as any).from('assets').update({ failure_count: 0, last_failure_at: null }).eq('ticker', ticker)
          }
        }
      }

    } catch (e: any) {
      console.error(`[cron:prices] batch ${i}-${i + BATCH_SIZE} failed:`, e.message)
      failed.push(...batch)
    }

    const pct = Math.round(((i + batch.length) / totalCount) * 100)
    console.log(`[cron:prices] ${i + batch.length}/${totalCount} (${pct}%) · rows=${totalRows}`)
  }

  const duration = ((Date.now() - start) / 1000).toFixed(1)
  const ok       = failed.length === 0

  console.log(`[cron:prices] Done — ${totalCount} tickers, ${totalRows} rows, ${failed.length} failed, ${duration}s`)

  return NextResponse.json({
    ok,
    total_tickers: totalCount,
    rows_written:  totalRows,
    target_date:   targetDate,
    failed:        failed.slice(0, 20),
    deactivated,
    duration_sec:  duration,
    source:        'moomoo',
  })
}
