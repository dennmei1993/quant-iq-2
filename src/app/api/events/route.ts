// GET /api/events
// Query params: limit (max 50), impact, sector, since (ISO timestamp)
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

    let q = supabase
      .from("events")
      .select("id, headline, event_type, sectors, sentiment_score, impact_level, tickers, ai_summary, published_at, source")
      .eq("ai_processed", true)
      .order("published_at", { ascending: false })
      .limit(limit);

    if (impact) q = q.eq("impact_level", impact);
    if (sector) q = q.contains("sectors", [sector]);
    if (since)  q = q.gte("published_at", since);

    const { data, error } = await q;
    if (error) throw error;

    return NextResponse.json({ events: data ?? [], count: data?.length ?? 0 });
  } catch (e) {
    console.error('[api/events]', e)
    const { body, status } = errorResponse(e)
    return NextResponse.json(body, { status })
  }
}
