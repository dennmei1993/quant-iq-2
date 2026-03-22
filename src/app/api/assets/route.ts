// src/app/api/assets/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const assetType = searchParams.get('type')   // stock | etf | crypto | commodity
  const signal    = searchParams.get('signal') // buy | watch | hold | avoid

  // Get assets with their latest signal
  let query = supabase
    .from('assets')
    .select(`
      id, ticker, name, asset_type, sector,
      asset_signals (
        signal, score, rationale, scored_at, theme_id
      )
    `)
    .eq('is_active', true)
    .order('ticker')

  if (assetType) query = query.eq('asset_type', assetType)

  const { data: assets, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Keep only latest signal per asset, optionally filter by signal type
  const enriched = (assets ?? [])
    .map(asset => {
      const signals = (asset.asset_signals as any[]) ?? []
      const latest = signals.sort((a, b) =>
        new Date(b.scored_at).getTime() - new Date(a.scored_at).getTime()
      )[0] ?? null
      return { ...asset, asset_signals: undefined, latest_signal: latest }
    })
    .filter(a => !signal || a.latest_signal?.signal === signal)
    .sort((a, b) => (b.latest_signal?.score ?? 0) - (a.latest_signal?.score ?? 0))

  return NextResponse.json({ assets: enriched })
}
