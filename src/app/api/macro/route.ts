/**
 * app/api/macro/route.ts
 * GET /api/macro — returns all 6 macro sentiment scores.
 * Public — no auth required.
 */

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

type MacroRow = {
  aspect:      string
  score:       number
  direction:   string
  commentary:  string
  event_count: number
  scored_at:   string
}

export async function GET() {
  try {
    const supabase = createServiceClient()

    const { data, error } = await (supabase
      .from('macro_scores')
      .select('aspect, score, direction, commentary, event_count, scored_at')
      .order('aspect') as unknown as Promise<{ data: MacroRow[] | null; error: any }>)

    if (error) throw error

    const scores = data ?? []

    return NextResponse.json({
      scores,
      updated_at: scores[0]?.scored_at ?? null,
    })
  } catch (e) {
    console.error('[api/macro]', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
