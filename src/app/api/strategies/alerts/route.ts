// src/app/api/strategies/alerts/route.ts
// GET  — list unread alerts for user
// PATCH — mark alert as read

import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const { data, error } = await (supabase as any)
      .from('strategy_alerts')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) throw error
    return NextResponse.json({ alerts: data ?? [] })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const id   = req.nextUrl.searchParams.get('id')
    const body = await req.json()
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const { error } = await (supabase as any)
      .from('strategy_alerts')
      .update({ is_read: body.is_read })
      .eq('id', id)
      .eq('user_id', user.id)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 })
  }
}
