// GET /api/assets
// Query params: type (stock|etf|crypto|commodity), signal (buy|watch|hold|avoid)
import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/supabase";
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  try {
    const supabase = createServiceClient();
    const p      = req.nextUrl.searchParams;
    const type   = p.get("type");
    const signal = p.get("signal");

    let q = supabase
      .from("assets")
      .select(`
        ticker, name, asset_type, sector,
        asset_signals ( signal, score, price_usd, change_pct, rationale, updated_at )
      `)
      .order("ticker");

    if (type) q = q.eq("asset_type", type);

    const { data, error } = await q;
    if (error) throw error;

    type RawSignal = { signal: string; score: number; price_usd: number | null; change_pct: number | null; rationale: string | null; updated_at: string };
    type RawAsset  = { ticker: string; name: string; asset_type: string; sector: string | null; asset_signals: RawSignal[] };

    let assets = (data as RawAsset[] ?? []).map(a => ({
      ticker:     a.ticker,
      name:       a.name,
      asset_type: a.asset_type,
      sector:     a.sector,
      signal:     a.asset_signals?.[0] ?? null,
    }));

    if (signal) assets = assets.filter(a => a.signal?.signal === signal);

    // Sort by signal score descending
    assets.sort((a, b) => (b.signal?.score ?? 50) - (a.signal?.score ?? 50));

    return NextResponse.json({ assets, count: assets.length });
  } catch (e) {
    console.error('[api/assets]', e)
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}
