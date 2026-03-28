// src/app/api/assets/search/route.ts
/**
 * GET /api/assets/search?q=AAPL&limit=8
 * Returns matching assets for ticker autocomplete.
 * Searches ticker (exact prefix first) then name (contains).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const q     = req.nextUrl.searchParams.get('q')?.trim().toUpperCase() ?? ''
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '8'), 20)

  if (!q || q.length < 1) {
    return NextResponse.json({ assets: [] })
  }

  const db = createServiceClient()

  // Search ticker prefix first, then name contains — union ordered by ticker match
  const { data, error } = await (db
    .from('assets')
    .select('ticker, name, asset_type, sector')
    .eq('is_active', true)
    .or(`ticker.ilike.${q}%,name.ilike.%${q}%`)
    .order('ticker')
    .limit(limit) as any)

  if (error) {
    return NextResponse.json({ assets: [] }, { status: 500 })
  }

  // Sort: exact ticker match first, then prefix matches, then name matches
  const sorted = (data ?? []).sort((a: any, b: any) => {
    const aExact  = a.ticker === q ? 0 : a.ticker.startsWith(q) ? 1 : 2
    const bExact  = b.ticker === q ? 0 : b.ticker.startsWith(q) ? 1 : 2
    if (aExact !== bExact) return aExact - bExact
    return a.ticker.localeCompare(b.ticker)
  })

  return NextResponse.json({ assets: sorted })
}
