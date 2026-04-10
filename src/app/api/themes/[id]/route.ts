// src/app/api/themes/[id]/route.ts
// Returns full theme detail for the home page inline panel
// Uses shared fetchThemeDetail from @/lib/themes

import { NextRequest, NextResponse } from 'next/server'
import { fetchThemeDetail } from '@/lib/themes'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { theme, signalMap } = await fetchThemeDetail(params.id)

  if (!theme) {
    return NextResponse.json({ error: 'Theme not found' }, { status: 404 })
  }

  // Merge signals into tickers for the client
  const tickers = theme.ticker_weights.map(t => ({
    ...t,
    ...(signalMap[t.ticker] ?? { signal: null, score: null, price_usd: null, change_pct: null }),
  }))

  return NextResponse.json({ theme, tickers })
}
