// GET /api/events
// Query params: limit (max 50), impact (min score e.g. 7), sector, since (ISO timestamp)
import { NextRequest, NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/supabase";
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  try {
    const supabase = createServiceClient();
    const p = req.nextUrl.searchParams;

    const limit  = Math.min(Number(p.get("limit") ?? 30), 50);
    const impact = p.get("impact");
    const sector = p.get("sector");
    const since  = p.get("since");

    // Default recency window: last 48h
    // Callers can override with ?since= for older data
    const defaultSince = since ?? new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    let q = supabase
      .from("events")
      .select("id, headline, event_type, sectors, sentiment_score, impact_score, tickers, ai_summary, published_at, source")
      .eq("ai_processed", true)
      .gte("published_at", defaultSince)
      .order("impact_score", { ascending: false })
      .order("published_at", { ascending: false })
      .limit(limit);

    if (impact) q = q.gte("impact_score", Number(impact));
    if (sector) q = q.contains("sectors", [sector]);

    const { data, error } = await q;
    if (error) throw error;

    // If recency window yields fewer than requested, backfill with older events
    const events = data ?? [];
    if (events.length < limit && !since) {
      const needed = limit - events.length;
      const existingIds = events.map(e => e.id);

      let backfillQ = supabase
        .from("events")
        .select("id, headline, event_type, sectors, sentiment_score, impact_score, tickers, ai_summary, published_at, source")
        .eq("ai_processed", true)
        .lt("published_at", defaultSince)
        .order("impact_score", { ascending: false })
        .order("published_at", { ascending: false })
        .limit(needed);

      if (impact)          backfillQ = backfillQ.gte("impact_score", Number(impact));
      if (sector)          backfillQ = backfillQ.contains("sectors", [sector]);
      if (existingIds.length) backfillQ = backfillQ.not("id", "in", `(${existingIds.map(id => `"${id}"`).join(',')})`);

      const { data: backfill } = await backfillQ;
      events.push(...(backfill ?? []));
    }

    return NextResponse.json({ events, count: events.length });
  } catch (e) {
    console.error('[api/events]', e)
    const { body, status } = errorResponse(e)
    return NextResponse.json(body, { status })
  }
}
