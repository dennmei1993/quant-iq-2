// src/app/api/assets/search/route.ts
/**
 * GET /api/assets/search?q=AAPL&limit=8&asset_type=stock|etf
 * Returns matching assets ordered: ticker-match first, then name-match.
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

  // Query 1: ticker starts with q (highest priority)
  let tickerQuery = db
    .from('assets')
    .select('ticker, name, asset_type, sector')
    .eq('is_active', true)
    .ilike('ticker', `${q}%`)
    .order('ticker')
    .limit(limit)

  if (assetType) tickerQuery = (tickerQuery as any).eq('asset_type', assetType)

  // Query 2: name contains q (lower priority)
  let nameQuery = db
    .from('assets')
    .select('ticker, name, asset_type, sector')
    .eq('is_active', true)
    .ilike('name', `%${q}%`)
    .order('ticker')
    .limit(limit)

  if (assetType) nameQuery = (nameQuery as any).eq('asset_type', assetType)

  const [tickerRes, nameRes] = await Promise.all([
    tickerQuery as any,
    nameQuery   as any,
  ])

  const tickerHits: any[] = tickerRes.data ?? []
  const nameHits:   any[] = nameRes.data   ?? []

  // Merge: ticker hits first, then name-only hits (deduplicated)
  const seen   = new Set(tickerHits.map(a => a.ticker))
  const merged = [
    ...tickerHits,
    ...nameHits.filter(a => !seen.has(a.ticker)),
  ].slice(0, limit)

  return NextResponse.json({ assets: merged })
}
