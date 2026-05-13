// src/app/api/orders/record/route.ts
// POST — save a Moomoo order to broker_orders table

import { NextRequest, NextResponse } from 'next/server'
import { requireUser, errorResponse } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const body = await req.json()

    const { error } = await supabase
      .from('broker_orders')
      .upsert({
        user_id:    user.id,
        order_id:   body.order_id,
        ticker:     body.ticker,
        side:       body.side,
        qty:        body.qty,
        price:      body.price,
        order_type: body.order_type,
        status:     body.status ?? 'PLACED',
        account:    body.account,
        trd_env:    body.trd_env,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'order_id' })

    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (e) {
    const { body, status } = errorResponse(e)
    return NextResponse.json(body, { status })
  }
}
