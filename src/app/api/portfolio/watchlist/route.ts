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
      // Add to assets — engine will bootstrap price history
      await serviceClient
        .from('assets')
        .upsert({
          ticker:       cleanTicker,
          name:         name ?? null,
          asset_type:   name?.toLowerCase().includes('etf') || name?.toLowerCase().includes('fund') || name?.toLowerCase().includes('trust') ? 'etf' : 'stock',
          is_active:    true,
          bootstrapped: false,
          track_price:  true,
          added_at:     new Date().toISOString(),
        }, { onConflict: 'ticker', ignoreDuplicates: true })

      // Call quant-iq-engine bootstrap endpoint — it fetches FMP history and marks bootstrapped
      const engineUrl    = process.env.ENGINE_BOOTSTRAP_URL
      const engineSecret = process.env.ENGINE_CRON_SECRET  // separate from main app CRON_SECRET

      if (engineUrl && engineSecret) {
        try {
          // Detect asset type — ETFs/funds/trusts use the ETF endpoint, others use stocks
          const isEtf = name?.toLowerCase().match(/etf|fund|trust|index|shares/) || false
          const baseUrl  = engineUrl.replace('/stocks', '')  // strip /stocks suffix
          const stockUrl = `${baseUrl}/stocks`
          const etfUrl   = `${baseUrl}/etf?ticker=${encodeURIComponent(cleanTicker)}`
          const stockUrlWithTicker = `${baseUrl}/stocks` // stocks endpoint doesn't support ticker param yet

          // Use targeted ETF endpoint or stock endpoint
          const targetUrl = isEtf ? etfUrl : stockUrlWithTicker

          const [res1, res2] = await Promise.allSettled([
            fetch(targetUrl, { method: 'GET', headers: { Authorization: `Bearer ${engineSecret}` }, signal: AbortSignal.timeout(280_000) }),
            // Also call the other endpoint in case asset_type is misidentified
            fetch(isEtf ? stockUrl : etfUrl, { method: 'GET', headers: { Authorization: `Bearer ${engineSecret}` }, signal: AbortSignal.timeout(30_000) }),
          ])
          const stockData = res1.status === 'fulfilled' && res1.value.ok ? await res1.value.json().catch(() => ({})) : {}
          const etfData   = res2.status === 'fulfilled' && res2.value.ok ? await res2.value.json().catch(() => ({})) : {}
          console.log(`[watchlist] Bootstrap primary:`, stockData)
          console.log(`[watchlist] Bootstrap secondary:`, etfData)

          // Check if our ticker got bootstrapped
          const { data: afterBootstrap } = await serviceClient
            .from('assets')
            .select('bootstrapped')
            .eq('ticker', cleanTicker)
            .maybeSingle()

          const bootstrapped = afterBootstrap?.bootstrapped ?? false

          // Count rows inserted
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
              : `Added ${cleanTicker} — bootstrap queued, check back shortly`,
          }, { status: 201 })
        } catch (e: any) {
          console.warn(`[watchlist] Engine bootstrap failed: ${e.message}`)
        }
      } else {
        console.warn('[watchlist] ENGINE_BOOTSTRAP_URL or CRON_SECRET not set — bootstrap skipped')
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
