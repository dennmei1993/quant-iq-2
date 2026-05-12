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
    // Auth — only authenticated users can call the broker
    await requireUser()
  } catch {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const path    = params.path.join('/')
  const search  = req.nextUrl.search ?? ''
  const url     = `${BRIDGE_URL}/${path}${search}`

  try {
    const init: RequestInit = {
      method:  req.method,
      headers: { 'Content-Type': 'application/json' },
    }

    // Forward body for POST/PUT/PATCH
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      const body = await req.text()
      if (body) init.body = body
    }

    const res  = await fetch(url, { ...init, signal: AbortSignal.timeout(4000) })
    const data = await res.json()

    return NextResponse.json(data, { status: res.status })
  } catch (err: any) {
    // Any fetch failure = bridge unreachable (ECONNREFUSED, timeout, DNS, etc.)
    // On Vercel, localhost:8765 is never reachable — always returns 503
    const msg = err?.message ?? String(err)
    const isOffline =
      err?.cause?.code === 'ECONNREFUSED' ||
      msg.includes('ECONNREFUSED')        ||
      msg.includes('ETIMEDOUT')           ||
      msg.includes('fetch failed')        ||
      err?.name === 'TimeoutError'        ||
      err?.name === 'AbortError'

    if (isOffline || true) {  // treat ALL errors as offline — bridge is local-only
      return NextResponse.json(
        { error: 'Broker bridge offline', detail: 'Start with: python broker_service.py' },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export const GET    = handler
export const POST   = handler
export const DELETE = handler
export const PUT    = handler
export const PATCH  = handler
