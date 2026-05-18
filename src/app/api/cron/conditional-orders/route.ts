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

// ── MACD helpers ──────────────────────────────────────────────────────────────

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1)
  const result: number[] = []
  let prev = values[0]
  result.push(prev)
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k)
    result.push(prev)
  }
  return result
}

function calcMACD(closes: number[]): { macd: number; signal: number; hist: number } | null {
  if (closes.length < 35) return null  // need at least 26 + 9 candles
  const fast   = ema(closes, 12)
  const slow   = ema(closes, 26)
  const macdLine = fast.map((f, i) => f - slow[i])
  const signalLine = ema(macdLine.slice(25), 9)  // signal starts after 26 periods
  const last   = signalLine.length - 1
  return {
    macd:   macdLine[macdLine.length - 1],
    signal: signalLine[last],
    hist:   macdLine[macdLine.length - 1] - signalLine[last],
  }
}

function calcMACDCross(closes: number[]): { isBullish: boolean; isBearish: boolean; macd: number; signal: number } | null {
  if (closes.length < 36) return null
  const prev = calcMACD(closes.slice(0, -1))
  const curr = calcMACD(closes)
  if (!prev || !curr) return null
  return {
    isBullish: prev.macd < prev.signal && curr.macd > curr.signal,  // crossed above
    isBearish: prev.macd > prev.signal && curr.macd < curr.signal,  // crossed below
    macd:   curr.macd,
    signal: curr.signal,
  }
}

// Fetch intraday candles from bridge and return closes
async function fetchIntradayCloses(ticker: string, period: '1h' | '4h' | '1d', bridgeUrl: string): Promise<number[]> {
  // Map period to kline type for Moomoo
  const klType = period === '1h' ? '60M' : period === '4h' ? '4H' : 'DAY'
  const count  = 50  // enough candles for MACD (need 35+)
  const res = await fetch(
    `${bridgeUrl}/kline?symbol=US.${ticker}&kl_type=${klType}&count=${count}`,
    { signal: AbortSignal.timeout(8000) }
  )
  if (!res.ok) throw new Error(`Kline fetch failed: ${res.status}`)
  const d = await res.json()
  // Bridge returns { klines: [{close, ...}] } sorted oldest first
  return (d.klines ?? []).map((k: any) => parseFloat(k.close)).filter((c: number) => !isNaN(c))
}

// Parse MACD params from order notes
// Notes format: "DCA #N — MACD bullish cross on 1h · ..."
function parseMACDNote(notes: string | null): { type: 'bullish' | 'bearish'; period: '1h' | '4h' | '1d' } | null {
  if (!notes) return null
  const match = notes.match(/MACD (bullish|bearish) cross on (1h|4h|1d)/i)
  if (!match) return null
  return { type: match[1].toLowerCase() as 'bullish' | 'bearish', period: match[2] as '1h' | '4h' | '1d' }
}
  // Verify cron secret
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  // TODO: re-enable after testing
  // if (!isMarketHours()) {
  //   return NextResponse.json({ skipped: true, reason: 'Outside market hours', et_time: getETTime() })
  // }

  const supabase = createServiceClient()
  const now = new Date().toISOString()
  const etTime = getETTime()

  // Fetch all active non-expired orders
  const { data: orders, error } = await (supabase as any)
    .from('conditional_orders')
    .select('*')
    .eq('status', 'active')
    .or(`expires_at.is.null,expires_at.gt.${now}`)

  if (error) return NextResponse.json({ error: error.message, stage: 'fetch_orders' }, { status: 500 })
  if (!orders?.length) return NextResponse.json({ checked: 0, executed: 0, debug: 'No active orders found' })

  // Fetch user profiles separately (service role bypasses RLS)
  const userIds = [...new Set((orders as any[]).map((o: any) => o.user_id))]
  const { data: profiles } = await (supabase as any)
    .from('profiles')
    .select('id, moomoo_password, trading_mode, trade_account')
    .in('id', userIds)

  const profileMap: Record<string, any> = {}
  for (const p of (profiles ?? [])) profileMap[p.id] = p

  // Attach profile to each order
  const ordersWithProfiles = (orders as any[]).map((o: any) => ({
    ...o,
    profile: profileMap[o.user_id] ?? {},
  }))

  // Get unique tickers to fetch prices
  const tickers = [...new Set((orders as any[]).map((o: any) => o.ticker))]
  const priceMap: Record<string, number> = {}
  const priceDebug: Record<string, string> = {}

  await Promise.allSettled(tickers.map(async (ticker) => {
    try {
      const res = await fetch(`${BRIDGE_URL}/options/volatility?symbol=US.${ticker}`, {
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) {
        const d = await res.json()
        if (d.last_price) {
          priceMap[ticker] = d.last_price
          priceDebug[ticker] = `$${d.last_price}`
        } else {
          priceDebug[ticker] = 'no price returned'
        }
      } else {
        priceDebug[ticker] = `bridge HTTP ${res.status}`
      }
    } catch (e: any) {
      priceDebug[ticker] = `bridge error: ${e.message}`
    }
  }))

  let executed = 0
  const results: any[] = []

  for (const order of ordersWithProfiles) {
    const price = priceMap[order.ticker]
    if (price === undefined) {
      results.push({ id: order.id, ticker: order.ticker, skip: `no price available — bridge may be offline` })
      continue
    }

    // Update last_checked_at and last_price_seen
    await (supabase as any)
      .from('conditional_orders')
      .update({ last_checked_at: now, last_price_seen: price })
      .eq('id', order.id)

    // ── Evaluate conditions ────────────────────────────────────────────────────

    // TODO: re-enable time gate after testing
    // if (order.not_before_time) {
    //   const orderMins   = timeToMinutes(order.not_before_time)
    //   const currentMins = timeToMinutes(etTime)
    //   if (currentMins < orderMins) {
    //     results.push({ id: order.id, ticker: order.ticker, skip: `waiting for ${order.not_before_time} ET (now ${etTime})` })
    //     continue
    //   }
    // }

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

    // 4. MACD condition — parse from notes field
    const macdParams = parseMACDNote(order.notes)
    if (macdParams) {
      try {
        const closes = await fetchIntradayCloses(order.ticker, macdParams.period, BRIDGE_URL)
        const cross  = calcMACDCross(closes)

        if (!cross) {
          results.push({ id: order.id, ticker: order.ticker, skip: `MACD: not enough candles (got ${closes.length}, need 36)` })
          continue
        }

        const triggered = macdParams.type === 'bullish' ? cross.isBullish : cross.isBearish

        if (!triggered) {
          results.push({
            id:     order.id,
            ticker: order.ticker,
            skip:   `MACD ${macdParams.type} cross not detected (MACD ${cross.macd.toFixed(4)} vs Signal ${cross.signal.toFixed(4)})`,
            macd:   cross.macd.toFixed(4),
            signal: cross.signal.toFixed(4),
          })
          continue
        }

        // Log MACD trigger
        results.push({
          id:      order.id,
          ticker:  order.ticker,
          macd_trigger: `MACD ${macdParams.type} cross on ${macdParams.period} — MACD ${cross.macd.toFixed(4)} crossed ${macdParams.type === 'bullish' ? 'above' : 'below'} Signal ${cross.signal.toFixed(4)}`,
        })
      } catch (e: any) {
        results.push({ id: order.id, ticker: order.ticker, skip: `MACD fetch failed: ${e.message}` })
        continue
      }
    }

    // ── All conditions met — execute order ────────────────────────────────────
    try {
      const profile = order.profile
      const tradePwd = profile?.moomoo_password ?? ''
      const tradeAccount = profile?.trade_account ?? ''
      const tradingMode = profile?.trading_mode ?? 'paper'

      // Log what we're about to execute
      results.push({
        id:           order.id,
        ticker:       order.ticker,
        conditions:   'ALL MET',
        price:        price,
        side:         order.side,
        qty:          order.qty,
        order_type:   order.order_type,
        account:      tradeAccount,
        trading_mode: tradingMode,
        status:       'EXECUTING...',
      })

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
        // Mark as triggered — prevents re-execution
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

        // Update result with success
        const idx = results.findIndex(r => r.id === order.id)
        if (idx >= 0) results[idx] = { ...results[idx], status: 'EXECUTED', order_id: execData.order_id, account: execData.account, trd_env: execData.trd_env, price: execData.price }
        executed++
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
    checked:    orders.length,
    executed,
    et_time:    etTime,
    prices:     priceDebug,
    results,
  })
}
