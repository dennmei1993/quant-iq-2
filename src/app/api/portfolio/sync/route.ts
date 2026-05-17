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

    // ── Bootstrap any holdings not yet in daily_prices ────────────────────────
    const engineUrl    = process.env.ENGINE_BOOTSTRAP_URL
    const engineSecret = process.env.ENGINE_CRON_SECRET
    if (engineUrl && engineSecret && liveTickers.length > 0) {
      try {
        // Find which tickers are missing or not bootstrapped
        const { data: assetRows } = await supabase
          .from('assets')
          .select('ticker, bootstrapped, asset_type')
          .in('ticker', liveTickers)

        const assetMap = Object.fromEntries((assetRows ?? []).map((a: any) => [a.ticker, a]))

        const toBootstrap = liveTickers.filter(t => !assetMap[t] || !assetMap[t].bootstrapped)

        if (toBootstrap.length > 0) {
          // Upsert missing tickers into assets first
          const missing = toBootstrap.filter(t => !assetMap[t])
          if (missing.length > 0) {
            await supabase
              .from('assets')
              .upsert(
                missing.map(t => ({
                  ticker:       t,
                  asset_type:   'stock',
                  is_active:    true,
                  bootstrapped: false,
                  name:         t,
                })),
                { onConflict: 'ticker', ignoreDuplicates: true }
              )
          }

          // Bootstrap each unbootstrapped ticker via engine — fire and forget
          const baseUrl = engineUrl.replace('/stocks', '')
          for (const t of toBootstrap) {
            const isEtf    = assetMap[t]?.asset_type === 'etf'
            const endpoint = isEtf ? `${baseUrl}/etf` : `${baseUrl}/stocks`
            fetch(`${endpoint}?ticker=${encodeURIComponent(t)}`, {
              headers: { Authorization: `Bearer ${engineSecret}` },
              signal:  AbortSignal.timeout(60_000),
            }).catch(() => {})
          }

          console.log(`[sync] Triggered bootstrap for: ${toBootstrap.join(', ')}`)
        }
      } catch (e: any) {
        console.warn('[sync] Bootstrap check failed:', e.message)
      }
    }

    // Fetch multi-currency buying power
    let fundsData: any = null
    try {
      const fundsRes = await fetch(`${BRIDGE_URL}/account/funds`, { signal: AbortSignal.timeout(8000) })
      if (fundsRes.ok) fundsData = await fundsRes.json()
    } catch {}

    // Update total_capital from real account value
    const totalVal = fundsData?.total_assets ?? (cash !== null ? cash + positions.reduce((s: number, p: any) => s + (p.cost_basis ?? 0), 0) : null)
    if (totalVal !== null) {
      await supabase.from('portfolios').update({ total_capital: Math.round(totalVal * 100) / 100 }).eq('id', portfolioId).eq('user_id', user.id)
    }

    return NextResponse.json({
      ok:        errors.length === 0,
      synced,
      errors:    errors.length ? errors : undefined,
      cash,
      funds:     fundsData ? {
        total_assets:  fundsData.total_assets,
        market_val:    fundsData.market_val,
        buying_power:  fundsData.buying_power,
        currencies:    fundsData.currencies,
        base_currency: fundsData.base_currency,
      } : null,
      message:   `Synced ${synced} position${synced !== 1 ? 's' : ''} from Moomoo`,
      synced_at: new Date().toISOString(),
    })

  } catch (e) {
    const { body, status } = errorResponse(e)
    return NextResponse.json(body, { status })
  }
}
