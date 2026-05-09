// src/app/api/portfolio/watchlist/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { requireUser, errorResponse } from '@/lib/supabase'

// GET /api/portfolio/watchlist?portfolio_id=
export async function GET(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const portfolioId = req.nextUrl.searchParams.get('portfolio_id')

    if (!portfolioId) {
      return NextResponse.json({ error: 'portfolio_id is required' }, { status: 400 })
    }

    // Verify ownership
    const { data: portfolio } = await supabase
      .from('portfolios')
      .select('id')
      .eq('id', portfolioId)
      .eq('user_id', user.id)
      .single()

    if (!portfolio) {
      return NextResponse.json({ error: 'Portfolio not found' }, { status: 404 })
    }

    const { data, error } = await supabase
      .from('portfolio_watchlist')
      .select('id, ticker, name, notes, added_at')
      .eq('portfolio_id', portfolioId)
      .order('added_at', { ascending: false })

    if (error) throw error

    return NextResponse.json({ watchlist: data ?? [] })
  } catch (e) {
    const { body, status } = errorResponse(e)
    return NextResponse.json(body, { status })
  }
}

// POST /api/portfolio/watchlist
export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const { portfolio_id, ticker, name, notes } = await req.json()

    if (!portfolio_id || !ticker) {
      return NextResponse.json({ error: 'portfolio_id and ticker required' }, { status: 400 })
    }

    // Verify ownership
    const { data: portfolio } = await supabase
      .from('portfolios')
      .select('id')
      .eq('id', portfolio_id)
      .eq('user_id', user.id)
      .single()

    if (!portfolio) {
      return NextResponse.json({ error: 'Portfolio not found' }, { status: 404 })
    }

    const { data, error } = await supabase
      .from('portfolio_watchlist')
      .upsert(
        {
          portfolio_id,
          user_id: user.id,
          ticker:  ticker.trim().toUpperCase(),
          name:    name  ?? null,
          notes:   notes ?? null,
        },
        { onConflict: 'portfolio_id,ticker' }
      )
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ entry: data }, { status: 201 })
  } catch (e) {
    const { body, status } = errorResponse(e)
    return NextResponse.json(body, { status })
  }
}

// DELETE /api/portfolio/watchlist?portfolio_id=&ticker=
export async function DELETE(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const portfolioId = req.nextUrl.searchParams.get('portfolio_id')
    const ticker      = req.nextUrl.searchParams.get('ticker')

    if (!portfolioId || !ticker) {
      return NextResponse.json({ error: 'portfolio_id and ticker required' }, { status: 400 })
    }

    // Verify ownership
    const { data: portfolio } = await supabase
      .from('portfolios')
      .select('id')
      .eq('id', portfolioId)
      .eq('user_id', user.id)
      .single()

    if (!portfolio) {
      return NextResponse.json({ error: 'Portfolio not found' }, { status: 404 })
    }

    const { error } = await supabase
      .from('portfolio_watchlist')
      .delete()
      .eq('portfolio_id', portfolioId)
      .eq('ticker', ticker.toUpperCase())

    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (e) {
    const { body, status } = errorResponse(e)
    return NextResponse.json(body, { status })
  }
}
