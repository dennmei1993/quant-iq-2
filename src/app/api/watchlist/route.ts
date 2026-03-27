/**
 * POST /api/watchlist
 * Creates a new watchlist theme.
 * Admin-only — requires ADMIN_SECRET header.
 *
 * Body: {
 *   name:       string
 *   brief:      string
 *   tickers:    string[]          // must exist in assets table
 *   conviction: number (0–100)
 *   momentum:   string
 * }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { syncThemeTickers } from '@/lib/theme-tickers'

export async function POST(req: NextRequest) {
  // Admin gate — check secret header
  const secret = req.headers.get('x-admin-secret')
  if (secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json() as {
      name:       string
      brief?:     string
      tickers:    string[]
      conviction?: number
      momentum?:  string
    }

    if (!body.name?.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }
    if (!body.tickers?.length) {
      return NextResponse.json({ error: 'tickers array is required' }, { status: 400 })
    }

    const supabase  = createServiceClient()
    const conviction = body.conviction ?? 70
    const tickers    = body.tickers.map(t => t.toUpperCase().trim())

    // Insert theme
    const insertResult = await (supabase
      .from('themes') as any)
      .insert({
        name:              body.name.trim(),
        label:             'WATCHLIST',
        timeframe:         '6m',
        conviction,
        momentum:          body.momentum ?? 'neutral',
        brief:             body.brief ?? null,
        candidate_tickers: tickers,
        is_active:         true,
        theme_type:        'watchlist',
      })
      .select('id, name, conviction')
      .single()

    const theme    = (insertResult as any).data as { id: string; name: string; conviction: number } | null
    const insertErr = (insertResult as any).error

    if (insertErr) throw new Error(insertErr.message)
    if (!theme)    throw new Error('Insert returned no data')

    // Sync tickers into theme_tickers
    const tickerWeights = tickers.map(ticker => ({
      ticker,
      weight:    1.0,
      rationale: null as string | null,
    }))

    const syncResult = await syncThemeTickers(
      supabase,
      theme.id,
      theme.conviction,
      tickerWeights as any
    )

    return NextResponse.json({
      ok:      true,
      theme,
      synced:  syncResult.upserted,
      skipped: syncResult.skipped,
    }, { status: 201 })

  } catch (e) {
    console.error('[api/watchlist]', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

/**
 * DELETE /api/watchlist?id=<theme_id>
 * Deactivates a watchlist theme (soft delete).
 */
export async function DELETE(req: NextRequest) {
  const secret = req.headers.get('x-admin-secret')
  if (secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  try {
    const supabase = createServiceClient()
    await (supabase.from('themes') as any)
      .update({ is_active: false })
      .eq('id', id)
      .eq('theme_type', 'watchlist')   // safety — only deactivate watchlist themes

    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
