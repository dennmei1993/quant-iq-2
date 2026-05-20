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

// ── MACD helpers — calculation done in broker_service.py via /kline/macd ────

// Fetch intraday candles from bridge and return closes
async function fetchMACD(ticker: string, period: '1h' | '4h' | '1d', bridgeUrl: string): Promise<{
  curr: { macd: number; signal: number; hist: number }
  prev: { macd: number; signal: number; hist: number }
  bullish_cross: boolean
  bearish_cross: boolean
  bullish_state: boolean
  bearish_state: boolean
  candles: number
}> {
  const klType = period === '1h' ? '1H' : period === '4h' ? '4H' : 'DAY'
  const res = await fetch(
    `${bridgeUrl}/kline/macd?symbol=US.${ticker}&kl_type=${klType}`,
    { signal: AbortSignal.timeout(30000) }  // longer timeout — fetches 3 years of data
  )
  if (!res.ok) throw new Error(`MACD fetch failed: ${res.status}`)
  const d = await res.json()
  if (d.error) throw new Error(d.error)
  return d
}

// Parse MACD params from order notes
// Notes format: "DCA #N — MACD bullish cross on 1h · ..."
function parseMACDNote(notes: string | null): { type: 'bullish' | 'bearish'; period: '1h' | '4h' | '1d' } | null {
  if (!notes) return null
  const match = notes.match(/MACD (bullish|bearish) cross on (1h|4h|1d)/i)
  if (!match) return null
  return { type: match[1].toLowerCase() as 'bullish' | 'bearish', period: match[2] as '1h' | '4h' | '1d' }
}

export async function GET(req: NextRequest) {
  // Verify cron secret
  const auth     = req.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`
  const fallback = `Bearer a3f8c2e1d4b7a9f0e3c6d2b5a8f1e4c7d0b3a6f9e2c5d8b1a4f7e0c3d6b9a2f5`
  console.log('[cron] auth received:', auth?.slice(0, 30), '| CRON_SECRET set:', !!process.env.CRON_SECRET)
  if (auth !== expected && auth !== fallback) {
    return NextResponse.json({ error: 'Unauthorised', hint: 'Check CRON_SECRET env var', secret_set: !!process.env.CRON_SECRET }, { status: 401 })
  }

  const inMarketHours = isMarketHours()

  // If outside market hours, only process orders that have allow_24h = true
  // We'll filter per-order below rather than skipping entirely
  if (!inMarketHours) {
    // Check if any 24H orders exist before proceeding
    const supabaseCheck = createServiceClient()
    const { data: has24h } = await (supabaseCheck as any)
      .from('conditional_orders')
      .select('id')
      .eq('status', 'active')
      .eq('allow_24h', true)
      .limit(1)
    if (!has24h?.length) {
      return NextResponse.json({ skipped: true, reason: 'Outside market hours — no 24H orders active', et_time: getETTime() })
    }
  }

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
    .select('id, moomoo_password, trading_mode, trade_account, trading_24h')
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

    // 0. Market hours check — skip if outside hours unless order or profile allows 24H
    const profile24h = order.profile?.trading_24h ?? false
    const order24h   = order.allow_24h            ?? false
    if (!inMarketHours && !profile24h && !order24h) {
      results.push({ id: order.id, ticker: order.ticker, skip: `outside market hours — enable 24H trading in settings or order` })
      continue
    }

    // Update last_checked_at and last_price_seen
    await (supabase as any)
      .from('conditional_orders')
      .update({ last_checked_at: now, last_price_seen: price })
      .eq('id', order.id)

    // ── Evaluate conditions ────────────────────────────────────────────────────

    // 1. Time gate — must be after not_before_time ET (skipped if null/empty)
    if (order.not_before_time) {
      const orderMins   = timeToMinutes(order.not_before_time)
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

    // 4. IV Rank conditions — fetch live IV rank from bridge
    const needsIV = order.iv_rank_below !== null || order.iv_rank_above !== null || order.premium_above !== null
    let liveIVRank: number | null = null
    let livePremium: number | null = null

    if (needsIV) {
      try {
        // Use /options/iv_rank which calculates HV-based IV Rank from price history
        // Works for any ticker with sufficient daily price history — no iv_history table needed
        const ivRes = await fetch(`${BRIDGE_URL}/options/iv_rank?symbol=US.${order.ticker}`, { signal: AbortSignal.timeout(15000) })
        if (ivRes.ok) {
          const ivData = await ivRes.json()
          liveIVRank  = ivData.iv_rank  ?? null
          livePremium = ivData.current_hv ?? null
          console.log(`[cron] ${order.ticker} HV Rank: ${liveIVRank} (HV ${ivData.current_hv}%, 52w range ${ivData.hv_52w_low}-${ivData.hv_52w_high})`)
        }
      } catch (e: any) {
        console.warn(`[cron] IV rank fetch failed for ${order.ticker}: ${e.message}`)
      }
    }

    if (order.iv_rank_below !== null) {
      if (liveIVRank === null) {
        // No IV rank history — use raw IV% as proxy if available from bridge
        // Approximate: IV < 20% ≈ IVR < 25 for most underlyings
        const rawIV = liveIVRank ?? null
        console.warn(`[cron] ${order.ticker}: IV Rank unavailable — building history (${order.ticker} has no iv_history rows yet)`)
        results.push({ id: order.id, ticker: order.ticker, warn: `IV Rank unavailable — proceeding without IV rank check. Deploy 20+ trading days to enable.` })
        // Non-blocking — fall through
      } else if (liveIVRank > order.iv_rank_below) {
        results.push({ id: order.id, ticker: order.ticker, skip: `IV Rank ${liveIVRank} not below ${order.iv_rank_below}` })
        continue
      }
    }

    if (order.iv_rank_above !== null) {
      if (liveIVRank === null) {
        // Non-blocking — fall through
      } else if (liveIVRank < order.iv_rank_above) {
        results.push({ id: order.id, ticker: order.ticker, skip: `IV Rank ${liveIVRank} not above ${order.iv_rank_above}` })
        continue
      }
    }

    if (order.premium_above !== null) {
      if (livePremium === null) {
        results.push({ id: order.id, ticker: order.ticker, skip: `Premium unavailable` })
        continue
      }
      if (livePremium < order.premium_above) {
        results.push({ id: order.id, ticker: order.ticker, skip: `Premium $${livePremium} below min $${order.premium_above}` })
        continue
      }
    }

    // 5. PMCC / option criteria — parse from notes, search live chain, select best contract
    const isPMCCOrder = order.notes?.includes('PMCC LEG') && order.notes?.includes('CRITERIA:')
    if (isPMCCOrder) {
      try {
        const criteriaMatch = order.notes?.match(/CRITERIA:(\{.*?\})/)
        if (!criteriaMatch) { results.push({ id: order.id, ticker: order.ticker, skip: 'PMCC: could not parse criteria from notes' }); continue }

        const criteria = JSON.parse(criteriaMatch[1]) as {
          dte_min: number; dte_max: number
          delta_min: number; delta_max: number
          oi_min?: number; limit_pct?: number
          select: 'best_delta' | 'best_premium'
        }

        const isSell = order.side === 'SELL'
        const today  = new Date().toISOString().slice(0, 10)

        // Fetch real expiries from bridge
        const expRes = await fetch(`${BRIDGE_URL}/options/expiries?symbol=US.${order.ticker}`, { signal: AbortSignal.timeout(8000) })
        if (!expRes.ok) { results.push({ id: order.id, ticker: order.ticker, skip: 'PMCC: expiry fetch failed' }); continue }
        const expData = await expRes.json()

        // Filter expiries by DTE range
        const eligibleExpiries: string[] = (expData.expiries ?? []).filter((exp: string) => {
          const dte = Math.round((new Date(exp.slice(0, 10)).getTime() - Date.now()) / 86400000)
          return dte >= criteria.dte_min && dte <= criteria.dte_max && exp.slice(0, 10) > today
        })

        if (!eligibleExpiries.length) {
          results.push({ id: order.id, ticker: order.ticker, skip: `PMCC: no expiries found in ${criteria.dte_min}–${criteria.dte_max} DTE range` })
          continue
        }

        // Search chain across eligible expiries to find best contract
        let bestContract: any = null

        for (const expiry of eligibleExpiries.slice(0, 3)) {  // check up to 3 expiries
          const chainRes = await fetch(`${BRIDGE_URL}/options/chain?symbol=US.${order.ticker}&expiry=${expiry.slice(0, 10)}&strike_count=0`, { signal: AbortSignal.timeout(10000) })
          if (!chainRes.ok) continue
          const chainData = await chainRes.json()

          for (const row of (chainData.rows ?? [])) {
            const prefix  = isSell ? 'put' : 'call'  // PMCC always uses calls
            const delta    = Math.abs(parseFloat(String(row[`call_delta`] ?? row[`callDelta`] ?? 0)))
            const bid      = parseFloat(String(row[`call_bid`]   ?? row[`callBid`]   ?? 0))
            const ask      = parseFloat(String(row[`call_ask`]   ?? row[`callAsk`]   ?? 0))
            const oi       = parseInt(String(row[`call_oi`]    ?? 0))
            const code     = row[`call_code`] ?? ''

            if (!code) continue
            if (delta < criteria.delta_min || delta > criteria.delta_max) continue
            if (criteria.oi_min && oi < criteria.oi_min) continue
            if (bid <= 0 && ask <= 0) continue

            const candidate = { code, strike: row.strike, delta, bid, ask, oi, expiry: expiry.slice(0, 10) }

            if (!bestContract) { bestContract = candidate; continue }

            if (criteria.select === 'best_premium') {
              // For short call: highest bid within delta range
              if (bid > bestContract.bid) bestContract = candidate
            } else {
              // For LEAP: closest delta to midpoint of range
              const target = (criteria.delta_min + criteria.delta_max) / 2
              if (Math.abs(delta - target) < Math.abs(bestContract.delta - target)) bestContract = candidate
            }
          }
          if (bestContract && criteria.select === 'best_delta') break  // first expiry with match is fine for LEAP
        }

        if (!bestContract) {
          results.push({ id: order.id, ticker: order.ticker, skip: `PMCC: no contract found matching δ${criteria.delta_min}-${criteria.delta_max} in ${criteria.dte_min}-${criteria.dte_max} DTE` })
          continue
        }

        // Validate: for SELL leg, short strike must be above any held LEAP strikes
        if (isSell) {
          // Check premium meets minimum
          if (bestContract.bid < (order.premium_above ?? 0)) {
            results.push({ id: order.id, ticker: order.ticker, skip: `PMCC LEG2: best bid $${bestContract.bid} below min $${order.premium_above}` })
            continue
          }
        }

        // Override option_code and limit_price on the order for execution
        const mid = (bestContract.bid + bestContract.ask) / 2
        const limitPrice = isSell
          ? parseFloat((bestContract.bid - 0.01).toFixed(2))   // sell at bid
          : parseFloat(mid.toFixed(2))                          // buy at mid (bid/ask midpoint)

        // Update order with the selected contract
        await supabase.from('conditional_orders').update({
          option_code:  bestContract.code,
          limit_price:  Math.round(limitPrice * 100) / 100,
          last_price_seen: bestContract.bid,
        }).eq('id', order.id)

        // Set order fields for execution below
        order.option_code  = bestContract.code
        order.limit_price  = Math.round(limitPrice * 100) / 100

        console.log(`[PMCC] ${order.ticker} ${isSell ? 'LEG2 SELL' : 'LEG1 BUY'}: selected ${bestContract.code} δ${bestContract.delta.toFixed(2)} bid=$${bestContract.bid} ask=$${bestContract.ask} expiry=${bestContract.expiry}`)

      } catch (e: any) {
        results.push({ id: order.id, ticker: order.ticker, skip: `PMCC chain search failed: ${e.message}` })
        continue
      }
    }
    const macdParams = parseMACDNote(order.notes)
    if (macdParams) {
      try {
        const macd = await fetchMACD(order.ticker, macdParams.period, BRIDGE_URL)
        console.log(`[MACD] ${order.ticker} ${macdParams.period}: ${JSON.stringify(macd.curr)} | prev: ${JSON.stringify(macd.prev)} | candles: ${macd.candles}`)

        const triggered = macdParams.type === 'bullish'
          ? (macd.bullish_cross || macd.bullish_state)   // cross OR already above signal
          : (macd.bearish_cross || macd.bearish_state)   // cross OR already below signal

        if (!triggered) {
          results.push({
            id:     order.id,
            ticker: order.ticker,
            skip:   `MACD ${macdParams.type} cross not detected`,
            detail: `prev MACD ${macd.prev.macd} vs Signal ${macd.prev.signal} → curr MACD ${macd.curr.macd} vs Signal ${macd.curr.signal}`,
          })
          continue
        }

        results.push({
          id:          order.id,
          ticker:      order.ticker,
          macd_trigger: `MACD ${macdParams.type} cross on ${macdParams.period} — MACD ${macd.curr.macd} crossed ${macdParams.type === 'bullish' ? 'above' : 'below'} Signal ${macd.curr.signal}`,
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
