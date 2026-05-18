// src/app/api/orders/conditional/route.ts
// GET  — list user's conditional orders
// POST — create a new conditional order
// PATCH /api/orders/conditional?id= — update status (cancel)

import { NextRequest, NextResponse } from 'next/server'
import { requireUser, errorResponse } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const status = req.nextUrl.searchParams.get('status') // optional filter

    let query = (supabase as any)
      .from('conditional_orders')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (status) query = query.eq('status', status)

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({ orders: data ?? [] })
  } catch (e) {
    const { body, status } = errorResponse(e)
    return NextResponse.json(body, { status })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const body = await req.json()

    const { data, error } = await (supabase as any)
      .from('conditional_orders')
      .insert({
        user_id:         user.id,
        portfolio_id:    body.portfolio_id    || null,
        ticker:          body.ticker.toUpperCase(),
        asset_type:      body.asset_type      || 'stock',
        option_code:     body.option_code     || null,
        side:            body.side.toUpperCase(),
        qty:             body.qty,
        order_type:      body.order_type      || 'LIMIT',
        limit_price:     body.limit_price     || null,
        price_above:     body.price_above     || null,
        price_below:     body.price_below     || null,
        iv_rank_above:   body.iv_rank_above   || null,
        iv_rank_below:   body.iv_rank_below   || null,
        premium_above:   body.premium_above   || null,
        premium_below:   body.premium_below   || null,
        not_before_time: body.not_before_time || '10:00',
        not_before_date: body.not_before_date || null,
        expires_at:      body.expires_at      || null,
        notes:           body.notes           || null,
      })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ ok: true, order: data })
  } catch (e) {
    const { body, status } = errorResponse(e)
    return NextResponse.json(body, { status })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const { error } = await (supabase as any)
      .from('conditional_orders')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)  // ensure user owns the order

    if (error) throw error
    return NextResponse.json({ ok: true, deleted: id })
  } catch (e) {
    const { body, status } = errorResponse(e)
    return NextResponse.json(body, { status })
  }
}
  try {
    const { supabase, user } = await requireUser()
    const id   = req.nextUrl.searchParams.get('id')
    const body = await req.json()

    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const { error } = await (supabase as any)
      .from('conditional_orders')
      .update({ status: body.status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (e) {
    const { body, status } = errorResponse(e)
    return NextResponse.json(body, { status })
  }
}
