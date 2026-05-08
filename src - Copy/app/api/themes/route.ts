// GET /api/themes
// Query params: timeframe (1m | 3m | 6m) — omit to get all active
import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/supabase";
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  try {
    const supabase = createServiceClient();
    const timeframe = req.nextUrl.searchParams.get("timeframe");

    let q = supabase
      .from("themes")
      .select("id, name, label, timeframe, conviction, momentum, brief, candidate_tickers, expires_at, created_at")
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (timeframe) q = q.eq("timeframe", timeframe);

    const { data, error } = await q;
    if (error) throw error;

    return NextResponse.json({ themes: data ?? [] });
  } catch (e) {
    console.error('[api/themes]', e)
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}
