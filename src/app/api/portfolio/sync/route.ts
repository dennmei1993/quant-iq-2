// src/app/api/portfolio/sync/route.ts
// POST /api/portfolio/sync?portfolio_id=
// Pulls live positions from the broker bridge and upserts them
// into the holdings table. No-op if moomoo_account is NULL.

import { NextRequest, NextResponse } from 'next/server'
import { requireUser, errorResponse } from '@/lib/supabase'

const BRIDGE_URL = process.env.BROKER_BRIDGE_URL ?? 'http://127.0.0.1:8765'

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const portfolioId = req.nextUrl.searchParams.get('portfolio_id')

    if (!portfolioId) {
      return NextResponse.json({ error: 'portfolio_id required' }, { status: 400 })
    }

    // Fetch portfolio — verify ownership and check moomoo_account
    const { data: portfolio, error: pErr } = await supabase
      .from('portfolios')
      .select('id, name, moomoo_account, moomoo_password')
      .eq('id', portfolioId)
      .eq('user_id', user.id)
      .single()

    if (pErr || !portfolio) {
      return NextResponse.json({ error: 'Portfolio not found' }, { status: 404 })
    }

    // No integration if account is not set
    if (!portfolio.moomoo_account) {
      return NextResponse.json({
        ok:      false,
        synced:  0,
        message: 'No Moomoo account linked to this portfolio — skipping sync',
      })
    }

    // Call broker bridge for live positions
    let positions: any[]
    try {
      const res = await fetch(`${BRIDGE_URL}/positions`, {
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) throw new Error(`Bridge returned ${res.status}`)
      const data = await res.json()
      positions  = data.positions ?? []
    } catch (e: any) {
      return NextResponse.json({
        ok:      false,
        synced:  0,
        message: `Broker bridge unreachable: ${e.message}. Make sure broker_service.py is running.`,
      }, { status: 503 })
    }

    if (!positions.length) {
      return NextResponse.json({
        ok:     true,
        synced: 0,
        message: 'Broker has no open positions — nothing to sync',
      })
    }

    // Upsert each position into holdings
    // Uses ticker as the natural key per portfolio
    let synced = 0
    const errors: string[] = []

    for (const pos of positions) {
      // Strip market prefix — "US.AAPL" → "AAPL"
      const ticker = pos.symbol.includes('.') ? pos.symbol.split('.')[1] : pos.symbol

      const { error: uErr } = await supabase
        .from('holdings')
        .upsert(
          {
            portfolio_id: portfolioId,
            ticker,
            quantity:     pos.qty,
            avg_cost:     pos.avg_cost,
            name:         null,   // enriched separately by the signal fetch
            asset_type:   'equities',
            notes:        `Synced from Moomoo ${new Date().toISOString()}`,
          },
          { onConflict: 'portfolio_id,ticker' }
        )

      if (uErr) {
        errors.push(`${ticker}: ${uErr.message}`)
      } else {
        synced++
      }
    }

    // Remove holdings that are no longer in broker positions
    // (position was closed in Moomoo)
    const syncedTickers = positions.map(p =>
      p.symbol.includes('.') ? p.symbol.split('.')[1] : p.symbol
    )

    await supabase
      .from('holdings')
      .delete()
      .eq('portfolio_id', portfolioId)
      .not('ticker', 'in', `(${syncedTickers.map(t => `"${t}"`).join(',')})`)

    return NextResponse.json({
      ok:      errors.length === 0,
      synced,
      removed: positions.length - synced,
      errors:  errors.length ? errors : undefined,
      message: `Synced ${synced} position${synced !== 1 ? 's' : ''} from Moomoo`,
      synced_at: new Date().toISOString(),
    })

  } catch (e) {
    const { body, status } = errorResponse(e)
    return NextResponse.json(body, { status })
  }
}
