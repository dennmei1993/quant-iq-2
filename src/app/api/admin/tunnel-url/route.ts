// src/app/api/admin/tunnel-url/route.ts
// POST /api/admin/tunnel-url  — update broker bridge URL at runtime
// GET  /api/admin/tunnel-url  — get current broker bridge URL
// Stores in Supabase so no Vercel redeploy needed when tunnel URL changes

import { NextRequest, NextResponse } from 'next/server'
import { requireUser, errorResponse } from '@/lib/supabase'

export async function GET() {
  try {
    const { supabase } = await requireUser()
    const { data } = await (supabase as any)
      .from('app_settings')
      .select('value')
      .eq('key', 'broker_bridge_url')
      .single() as { data: { value: string } | null }

    const url = data?.value || process.env.BROKER_BRIDGE_URL || 'http://127.0.0.1:8765'
    return NextResponse.json({ url })
  } catch (e) {
    const url = process.env.BROKER_BRIDGE_URL || 'http://127.0.0.1:8765'
    return NextResponse.json({ url })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { supabase } = await requireUser()
    const { url } = await req.json()
    if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 })

    await supabase
      .from('app_settings' as any)
      .upsert({ key: 'broker_bridge_url', value: url }, { onConflict: 'key' })

    return NextResponse.json({ ok: true, url })
  } catch (e) {
    const { body, status } = errorResponse(e)
    return NextResponse.json(body, { status })
  }
}
