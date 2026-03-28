// src/app/api/admin/run-cron/route.ts
/**
 * POST /api/admin/run-cron
 * Proxy that triggers cron jobs server-side using CRON_SECRET.
 * The admin page calls this so secrets never go to the browser.
 * Auth: must be a logged-in user (checked via Supabase session).
 */
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

const CRON_PATHS: Record<string, string> = {
  ingest: '/api/cron/ingest',
  macro:  '/api/cron/macro',
  themes: '/api/cron/themes',
}

export async function POST(req: NextRequest) {
  // Auth check — must be logged in
  try {
    const cookieStore = await cookies()
    const authClient  = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get: (n: string) => cookieStore.get(n)?.value, set: () => {}, remove: () => {} } }
    )
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { cron } = await req.json() as { cron: string }
  const path = CRON_PATHS[cron]
  if (!path) return NextResponse.json({ error: `Unknown cron: ${cron}` }, { status: 400 })

  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.betteroption.com.au'
  const url  = `${base}${path}`

  try {
    const res  = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
      signal:  AbortSignal.timeout(290_000), // just under 300s
    })
    const data = await res.json()
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}
