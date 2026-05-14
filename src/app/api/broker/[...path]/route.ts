// src/app/api/broker/[...path]/route.ts
// Proxy all /api/broker/* to the broker bridge.
// For order placement endpoints, injects the user's trade PIN from their profile.

import { NextRequest, NextResponse } from 'next/server'
import { requireUser, createServiceClient } from '@/lib/supabase'

const DEFAULT_URL = process.env.BROKER_BRIDGE_URL ?? 'http://127.0.0.1:8765'

async function getBridgeUrl(): Promise<string> {
  try {
    const supabase = createServiceClient()
    const { data } = await (supabase as any)
      .from('app_settings')
      .select('value')
      .eq('key', 'broker_bridge_url')
      .single() as { data: { value: string } | null }
    if (data?.value) return data.value
  } catch {}
  return DEFAULT_URL
}

async function getTradeConfig(userId: string): Promise<{
  tradePwd:     string
  tradingMode:  string
  dataAccount:  string
  tradeAccount: string
}> {
  try {
    const supabase = createServiceClient()
    const { data } = await supabase
      .from('profiles')
      .select('moomoo_password, trading_mode, data_account, trade_account, moomoo_account')
      .eq('id', userId)
      .single()
    return {
      tradePwd:     data?.moomoo_password ?? '',
      tradingMode:  data?.trading_mode    ?? 'paper',
      dataAccount:  data?.data_account    ?? data?.moomoo_account ?? '',
      tradeAccount: data?.trade_account   ?? '',
    }
  } catch {}
  return { tradePwd: '', tradingMode: 'paper', dataAccount: '', tradeAccount: '' }
}

async function handler(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  let user: any
  try {
    const auth = await requireUser()
    user = auth.user
  } catch {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { path } = await params
  const pathStr  = path.join('/')
  const BRIDGE_URL = await getBridgeUrl()
  const url = `${BRIDGE_URL}/${pathStr}${req.nextUrl.search ?? ''}`

  try {
    const init: RequestInit = {
      method:  req.method,
      headers: { 'Content-Type': 'application/json' },
    }

    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      let bodyText = await req.text()

      // For order placement and cancellation — inject trade PIN from user profile
      const isOrderEndpoint = pathStr === 'orders/moomoo' || pathStr === 'account/unlock'
      if (isOrderEndpoint && bodyText) {
        try {
          const bodyObj  = JSON.parse(bodyText)
          const cfg      = await getTradeConfig(user.id)
          if (!bodyObj.trade_pwd  && cfg.tradePwd)     bodyObj.trade_pwd     = cfg.tradePwd
          if (!bodyObj.account_id && cfg.tradeAccount) bodyObj.account_id    = cfg.tradeAccount
          if (!bodyObj.trading_mode)                    bodyObj.trading_mode  = cfg.tradingMode
          bodyText = JSON.stringify(bodyObj)
        } catch {}
      }

      if (bodyText) init.body = bodyText
    }

    // For DELETE on orders/moomoo — append trade PIN as query param
    let finalUrl = url
    if (req.method === 'DELETE' && pathStr.startsWith('orders/moomoo/')) {
      const cfg = await getTradeConfig(user.id)
      if (cfg.tradePwd) {
        const tradePwd = cfg.tradePwd
        const sep = finalUrl.includes('?') ? '&' : '?'
        finalUrl = `${finalUrl}${sep}trade_pwd=${encodeURIComponent(tradePwd)}`
      }
    }

    const res  = await fetch(finalUrl, { ...init, signal: AbortSignal.timeout(10000) })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })

  } catch {
    return NextResponse.json(
      { error: 'Broker bridge offline', detail: 'Start broker_service.py and tunnel' },
      { status: 503 }
    )
  }
}

export const GET    = handler
export const POST   = handler
export const DELETE = handler
export const PUT    = handler
export const PATCH  = handler
