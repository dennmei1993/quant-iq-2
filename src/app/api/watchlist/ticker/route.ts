// src/app/api/watchlist/ticker/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

async function getUser() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (n: string) => cookieStore.get(n)?.value, set: () => {}, remove: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { ticker } = await req.json() as { ticker: string }
    if (!ticker) return NextResponse.json({ error: 'ticker required' }, { status: 400 })

    const { createServiceClient } = await import('@/lib/supabase/server')
    const db = createServiceClient()

    await (db.from('user_watchlist') as any).upsert(
      { user_id: user.id, ticker: ticker.toUpperCase().trim() },
      { onConflict: 'user_id,ticker' }
    )

    return NextResponse.json({ ok: true, ticker, action: 'added' })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const ticker = req.nextUrl.searchParams.get('ticker')
    if (!ticker) return NextResponse.json({ error: 'ticker required' }, { status: 400 })

    const { createServiceClient } = await import('@/lib/supabase/server')
    const db = createServiceClient()

    await (db.from('user_watchlist') as any)
      .delete()
      .eq('user_id', user.id)
      .eq('ticker', ticker.toUpperCase())

    return NextResponse.json({ ok: true, ticker, action: 'removed' })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}