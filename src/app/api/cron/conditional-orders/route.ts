// src/app/api/cron/conditional-orders/route.ts
// Runs every minute during US market hours (via Vercel cron)
// Checks active conditional orders and executes when conditions met

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

const BRIDGE_URL = process.env.BROKER_BRIDGE_URL ?? 'http://127.0.0.1:8765'

// US Eastern time helpers
function getETHour(): number {
  const now = new Date()
  const et = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(now)
  const h = parseInt(et.find(p => p.type === 'hour')?.value ?? '0')
  return h
}

function getETTime(): string {
  const now = new Date()
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(now)
}

function isMarketHours(): boolean {
  const now = new Date()
  const day = now.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short' })
  if (['Sat', 'Sun'].includes(day)) return false
  const time = getETTime()
  return time >= '09:30' && time <= '16:00'
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

export async function GET(req: NextRequest) {
  // Verify cron secret
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  // TODO: re-enable market hours check after testing
  // if (!isMarketHours()) {
  //   return NextResponse.json({ skipped: true, reason: 'Outside market hours', et_time: getETTime() })
  // }

  const supabase = createServiceClient()
  const now = new Date().toISOString()
  const etTime = getETTime()

  // Fetch all active conditional orders
  const { data: orders, error } = await (supabase as any)
    .from('conditional_orders')
    .select('*, profiles!inner(moomoo_password, trading_mode, trade_account)')
    .eq('status', 'active')
    .or(`expires_at.is.null,expires_at.gt.${now}`)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!orders?.length) return NextResponse.json({ checked: 0, executed: 0 })

  // Get unique tickers to fetch prices
  const tickers = [...new Set((orders as any[]).map((o: any) => o.ticker))]
  const priceMap: Record<string, number> = {}

  await Promise.allSettled(tickers.map(async (ticker) => {
    try {
      const res = await fetch(`${BRIDGE_URL}/options/volatility?symbol=US.${ticker}`, {
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) {
        const d = await res.json()
        if (d.last_price) priceMap[ticker] = d.last_price
      }
    } catch {}
  }))

  let executed = 0
  const results: any[] = []

  for (const order of orders as any[]) {
    const price = priceMap[order.ticker]
    if (price === undefined) continue

    // Update last_checked_at and last_price_seen
    await (supabase as any)
      .from('conditional_orders')
      .update({ last_checked_at: now, last_price_seen: price })
      .eq('id', order.id)

    // ── Evaluate conditions ────────────────────────────────────────────────────

    // 1. Time gate — must be after not_before_time ET
    if (order.not_before_time) {
      const orderMins  = timeToMinutes(order.not_before_time)
      const currentMins = timeToMinutes(etTime)
      if (currentMins < orderMins) {
        results.push({ id: order.id, ticker: order.ticker, skip: `waiting for ${order.not_before_time} ET (now ${etTime})` })
        continue
      }
    }

    // 2. Date gate
    if (order.not_before_date) {
      const today = new Date().toISOString().slice(0, 10)
      if (today < order.not_before_date) {
        results.push({ id: order.id, ticker: order.ticker, skip: `not before ${order.not_before_date}` })
        continue
      }
    }

    // 3. Price conditions
    if (order.price_above !== null && price <= order.price_above) {
      results.push({ id: order.id, ticker: order.ticker, skip: `price ${price} not above ${order.price_above}` })
      continue
    }
    if (order.price_below !== null && price >= order.price_below) {
      results.push({ id: order.id, ticker: order.ticker, skip: `price ${price} not below ${order.price_below}` })
      continue
    }

    // ── All conditions met — execute order ────────────────────────────────────
    try {
      const profile = order.profiles
      const tradePwd = profile?.moomoo_password ?? ''
      const tradeAccount = profile?.trade_account ?? ''
      const tradingMode = profile?.trading_mode ?? 'paper'

      const orderBody: any = {
        symbol:       order.option_code ?? `US.${order.ticker}`,
        side:         order.side,
        qty:          order.qty,
        order_type:   order.order_type,
        trade_pwd:    tradePwd,
        account_id:   tradeAccount,
        trading_mode: tradingMode,
      }
      if (order.order_type === 'LIMIT' && order.limit_price) {
        orderBody.limit_price = order.limit_price
      }

      const endpoint = order.asset_type === 'option' ? '/options/order' : '/orders/moomoo'
      const execRes = await fetch(`${BRIDGE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderBody),
        signal: AbortSignal.timeout(10000),
      })

      const execData = await execRes.json()

      if (execRes.ok && execData.order_id) {
        // Mark as triggered
        await (supabase as any)
          .from('conditional_orders')
          .update({
            status:            'triggered',
            triggered_at:      now,
            executed_order_id: execData.order_id,
            updated_at:        now,
          })
          .eq('id', order.id)

        // Save to broker_orders
        await (supabase as any)
          .from('broker_orders')
          .upsert({
            user_id:    order.user_id,
            order_id:   execData.order_id,
            ticker:     order.ticker,
            side:       order.side,
            qty:        order.qty,
            price:      execData.price ?? order.limit_price,
            order_type: order.order_type,
            status:     'PLACED',
            account:    execData.account,
            trd_env:    execData.trd_env,
          }, { onConflict: 'order_id' })

        executed++
        results.push({ id: order.id, ticker: order.ticker, executed: true, order_id: execData.order_id, price_at_execution: price })
      } else {
        await (supabase as any)
          .from('conditional_orders')
          .update({ status: 'failed', fail_reason: execData.detail ?? 'Execution failed', updated_at: now })
          .eq('id', order.id)
        results.push({ id: order.id, ticker: order.ticker, failed: true, reason: execData.detail })
      }
    } catch (e: any) {
      await (supabase as any)
        .from('conditional_orders')
        .update({ status: 'failed', fail_reason: e.message, updated_at: now })
        .eq('id', order.id)
      results.push({ id: order.id, ticker: order.ticker, failed: true, reason: e.message })
    }
  }

  return NextResponse.json({
    checked:  orders.length,
    executed,
    et_time:  etTime,
    results,
  })
}
