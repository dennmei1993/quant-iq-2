// src/app/api/orders/record/route.ts
// POST — save a Moomoo order to broker_orders table

import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const body = await req.json()

    const { error } = await supabase
      .from('broker_orders')
      .upsert({
        user_id:    user.id,
        order_id:   String(body.order_id ?? ''),
        ticker:     String(body.ticker   ?? ''),
        side:       String(body.side     ?? ''),
        qty:        Number(body.qty      ?? 0),
        price:      body.price ? Number(body.price) : null,
        order_type: String(body.order_type ?? 'LIMIT'),
        status:     String(body.status   ?? 'PLACED'),
        account:    body.account  ? String(body.account)  : null,
        trd_env:    body.trd_env  ? String(body.trd_env)  : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'order_id' })

    if (error) {
      console.error('broker_orders upsert error:', error)
      // Don't fail the whole flow if table doesn't exist yet
      return NextResponse.json({ ok: false, error: error.message }, { status: 200 })
    }

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error('orders/record error:', e)
    return NextResponse.json({ ok: false, error: e.message }, { status: 200 })
  }
}
