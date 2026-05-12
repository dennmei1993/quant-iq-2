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

    // Fetch portfolio — verify ownership and check moomoo_linked
    const { data: portfolio, error: pErr } = await supabase
      .from('portfolios')
      .select('id, name, moomoo_linked')
      .eq('id', portfolioId)
      .eq('user_id', user.id)
      .single()

    if (pErr || !portfolio) {
      return NextResponse.json({ error: 'Portfolio not found' }, { status: 404 })
    }

    if (!portfolio.moomoo_linked) {
      return NextResponse.json({
        ok:      false,
        synced:  0,
        message: 'This portfolio is not linked to Moomoo — go to Settings to link it',
      })
    }

    // Fetch Moomoo credentials from user profile
    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('moomoo_account, moomoo_password')
      .eq('id', user.id)
      .single()

    if (profErr || !profile?.moomoo_account) {
      return NextResponse.json({
        ok:      false,
        synced:  0,
        message: 'No Moomoo account configured — go to Settings to add your account',
      })
    }

    // Use profile credentials
    const moomooAccount  = profile.moomoo_account
    const moomooPassword = profile.moomoo_password

    // Call broker bridge — real account positions
    let positions: any[]
    let cash: number | null = null
    try {
      const params = new URLSearchParams({
        account: moomooAccount,
        env:     'real',
      })
      if (moomooPassword) params.set('pwd', moomooPassword)

      const res = await fetch(`${BRIDGE_URL}/account/positions?${params}`, {
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail ?? `Bridge returned ${res.status}`)
      }
      const data = await res.json()
      positions  = data.positions ?? []
      cash       = data.cash ?? null
    } catch (e: any) {
      return NextResponse.json({
        ok:      false,
        synced:  0,
        message: `Broker sync failed: ${e.message}`,
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

    // Optionally update total_capital from real account value
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
      message:   `Synced ${synced} position${synced !== 1 ? 's' : ''} from Moomoo account ${moomooAccount}`,
      synced_at: new Date().toISOString(),
    })

  } catch (e) {
    const { body, status } = errorResponse(e)
    return NextResponse.json(body, { status })
  }
}
