// src/app/api/profile/route.ts
/**
 * GET  /api/profile â€” fetch current user's profile preferences
 * POST /api/profile â€” update preferences
 */
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { createServiceClient } from '@/lib/supabase/server'

async function getUserId(): Promise<string | null> {
  try {
    const cookieStore = await cookies()
    const authClient  = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get: (n: string) => cookieStore.get(n)?.value, set: () => {}, remove: () => {} } }
    )
    const { data: { user } } = await authClient.auth.getUser()
    return user?.id ?? null
  } catch { return null }
}

export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const { data, error } = await db
    .from('profiles')
    .select('risk_appetite, investment_horizon, preferred_assets, benchmark, target_holdings, cash_pct, display_name')
    .eq('id', userId)
    .single()

  if (error) {
    // Profile may not exist yet â€” return defaults
    return NextResponse.json({
      risk_appetite:      'moderate',
      investment_horizon: 'medium',
      preferred_assets:   ['stock', 'etf'],
      benchmark:          'SPY',
      target_holdings:    20,
      cash_pct:           0,
      display_name:       null,
    })
  }

  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  // Validate fields
  const allowed = ['risk_appetite', 'investment_horizon', 'preferred_assets', 'benchmark', 'target_holdings', 'cash_pct', 'display_name']
  const update: Record<string, any> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (body[key] !== undefined) update[key] = body[key]
  }

  const db = createServiceClient()

  // Upsert â€” create profile if it doesn't exist
  const { error } = await (db.from('profiles') as any)
    .upsert({ id: userId, ...update }, { onConflict: 'id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
