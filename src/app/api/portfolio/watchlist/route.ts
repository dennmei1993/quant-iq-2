// src/app/api/portfolio/watchlist/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { requireUser, errorResponse } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const portfolioId = req.nextUrl.searchParams.get('portfolio_id')
    if (!portfolioId) return NextResponse.json({ error: 'portfolio_id required' }, { status: 400 })

    const { data, error } = await supabase
      .from('portfolio_watchlist')
      .select('id, ticker, name, notes, added_at')
      .eq('portfolio_id', portfolioId)
      .eq('user_id', user.id)
      .order('added_at', { ascending: false })

    if (error) throw error
    return NextResponse.json({ watchlist: data ?? [] })
  } catch (e) {
    const { body, status } = errorResponse(e)
    return NextResponse.json(body, { status })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const { portfolio_id, ticker, name, notes } = await req.json()
    if (!portfolio_id || !ticker) {
      return NextResponse.json({ error: 'portfolio_id and ticker required' }, { status: 400 })
    }

    const tickerUpper = ticker.toUpperCase()

    // Check if already exists — upsert manually to avoid constraint name issues
    const { data: existing } = await supabase
      .from('portfolio_watchlist')
      .select('id')
      .eq('portfolio_id', portfolio_id)
      .eq('user_id', user.id)
      .eq('ticker', tickerUpper)
      .maybeSingle()

    let result
    if (existing) {
      // Update notes if already watching
      const { data, error } = await supabase
        .from('portfolio_watchlist')
        .update({ notes: notes ?? null, name: name ?? null })
        .eq('id', existing.id)
        .select('id, ticker, name, added_at')
        .single()
      if (error) throw error
      result = data
    } else {
      const { data, error } = await supabase
        .from('portfolio_watchlist')
        .insert({ portfolio_id, user_id: user.id, ticker: tickerUpper, name: name ?? null, notes: notes ?? null })
        .select('id, ticker, name, added_at')
        .single()
      if (error) throw error
      result = data
    }

    return NextResponse.json({ entry: result }, { status: 201 })
  } catch (e) {
    const { body, status } = errorResponse(e)
    return NextResponse.json(body, { status })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const portfolioId = req.nextUrl.searchParams.get('portfolio_id')
    const ticker      = req.nextUrl.searchParams.get('ticker')
    if (!portfolioId || !ticker) {
      return NextResponse.json({ error: 'portfolio_id and ticker required' }, { status: 400 })
    }

    const { error } = await supabase
      .from('portfolio_watchlist')
      .delete()
      .eq('portfolio_id', portfolioId)
      .eq('ticker', ticker.toUpperCase())
      .eq('user_id', user.id)

    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (e) {
    const { body, status } = errorResponse(e)
    return NextResponse.json(body, { status })
  }
}
