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
      .select('ticker, bootstrapped')
      .eq('ticker', cleanTicker)
      .maybeSingle()

    if (!existing) {
      // Add to assets with bootstrapped: false and track_price: true
      await serviceClient
        .from('assets')
        .upsert({
          ticker:       cleanTicker,
          name:         name ?? null,
          asset_type:   'stock',
          is_active:    true,
          bootstrapped: false,
          track_price:  true,
          added_at:     new Date().toISOString(),
        }, { onConflict: 'ticker', ignoreDuplicates: true })

      // Bootstrap price history directly from FMP — don't wait for nightly cron
      const fmpKey = process.env.FMP_API_KEY
      if (fmpKey) {
        // Fire and forget — runs in background, watchlist add returns immediately
        ;(async () => {
          try {
            const from = '2024-01-01'
            const to   = new Date().toISOString().slice(0, 10)
            const url  = `https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${cleanTicker}&from=${from}&to=${to}&apikey=${fmpKey}`
            const res  = await fetch(url, { signal: AbortSignal.timeout(15000) })
            if (!res.ok) return

            const json = await res.json()
            // FMP returns { historical: [{date, open, high, low, close, volume}] }
            const prices: { date: string; open: number; high: number; low: number; close: number; volume: number }[] =
              json.historical ?? (Array.isArray(json) ? json : [])

            if (!prices.length) return

            const rows = prices.map(p => ({
              ticker,
              date:      p.date,
              open:      p.open   ?? null,
              high:      p.high   ?? null,
              low:       p.low    ?? null,
              close:     p.close  ?? null,
              adj_close: null,
              volume:    p.volume ?? null,
              source:    'fmp',
            }))

            // Upsert in batches of 500
            for (let i = 0; i < rows.length; i += 500) {
              await serviceClient
                .from('daily_prices')
                .upsert(rows.slice(i, i + 500), { onConflict: 'ticker,date', ignoreDuplicates: false })
            }

            // Mark as bootstrapped
            await serviceClient
              .from('assets')
              .update({ bootstrapped: true })
              .eq('ticker', cleanTicker)

            console.log(`[watchlist] Bootstrapped ${cleanTicker}: ${rows.length} price rows`)
          } catch (e) {
            console.warn(`[watchlist] Bootstrap failed for ${cleanTicker}:`, e)
          }
        })()
      } else {
        // No FMP key — trigger engine if URL is set
        const engineUrl    = process.env.ENGINE_BOOTSTRAP_URL
        const engineSecret = process.env.CRON_SECRET
        if (engineUrl && engineSecret) {
          fetch(engineUrl, {
            headers: { Authorization: `Bearer ${engineSecret}` },
            signal: AbortSignal.timeout(5000),
          }).catch(() => {})
        }
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
