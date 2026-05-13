// src/app/api/broker/[...path]/route.ts
// Proxy all /api/broker/* requests to the broker bridge.
// In dev: bridge runs on localhost:8765
// In prod: bridge is exposed via Cloudflare Tunnel
// Set BROKER_BRIDGE_URL in Vercel env vars to the tunnel URL.

import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase'

const BRIDGE_URL = process.env.BROKER_BRIDGE_URL ?? 'http://127.0.0.1:8765'

async function handler(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  try {
    await requireUser()
  } catch {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { path } = await params
  const pathStr = path.join('/')
  const search  = req.nextUrl.search ?? ''
  const url     = `${BRIDGE_URL}/${pathStr}${search}`

  try {
    const init: RequestInit = {
      method:  req.method,
      headers: { 'Content-Type': 'application/json' },
    }

    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      const body = await req.text()
      if (body) init.body = body
    }

    const res  = await fetch(url, { ...init, signal: AbortSignal.timeout(10000) })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })

  } catch {
    return NextResponse.json(
      { error: 'Broker bridge offline', detail: 'Start broker_service.py and ensure BROKER_BRIDGE_URL is set' },
      { status: 503 }
    )
  }
}

export const GET    = handler
export const POST   = handler
export const DELETE = handler
export const PUT    = handler
export const PATCH  = handler
