// src/app/api/themes/[id]/route.ts
// Returns full theme detail for the home page inline panel

import { NextRequest, NextResponse } from 'next/server'
import { fetchThemeDetail } from '@/lib/themes'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params

    if (!id) {
      return NextResponse.json({ error: 'Missing theme id' }, { status: 400 })
    }

    const { theme, signalMap } = await fetchThemeDetail(id)

    if (!theme) {
      return NextResponse.json({ error: 'Theme not found' }, { status: 404 })
    }

    const tickers = theme.ticker_weights.map(t => ({
      ...t,
      ...(signalMap[t.ticker] ?? { signal: null, score: null, price_usd: null, change_pct: null }),
    }))

    return NextResponse.json({ theme, tickers })

  } catch (e: any) {
    console.error('[api/themes/[id]]', e)
    return NextResponse.json(
      { error: e.message ?? 'Internal server error' },
      { status: 500 }
    )
  }
}
