// src/app/api/themes/tickers/route.ts
/**
 * POST /api/themes/tickers — add a ticker to a theme
 * DELETE /api/themes/tickers — remove a ticker from a theme
 * Auth: logged-in session required
 */
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { createServiceClient } from '@/lib/supabase/server'

async function getUser() {
  try {
    const cookieStore = await cookies()
    const authClient  = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get: (n: string) => cookieStore.get(n)?.value, set: () => {}, remove: () => {} } }
    )
    const { data: { user } } = await authClient.auth.getUser()
    return user
  } catch { return null }
}

// POST — add ticker to theme
export async function POST(req: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { theme_id, ticker, final_weight = 0.5, rationale = '' } = await req.json()
  if (!theme_id || !ticker) return NextResponse.json({ error: 'Missing theme_id or ticker' }, { status: 400 })

  const db = createServiceClient()

  // Verify ticker exists in assets
  const { data: asset } = await db
    .from('assets')
    .select('ticker, name')
    .eq('ticker', ticker.toUpperCase())
    .single()

  if (!asset) return NextResponse.json({ error: `Ticker ${ticker} not found in assets` }, { status: 404 })

  // Upsert — update weight if already exists
  const { error } = await (db.from('theme_tickers') as any)
    .upsert({
      theme_id,
      ticker:       ticker.toUpperCase(),
      final_weight,
      relevance:    Math.round(final_weight * 100),
      rationale:    rationale || null,
    }, { onConflict: 'theme_id,ticker' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, ticker: asset.ticker, name: asset.name })
}

// DELETE — remove ticker from theme
export async function DELETE(req: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { theme_id, ticker } = await req.json()
  if (!theme_id || !ticker) return NextResponse.json({ error: 'Missing theme_id or ticker' }, { status: 400 })

  const db = createServiceClient()

  const { error } = await db
    .from('theme_tickers')
    .delete()
    .eq('theme_id', theme_id)
    .eq('ticker', ticker.toUpperCase())

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
