// src/app/api/admin/coverage/route.ts
// Returns asset_signals coverage stats for the admin page.
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET() {
  const db = createServiceClient()

  const { data: assets } = await db
    .from('assets')
    .select('ticker, asset_type, bootstrap_priority')
    .eq('is_active', true)

  const { data: signals } = await db
    .from('asset_signals')
    .select('ticker, price_usd')

  const signalSet = new Map((signals ?? []).map((s: any) => [s.ticker, s.price_usd]))

  const allAssets   = assets ?? []
  const withPrice   = allAssets.filter((a: any) => signalSet.has(a.ticker) && signalSet.get(a.ticker) != null)
  const missing     = allAssets.filter((a: any) => !signalSet.has(a.ticker) || signalSet.get(a.ticker) == null)

  // Group by asset_type
  const types = ['stock', 'etf', 'crypto', 'commodity']
  const by_type = types.map(t => ({
    asset_type: t,
    total:      allAssets.filter((a: any) => a.asset_type === t).length,
    with_price: withPrice.filter((a: any) => a.asset_type === t).length,
  }))

  return NextResponse.json({
    total:      allAssets.length,
    with_price: withPrice.length,
    by_type,
    missing:    missing.slice(0, 50).map((a: any) => ({
      ticker:             a.ticker,
      asset_type:         a.asset_type,
      bootstrap_priority: a.bootstrap_priority,
    })),
  })
}
