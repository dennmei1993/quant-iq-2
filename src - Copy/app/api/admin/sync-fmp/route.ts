// src/app/api/admin/sync-fmp/route.ts
/**
 * POST /api/admin/sync-fmp?tickers=AAPL,MSFT
 * POST /api/admin/sync-fmp?priority=2
 *
 * On-demand FMP financials sync. Called from:
 *  - Ticker detail page (auto-sync on first visit)
 *  - Admin dashboard (manual bulk sync)
 *
 * Auth: logged-in session OR x-admin-secret header
 */
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { createServiceClient } from '@/lib/supabase/server'
import { syncFMPToAssets } from '@/lib/fmp'

export const maxDuration = 60

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

export async function POST(req: NextRequest) {
  if (!await isAuthorised(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db       = createServiceClient()
  const log: string[] = []

  const tickerParam = req.nextUrl.searchParams.get('tickers')
  const priority    = parseInt(req.nextUrl.searchParams.get('priority') ?? '2')
  let tickers: string[]

  if (tickerParam) {
    tickers = tickerParam.split(',').map(t => t.trim().toUpperCase()).filter(Boolean)
  } else {
    const { data: assets } = await db
      .from('assets')
      .select('ticker')
      .eq('is_active', true)
      .lte('bootstrap_priority', priority)
      .in('asset_type', ['stock', 'etf'])
      .order('bootstrap_priority')
      .order('ticker')
    tickers = (assets ?? []).map((a: any) => a.ticker)
  }

  log.push(`Syncing FMP for ${tickers.length} ticker(s)...`)

  try {
    const { synced, failed } = await syncFMPToAssets(db, tickers)
    log.push(`Done: ${synced} synced · ${failed.length} failed`)
    if (failed.length > 0) log.push(`Failed: ${failed.slice(0, 10).join(', ')}`)

    return NextResponse.json({ ok: true, synced, failed: failed.length, log })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e), log }, { status: 500 })
  }
}
