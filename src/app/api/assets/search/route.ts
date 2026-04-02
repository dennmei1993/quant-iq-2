// src/app/api/assets/search/route.ts
/**
 * GET /api/assets/search?q=AAPL&limit=8&asset_type=stock|etf
 * Returns matching assets for ticker autocomplete.
 * Optional asset_type filter: stock, etf, crypto, commodity
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const q         = req.nextUrl.searchParams.get('q')?.trim().toUpperCase() ?? ''
  const limit     = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '8'), 20)
  const assetType = req.nextUrl.searchParams.get('asset_type') ?? ''

  if (!q || q.length < 1) {
    return NextResponse.json({ assets: [] })
  }

  const db = createServiceClient()

  let query = db
    .from('assets')
    .select('ticker, name, asset_type, sector')
    .eq('is_active', true)
    .or(`ticker.ilike.${q}%,name.ilike.%${q}%`)
    .order('ticker')
    .limit(limit)

  if (assetType) {
    query = (query as any).eq('asset_type', assetType)
  }

  const { data, error } = await (query as any)

  if (error) {
    return NextResponse.json({ assets: [] }, { status: 500 })
  }

  return NextResponse.json({ assets: data ?? [] })
}
