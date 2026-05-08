// src/app/api/assets/track/route.ts  (quant-iq-2)
//
// Thin proxy: authenticates the user, then delegates price backfill
// to quant-iq-engine which owns all FMP and price logic.
//
// POST /api/assets/track
// Body: { ticker: string }

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

async function getUserId(): Promise<string | null> {
  try {
    const cookieStore = await cookies()
    const auth = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get: (n) => cookieStore.get(n)?.value, set: () => {}, remove: () => {} } }
    )
    const { data: { user } } = await auth.auth.getUser()
    return user?.id ?? null
  } catch { return null }
}

export async function POST(req: NextRequest) {
  // Must be logged in
  const userId = await getUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let ticker: string
  try {
    const body = await req.json()
    ticker = (body.ticker ?? '').toUpperCase().trim()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!ticker) {
    return NextResponse.json({ error: 'ticker is required' }, { status: 400 })
  }

  // Delegate to engine — it owns FMP + price logic
  const engineUrl    = process.env.ENGINE_URL ?? 'https://quant-iq-engine.vercel.app'
  const engineSecret = process.env.CRON_SECRET ?? ''

  try {
    const engineRes = await fetch(`${engineUrl}/api/assets/track`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${engineSecret}`,
      },
      body:   JSON.stringify({ ticker }),
      signal: AbortSignal.timeout(55_000),
    })

    const data = await engineRes.json()

    if (!engineRes.ok) {
      return NextResponse.json(
        { error: data.error ?? 'Engine request failed', ticker },
        { status: engineRes.status }
      )
    }

    return NextResponse.json(data)

  } catch (e: any) {
    console.error('[api/assets/track] engine call failed:', e.message)
    return NextResponse.json(
      { error: `Engine unreachable: ${e.message}`, ticker },
      { status: 502 }
    )
  }
}
