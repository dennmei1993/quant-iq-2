// src/app/api/portfolio/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const HoldingSchema = z.object({
  ticker: z.string().min(1).max(12).toUpperCase(),
  name: z.string().optional(),
  asset_type: z.enum(['stock', 'etf', 'crypto', 'commodity']).optional(),
  quantity: z.number().positive().optional(),
  avg_cost: z.number().positive().optional(),
  notes: z.string().optional(),
})

export async function GET(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Get or create default portfolio
  let { data: portfolio } = await supabase
    .from('portfolios')
    .select('id, name')
    .eq('user_id', user.id)
    .single()

  if (!portfolio) {
    const { data: newPortfolio } = await supabase
      .from('portfolios')
      .insert({ user_id: user.id, name: 'My Portfolio' })
      .select('id, name')
      .single()
    portfolio = newPortfolio
  }

  const { data: holdings } = await supabase
    .from('holdings')
    .select('*')
    .eq('portfolio_id', portfolio!.id)
    .order('created_at', { ascending: true })

  return NextResponse.json({ portfolio, holdings: holdings ?? [] })
}

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const parsed = HoldingSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  // Get portfolio id
  const { data: portfolio } = await supabase
    .from('portfolios')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!portfolio) return NextResponse.json({ error: 'Portfolio not found' }, { status: 404 })

  const { data, error } = await supabase
    .from('holdings')
    .insert({ portfolio_id: portfolio.id, ...parsed.data })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ holding: data }, { status: 201 })
}

export async function DELETE(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const holdingId = searchParams.get('id')
  if (!holdingId) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const { error } = await supabase
    .from('holdings')
    .delete()
    .eq('id', holdingId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
