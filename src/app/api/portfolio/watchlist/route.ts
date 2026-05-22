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

      // Call local bootstrap cron — fetches Moomoo price history via bridge
      const baseUrl    = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.betteroption.com.au'
      const cronSecret = process.env.CRON_SECRET

      if (cronSecret) {
        try {
          console.log(`[watchlist] Bootstrapping ${cleanTicker} via local bridge`)

          const bootstrapRes = await fetch(
            `${baseUrl}/api/cron/bootstrap?ticker=${encodeURIComponent(cleanTicker)}`,
            {
              method:  'GET',
              headers: { Authorization: `Bearer ${cronSecret}` },
              signal:  AbortSignal.timeout(60_000),
            }
          )
          const bootstrapData = await bootstrapRes.json().catch(() => ({}))
          console.log(`[watchlist] Bootstrap result for ${cleanTicker}:`, bootstrapData)

          const bootstrapped = bootstrapData.bootstrapped > 0

          const { count } = await serviceClient
            .from('daily_prices')
            .select('*', { count: 'exact', head: true })
            .eq('ticker', cleanTicker)

          return NextResponse.json({
            entry:       data,
            bootstrapped,
            price_rows:  count ?? 0,
            message:     bootstrapped
              ? `Added ${cleanTicker} with ${count ?? 0} days of price history`
              : `Added ${cleanTicker} — bootstrap failed: ${bootstrapData.failures?.[0]?.error ?? 'unknown'}`,
          }, { status: 201 })
        } catch (e: any) {
          console.warn(`[watchlist] Bootstrap failed: ${e.message}`)
        }
      } else {
        console.warn('[watchlist] CRON_SECRET not set — bootstrap skipped')
      }
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
