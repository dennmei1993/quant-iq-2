// src/app/api/signals/volatility/route.ts
// GET /api/signals/volatility?ticker=GOOG
// Returns IV (from bridge), HV (from daily_prices), IV Rank & IVP (from iv_history)

import { NextRequest, NextResponse } from 'next/server'
import { requireUser, createServiceClient, errorResponse } from '@/lib/supabase'

const BRIDGE_URL = process.env.BROKER_BRIDGE_URL ?? 'http://127.0.0.1:8765'
const TRADING_DAYS = 252

export async function GET(req: NextRequest) {
  try {
    const { supabase } = await requireUser()
    const ticker = (req.nextUrl.searchParams.get('ticker') ?? '').toUpperCase()
    if (!ticker) return NextResponse.json({ error: 'ticker required' }, { status: 400 })

    // ── 1. Get current IV from bridge ──────────────────────────────────────────
    let currentIV: number | null = null
    try {
      const res = await fetch(`${BRIDGE_URL}/options/volatility?symbol=US.${ticker}`, {
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok) {
        const d = await res.json()
        currentIV = d.iv ?? null
      }
    } catch {}

    // ── 2. Calculate Historical Volatility from daily_prices ──────────────────
    // HV = annualised std dev of log returns over last 30 trading days
    const { data: prices } = await supabase
      .from('daily_prices')
      .select('date, close')
      .eq('ticker', ticker)
      .order('date', { ascending: false })
      .limit(32)  // 31 returns needs 32 prices

    let hv30: number | null = null
    if (prices && prices.length >= 10) {
      const closes = prices.map(p => parseFloat(p.close)).reverse()
      const logReturns = []
      for (let i = 1; i < closes.length; i++) {
        if (closes[i-1] > 0 && closes[i] > 0) {
          logReturns.push(Math.log(closes[i] / closes[i-1]))
        }
      }
      if (logReturns.length >= 5) {
        const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length
        const variance = logReturns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (logReturns.length - 1)
        hv30 = Math.round(Math.sqrt(variance * TRADING_DAYS) * 100 * 100) / 100
      }
    }

    // ── 3. Store today's IV in iv_history (upsert) ────────────────────────────
    const today = new Date().toISOString().slice(0, 10)
    if (currentIV !== null) {
      await (supabase as any)
        .from('iv_history')
        .upsert({ ticker, date: today, iv: currentIV }, { onConflict: 'ticker,date' })
    }

    // ── 4. Calculate IV Rank & IV Percentile from iv_history ─────────────────
    const { data: ivHistory } = await (supabase as any)
      .from('iv_history')
      .select('date, iv')
      .eq('ticker', ticker)
      .order('date', { ascending: false })
      .limit(252) as { data: { date: string; iv: number }[] | null }

    let ivRank: number | null = null
    let ivPercentile: number | null = null

    if (ivHistory && ivHistory.length >= 20 && currentIV !== null) {
      const ivValues = ivHistory.map(r => parseFloat(String(r.iv))).filter(v => v > 0)
      const minIV = Math.min(...ivValues)
      const maxIV = Math.max(...ivValues)

      // IV Rank = (current - min) / (max - min) * 100
      if (maxIV > minIV) {
        ivRank = Math.round((currentIV - minIV) / (maxIV - minIV) * 100)
      }

      // IV Percentile = % of days where IV was lower than current
      const daysBelow = ivValues.filter(v => v < currentIV!).length
      ivPercentile = Math.round(daysBelow / ivValues.length * 100)
    }

    return NextResponse.json({
      ticker,
      iv:             currentIV,
      hv_30d:         hv30,
      iv_rank:        ivRank,
      iv_percentile:  ivPercentile,
      iv_history_days: ivHistory?.length ?? 0,
      note: ivHistory && ivHistory.length < 20
        ? `Only ${ivHistory?.length ?? 0} days of IV history — need 20+ for IV Rank. Will build up over time.`
        : null,
    })
  } catch (e) {
    const { body, status } = errorResponse(e)
    return NextResponse.json(body, { status })
  }
}
