// GET /api/events
// Query params: limit (max 50), impact (min score e.g. 7), sector, since (ISO timestamp)
import { NextRequest, NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/supabase";
import { createServiceClient } from '@/lib/supabase/server'

type EventRow = {
  id:              string
  headline:        string
  event_type:      string | null
  sectors:         string[] | null
  sentiment_score: number | null
  impact_score:    number | null
  tickers:         string[] | null
  ai_summary:      string | null
  published_at:    string
  source:          string | null
}

const SELECT = "id, headline, event_type, sectors, sentiment_score, impact_score, tickers, ai_summary, published_at, source"

export async function GET(req: NextRequest) {
  try {
    const supabase = createServiceClient();
    const p = req.nextUrl.searchParams;

    const limit  = Math.min(Number(p.get("limit") ?? 30), 50);
    const impact = p.get("impact");
    const sector = p.get("sector");
    const since  = p.get("since");

    const defaultSince = since ?? new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString();

    // Pass 1: recent events ordered by impact
    let q = supabase
      .from("events")
      .select(SELECT)
      .eq("ai_processed", true)
      .gte("published_at", defaultSince)
      .order("impact_score", { ascending: false })
      .order("published_at", { ascending: false })
      .limit(limit);

    if (impact) q = q.gte("impact_score", Number(impact));
    if (sector) q = q.contains("sectors", [sector]);

    const { data, error } = await (q as unknown as Promise<{ data: EventRow[] | null; error: any }>);
    if (error) throw error;

    const events: EventRow[] = data ?? [];

    // Pass 2: backfill with older events if recent window is sparse
    if (events.length < limit && !since) {
      const needed      = limit - events.length;
      const existingIds = events.map(e => e.id);

      let backfillQ = supabase
        .from("events")
        .select(SELECT)
        .eq("ai_processed", true)
        .lt("published_at", defaultSince)
        .order("impact_score", { ascending: false })
        .order("published_at", { ascending: false })
        .limit(needed);

      if (impact) backfillQ = backfillQ.gte("impact_score", Number(impact));
      if (sector) backfillQ = backfillQ.contains("sectors", [sector]);
      if (existingIds.length) {
        backfillQ = backfillQ.not("id", "in", `(${existingIds.map(id => `"${id}"`).join(',')})`)
      }

      const { data: backfill } = await (backfillQ as unknown as Promise<{ data: EventRow[] | null }>);
      events.push(...(backfill ?? []));
    }

    return NextResponse.json({ events, count: events.length });
  } catch (e) {
    console.error('[api/events]', e)
    const { body, status } = errorResponse(e)
    return NextResponse.json(body, { status })
  }
}
