// src/app/api/strategies/option/route.ts
// GET  — list user's option strategies
// POST — create new strategy (PMCC, spread, etc.)

import { NextRequest, NextResponse } from 'next/server'
import { requireUser, errorResponse } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const status = req.nextUrl.searchParams.get('status') ?? 'all'

    let query = (supabase as any)
      .from('option_strategies')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (status !== 'all') query = query.eq('status', status)

    const { data, error } = await query
    if (error) throw error
    return NextResponse.json({ strategies: data ?? [] })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    // Cancel linked conditional orders first
    await (supabase as any)
      .from('conditional_orders')
      .update({ status: 'cancelled' })
      .eq('strategy_id', id)
      .eq('user_id', user.id)
      .neq('status', 'triggered')

    // Mark strategy as closed
    const { error } = await (supabase as any)
      .from('option_strategies')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const body = await req.json()

    const { data, error } = await (supabase as any)
      .from('option_strategies')
      .insert({
        user_id:           user.id,
        portfolio_id:      body.portfolio_id    ?? null,
        type:              body.type            ?? 'pmcc',
        ticker:            body.ticker,
        status:            'pending',
        notes:             body.notes           ?? null,
        leg1_order_id:     body.leg1_order_id   ?? null,
        leg1_strike:       body.leg1_strike     ?? null,
        leg1_expiry:       body.leg1_expiry     ?? null,
        leg1_delta_target: body.leg1_delta_target ?? null,
        leg1_iv_max:       body.leg1_iv_max     ?? null,
        leg2_order_id:     body.leg2_order_id   ?? null,
        leg2_strike:       body.leg2_strike     ?? null,
        leg2_expiry:       body.leg2_expiry     ?? null,
        leg2_delta_target: body.leg2_delta_target ?? null,
        leg2_iv_min:       body.leg2_iv_min     ?? null,
        leg2_premium_min:  body.leg2_premium_min ?? null,
      })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ strategy: data }, { status: 201 })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 })
  }
}
