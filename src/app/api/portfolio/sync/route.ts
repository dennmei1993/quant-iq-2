// src/app/api/portfolio/sync/route.ts
// POST /api/portfolio/sync?portfolio_id=
// Pulls live positions from broker bridge into portfolio holdings.
// Works if EITHER:
//   - portfolio has moomoo_linked = true (after migration), OR
//   - user's profile moomoo_account is set (before migration / fallback)

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

    // Verify portfolio ownership
    const { data: portfolio, error: pErr } = await supabase
      .from('portfolios')
      .select('id, name')
      .eq('id', portfolioId)
      .eq('user_id', user.id)
      .single()

    if (pErr || !portfolio) {
      return NextResponse.json({ error: 'Portfolio not found' }, { status: 404 })
    }

    // Check user has Moomoo configured
    const { data: profile } = await supabase
      .from('profiles')
      .select('moomoo_account')
      .eq('id', user.id)
      .single()

    if (!profile?.moomoo_account) {
      return NextResponse.json({
        ok:      false,
        synced:  0,
        message: 'No Moomoo account configured — go to Settings to add your account',
      })
    }

    // Call broker bridge — auto-detects real account via FUTUAU
    let positions: any[]
    let cash: number | null = null
    try {
      const res = await fetch(`${BRIDGE_URL}/account/positions`, {
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail ?? `Bridge returned ${res.status}`)
      }
      const data = await res.json()
      positions  = data.positions ?? []
      cash       = data.cash      ?? null
    } catch (e: any) {
      return NextResponse.json({
        ok:      false,
        synced:  0,
        message: `Broker sync failed: ${e.message}. Make sure broker bridge is running.`,
      }, { status: 503 })
    }

    if (!positions.length) {
      return NextResponse.json({
        ok:      true,
        synced:  0,
        message: 'No open positions in Moomoo account',
      })
    }

    // Upsert each position into holdings
    let synced = 0
    const errors: string[] = []

    for (const pos of positions) {
      const ticker = pos.ticker ?? (pos.symbol?.includes('.') ? pos.symbol.split('.')[1] : pos.symbol)
      if (!ticker) continue

      const { error: uErr } = await supabase
        .from('holdings')
        .upsert(
          {
            portfolio_id:    portfolioId,
            ticker:          ticker.toUpperCase(),
            quantity:        pos.qty,
            avg_cost:        pos.avg_cost,
            unrealised_gain: pos.unrealised_pnl ?? 0,
            realised_gain:   pos.realised_pnl   ?? 0,
            asset_type:      'equities',
            notes:           `Synced from Moomoo ${new Date().toISOString().slice(0, 10)}`,
          },
          { onConflict: 'portfolio_id,ticker' }
        )

      if (uErr) errors.push(`${ticker}: ${uErr.message}`)
      else synced++
    }

    // Remove holdings no longer in Moomoo positions (closed)
    const liveTickers = positions.map(p =>
      (p.ticker ?? (p.symbol?.includes('.') ? p.symbol.split('.')[1] : p.symbol))?.toUpperCase()
    ).filter(Boolean)

    if (liveTickers.length > 0) {
      await supabase
        .from('holdings')
        .delete()
        .eq('portfolio_id', portfolioId)
        .not('ticker', 'in', `(${liveTickers.map(t => `"${t}"`).join(',')})`)
    }

    // Update total_capital from real account value
    if (cash !== null) {
      const invested = positions.reduce((s: number, p: any) => s + (p.cost_basis ?? 0), 0)
      const total    = Math.round((cash + invested) * 100) / 100
      await supabase
        .from('portfolios')
        .update({ total_capital: total })
        .eq('id', portfolioId)
        .eq('user_id', user.id)
    }

    return NextResponse.json({
      ok:        errors.length === 0,
      synced,
      errors:    errors.length ? errors : undefined,
      cash,
      message:   `Synced ${synced} position${synced !== 1 ? 's' : ''} from Moomoo`,
      synced_at: new Date().toISOString(),
    })

  } catch (e) {
    const { body, status } = errorResponse(e)
    return NextResponse.json(body, { status })
  }
}
