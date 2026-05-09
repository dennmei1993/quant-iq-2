// src/app/api/portfolio/watchlist/route.ts
// Ensure the POST handler includes `notes` in the insert.
// Find your existing POST handler and make sure it looks like this:

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

    // Upsert — update notes if ticker already exists
    const { data, error } = await supabase
      .from('portfolio_watchlist')
      .upsert(
        {
          portfolio_id,
          ticker: ticker.trim().toUpperCase(),
          name:   name ?? null,
          notes:  notes ?? null,        // ← make sure notes is here
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
