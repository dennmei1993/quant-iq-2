// src/app/api/broker/[...path]/route.ts
// Proxy all /api/broker/* requests to the local broker bridge (port 8765).
// This keeps the bridge internal — never exposed to the internet.
// The bridge must be running: python broker_service.py

import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase'

const BRIDGE_URL = process.env.BROKER_BRIDGE_URL ?? 'http://127.0.0.1:8765'

// All HTTP methods forwarded
async function handler(req: NextRequest, { params }: { params: { path: string[] } }) {
  try {
    await requireUser()
  } catch {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const path   = (await params).path.join('/')
  const search = req.nextUrl.search ?? ''
  const url    = `${BRIDGE_URL}/${path}${search}`

  try {
    const init: RequestInit = {
      method:  req.method,
      headers: { 'Content-Type': 'application/json' },
    }

    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      const body = await req.text()
      if (body) init.body = body
    }

    const res  = await fetch(url, { ...init, signal: AbortSignal.timeout(4000) })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })

  } catch {
    // Bridge unreachable — always 503 so client hides the status bar silently
    return NextResponse.json(
      { error: 'Broker bridge offline', detail: 'Start with: python broker_service.py' },
      { status: 503 }
    )
  }
}

export const GET    = handler
export const POST   = handler
export const DELETE = handler
export const PUT    = handler
export const PATCH  = handler
