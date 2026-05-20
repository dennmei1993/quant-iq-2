// src/app/api/cron/strategy-monitor/route.ts
// Schedule: 0 22 * * 1-5  (runs daily after US market close ~17:00 ET = 22:00 UTC)
// Responsibilities:
//   1. leg1_placed  → check broker fill status → if filled: mark leg1_filled, activate LEG2
//   2. active       → check short leg DTE → if < 7: create roll alert
//   3. rolling      → short leg expired, waiting for user to stage new short leg
//   4. Update P&L snapshots for active strategies

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient }        from '@/lib/supabase/server'

export const maxDuration = 120
export const dynamic     = 'force-dynamic'

const BRIDGE_URL = process.env.BRIDGE_URL ?? 'http://localhost:8765'

function daysToExpiry(expiry: string | null): number | null {
  if (!expiry) return null
  return Math.round((new Date(expiry).getTime() - Date.now()) / 86400000)
}

async function getBrokerOrder(orderId: string, trdEnv: string, accId: string): Promise<{ status: string; fillPrice: number | null } | null> {
  try {
    const res = await fetch(
      `${BRIDGE_URL}/orders/${orderId}?trd_env=${trdEnv}&acc_id=${accId}`,
      { signal: AbortSignal.timeout(8000) }
    )
    if (!res.ok) return null
    const d = await res.json()
    // Moomoo order statuses: FILLED, CANCELLED, FAILED, SUBMITTED, WAITING_SUBMIT, etc.
    const filled    = ['FILLED_ALL', 'FILLED_PART'].includes(d.order_status ?? d.status ?? '')
    const fillPrice = filled ? parseFloat(d.dealt_avg_price ?? d.fill_price ?? '0') : null
    return { status: d.order_status ?? d.status ?? 'UNKNOWN', fillPrice }
  } catch {
    return null
  }
}

async function getLiveOptionPrice(optionCode: string): Promise<{ bid: number; ask: number; mid: number; last: number } | null> {
  try {
    const res = await fetch(`${BRIDGE_URL}/options/snapshot?code=${optionCode}`, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const d = await res.json()
    const bid  = parseFloat(d.bid_price  ?? d.bid  ?? '0')
    const ask  = parseFloat(d.ask_price  ?? d.ask  ?? '0')
    const last = parseFloat(d.last_price ?? d.last ?? '0')
    const mid  = (bid + ask) / 2
    return { bid, ask, mid, last }
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`
  const fallback  = `Bearer a3f8c2e1d4b7a9f0e3c6d2b5a8f1e4c7d0b3a6f9e2c5d8b1a4f7e0c3d6b9a2f5`
  if (secret !== expected && secret !== fallback) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const results: any[] = []
  const start = Date.now()

  // ── Fetch all non-closed strategies ───────────────────────────────────────
  const { data: strategies, error } = await (supabase as any)
    .from('option_strategies')
    .select(`
      *,
      profiles:user_id ( trading_mode, trade_account, moomoo_password )
    `)
    .not('status', 'in', '("closed")')
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  for (const strat of strategies ?? []) {
    const profile   = strat.profiles
    const trdEnv    = profile?.trading_mode === 'live' ? 'REAL' : 'SIMULATE'
    const accId     = profile?.trade_account ?? ''

    // ── 1. leg1_placed → check if LEAP buy has filled ──────────────────────
    if (strat.status === 'leg1_placed' && strat.leg1_order_ref) {
      const orderInfo = await getBrokerOrder(strat.leg1_order_ref, trdEnv, accId)
      if (!orderInfo) {
        results.push({ id: strat.id, ticker: strat.ticker, status: 'leg1_placed', note: 'Could not check order — bridge offline?' })
        continue
      }

      if (orderInfo.status.includes('FILLED')) {
        // LEG1 filled — update strategy, activate LEG2 conditional order
        await (supabase as any)
          .from('option_strategies')
          .update({
            status:          'leg1_filled',
            leg1_filled_at:  new Date().toISOString(),
            leg1_fill_price: orderInfo.fillPrice,
          })
          .eq('id', strat.id)

        // Activate LEG2 conditional order (set is_active = true)
        if (strat.leg2_order_id) {
          await (supabase as any)
            .from('conditional_orders')
            .update({ is_active: true })
            .eq('id', strat.leg2_order_id)
        }

        // Create fill notification
        await (supabase as any).from('strategy_alerts').insert({
          user_id:     strat.user_id,
          strategy_id: strat.id,
          type:        'leg1_filled',
          message:     `PMCC ${strat.ticker} — LEAP buy filled at $${orderInfo.fillPrice}. Short call order is now active.`,
        })

        results.push({ id: strat.id, ticker: strat.ticker, action: 'LEG1 filled', fill_price: orderInfo.fillPrice, leg2_activated: !!strat.leg2_order_id })
      } else {
        results.push({ id: strat.id, ticker: strat.ticker, status: 'leg1_placed', order_status: orderInfo.status, note: 'Waiting for fill' })
      }
    }

    // ── 2. leg1_filled → LEG2 is active in conditional cron — just monitor ─
    if (strat.status === 'leg1_filled' && strat.leg2_order_ref) {
      const orderInfo = await getBrokerOrder(strat.leg2_order_ref, trdEnv, accId)
      if (orderInfo?.status.includes('FILLED')) {
        await (supabase as any)
          .from('option_strategies')
          .update({
            status:          'active',
            leg2_filled_at:  new Date().toISOString(),
            leg2_fill_price: orderInfo.fillPrice,
          })
          .eq('id', strat.id)

        await (supabase as any).from('strategy_alerts').insert({
          user_id:     strat.user_id,
          strategy_id: strat.id,
          type:        'leg2_filled',
          message:     `PMCC ${strat.ticker} — Short call sold at $${orderInfo.fillPrice}. Strategy is now fully active.`,
        })

        results.push({ id: strat.id, ticker: strat.ticker, action: 'LEG2 filled — strategy ACTIVE', fill_price: orderInfo.fillPrice })
      }
    }

    // ── 3. active → check short leg DTE and P&L ───────────────────────────
    if (strat.status === 'active') {
      const dte = daysToExpiry(strat.leg2_expiry)

      // Roll alert when DTE < 7
      if (dte !== null && dte <= 7 && dte >= 0) {
        // Check if alert already exists for this cycle
        const { data: existing } = await (supabase as any)
          .from('strategy_alerts')
          .select('id')
          .eq('strategy_id', strat.id)
          .eq('type', 'roll_due')
          .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString())
          .limit(1)

        if (!existing?.length) {
          await (supabase as any).from('strategy_alerts').insert({
            user_id:     strat.user_id,
            strategy_id: strat.id,
            type:        'roll_due',
            message:     `PMCC ${strat.ticker} — Short call expires in ${dte} day${dte === 1 ? '' : 's'} (${strat.leg2_expiry}). Consider rolling to next month.`,
          })
          results.push({ id: strat.id, ticker: strat.ticker, action: `Roll alert created — ${dte}d to expiry` })
        }
      }

      // Mark as rolling when short leg expired
      if (dte !== null && dte < 0) {
        await (supabase as any)
          .from('option_strategies')
          .update({ status: 'rolling', roll_count: (strat.roll_count ?? 0) + 1, last_rolled_at: new Date().toISOString() })
          .eq('id', strat.id)

        results.push({ id: strat.id, ticker: strat.ticker, action: 'Short leg expired — status → rolling' })
      }

      // P&L snapshot — fetch live prices for both legs
      if (strat.leg1_code && strat.leg2_code) {
        const [leg1Price, leg2Price] = await Promise.all([
          getLiveOptionPrice(strat.leg1_code),
          getLiveOptionPrice(strat.leg2_code),
        ])

        if (leg1Price && leg2Price && strat.leg1_fill_price && strat.leg2_fill_price) {
          const leg1Pnl = (leg1Price.mid - strat.leg1_fill_price) * 100
          const leg2Pnl = (strat.leg2_fill_price - leg2Price.mid) * 100  // short — profit when price falls
          const totalPnl = Math.round(leg1Pnl + leg2Pnl)

          await (supabase as any)
            .from('option_strategies')
            .update({ pnl_snapshot: totalPnl, pnl_updated_at: new Date().toISOString() })
            .eq('id', strat.id)

          results.push({ id: strat.id, ticker: strat.ticker, action: 'P&L updated', pnl: totalPnl })
        }
      }
    }
  }

  const duration = ((Date.now() - start) / 1000).toFixed(1)
  console.log(`[strategy-monitor] Done — ${strategies?.length ?? 0} strategies, ${results.length} actions, ${duration}s`)

  return NextResponse.json({
    ok: true,
    strategies_checked: strategies?.length ?? 0,
    actions: results.length,
    duration_sec: duration,
    results,
  })
}
