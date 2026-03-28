// src/app/api/admin/sync-prices/route.ts
/**
 * POST /api/admin/sync-prices?priority=1|2|3
 *
 * Manual trigger — syncs prices for tickers up to given priority.
 * Skips sparklines to stay within 300s timeout.
 *
 *   priority=1  ~23 tickers  ~65s
 *   priority=2  ~100 tickers ~260s
 *   priority=3  ~152 tickers (may timeout — use priority=2 max)
 *
 * Auth: x-admin-secret header
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchPricesForTickers } from '@/lib/polygon'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

export const maxDuration = 300

function deriveSignal(pct: number): 'buy' | 'watch' | 'hold' | 'avoid' {
  if (pct >= 2)   return 'buy'
  if (pct >= 0.5) return 'watch'
  if (pct >= -1)  return 'hold'
  return 'avoid'
}

function deriveSignalScore(pct: number): number {
  return Math.round(Math.min(100, Math.max(0, 50 + pct * 10)))
}

export async function POST(req: NextRequest) {
  // Accept either admin secret header or logged-in session
  const secret = req.headers.get('x-admin-secret')
    if (secret !== process.env.ADMIN_SECRET) {
      // Fall back to session check
      try {
        const cookieStore = await cookies()
        const authClient  = createServerClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          { cookies: { get: (n: string) => cookieStore.get(n)?.value, set: () => {}, remove: () => {} } }
        )
        const { data: { user } } = await authClient.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      } catch {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

  const priority = parseInt(req.nextUrl.searchParams.get('priority') ?? '2')
  const db       = createServiceClient()
  const log: string[] = []

  try {
    // If specific tickers provided, use those — otherwise fetch by priority
    const tickerParam = req.nextUrl.searchParams.get('tickers')
    let tickers: string[]

    if (tickerParam) {
      tickers = tickerParam.split(',').map(t => t.trim().toUpperCase()).filter(Boolean)
    } else {
      const { data: assets } = await db
        .from('assets')
        .select('ticker, bootstrap_priority')
        .eq('is_active', true)
        .lte('bootstrap_priority', priority)
        .order('bootstrap_priority')
        .order('ticker')
      tickers = (assets ?? []).map((a: any) => a.ticker)
    }
    log.push(`Syncing prices for ${tickers.length} tickers (priority ≤ ${priority})...`)

    // No sparklines — prices only to stay within timeout
    const prices = await fetchPricesForTickers(tickers)

    const rows = [...prices.keys()].map(t => {
      const p = prices.get(t)!
      return {
        ticker:     t,
        price_usd:  p.price,
        change_pct: p.change_pct,
        signal:     deriveSignal(p.change_pct),
        score:      deriveSignalScore(p.change_pct),
        updated_at: new Date().toISOString(),
      }
    })

    if (rows.length > 0) {
      await (db.from('asset_signals') as any)
        .upsert(rows, { onConflict: 'ticker' })
    }

    log.push(`Done: ${prices.size} / ${tickers.length} synced`)
    return NextResponse.json({ ok: true, synced: prices.size, total: tickers.length, log })
  } catch (e) {
    console.error('[admin/sync-prices]', e)
    return NextResponse.json({ ok: false, error: String(e), log }, { status: 500 })
  }
}
