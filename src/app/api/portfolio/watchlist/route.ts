// src/app/api/portfolio/watchlist/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { requireUser, errorResponse, createServiceClient } from '@/lib/supabase'

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

    // ── Ensure ticker is tracked for daily price fetching ─────────────────────
    const cleanTicker = ticker.trim().toUpperCase()
    const serviceClient = createServiceClient()

    // Check if already in assets
    const { data: existing } = await serviceClient
      .from('assets')
      .select('ticker, bootstrapped, asset_type')
      .eq('ticker', cleanTicker)
      .maybeSingle()

    if (!existing || !existing.bootstrapped) {
      // Add to assets if new, or update track_price if existing but not bootstrapped
      await serviceClient
        .from('assets')
        .upsert({
          ticker:       cleanTicker,
          name:         name ?? null,
          asset_type:   name?.toLowerCase().match(/etf|fund|trust|index|shares/) ? 'etf' : (existing?.asset_type ?? 'stock'),
          is_active:    true,
          bootstrapped: false,
        }, { onConflict: 'ticker', ignoreDuplicates: false })

      // Fire-and-forget bootstrap — fetch recent 10 days first (fast), full history separately
      const baseUrl    = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.betteroption.com.au'
      const cronSecret = process.env.CRON_SECRET

      if (cronSecret) {
        // Quick recent prices first (count=10, fast)
        fetch(
          `${baseUrl}/api/cron/bootstrap?ticker=${encodeURIComponent(cleanTicker)}&count=10`,
          { method: 'GET', headers: { Authorization: `Bearer ${cronSecret}` }, signal: AbortSignal.timeout(30_000) }
        ).then(r => r.json()).then(d => {
          console.log(`[watchlist] Quick bootstrap for ${cleanTicker}:`, d)
          // Then kick off full history in background
          fetch(
            `${baseUrl}/api/cron/bootstrap?ticker=${encodeURIComponent(cleanTicker)}`,
            { method: 'GET', headers: { Authorization: `Bearer ${cronSecret}` }, signal: AbortSignal.timeout(120_000) }
          ).then(r2 => r2.json()).then(d2 => {
            console.log(`[watchlist] Full bootstrap for ${cleanTicker}:`, d2)
          }).catch(e => console.warn(`[watchlist] Full bootstrap failed: ${e.message}`))
        }).catch(e => console.warn(`[watchlist] Quick bootstrap failed for ${cleanTicker}: ${e.message}`))
      } else {
        console.warn('[watchlist] CRON_SECRET not set — bootstrap skipped')
      }

      // Return immediately — don't wait for bootstrap
      return NextResponse.json({
        entry:       data,
        bootstrapped: false,
        price_rows:  0,
        message:     `Added ${cleanTicker} — price history loading in background`,
      }, { status: 201 })
    }

    return NextResponse.json({ entry: data, bootstrapped: !!existing?.bootstrapped }, { status: 201 })
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
