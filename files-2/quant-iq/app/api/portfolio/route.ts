// GET    /api/portfolio          — fetch portfolio + enriched holdings
// POST   /api/portfolio          — add a holding
// DELETE /api/portfolio?holding_id=  — remove a holding
import { NextRequest, NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/supabase";

export async function GET() {
  try {
    const { supabase, user } = await requireUser();

    // Get or create portfolio
    let { data: portfolio } = await supabase
      .from("portfolios")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (!portfolio) {
      const { data: created } = await supabase
        .from("portfolios")
        .insert({ user_id: user.id })
        .select()
        .single();
      portfolio = created;
    }

    const { data: holdings } = await supabase
      .from("holdings")
      .select("*")
      .eq("portfolio_id", portfolio!.id)
      .order("created_at", { ascending: false });

    // Enrich with latest signal
    const tickers = (holdings ?? []).map(h => h.ticker);
    let signalMap: Record<string, { signal: string; score: number; price_usd: number | null; change_pct: number | null }> = {};

    if (tickers.length) {
      const { data: signals } = await supabase
        .from("asset_signals")
        .select("ticker, signal, score, price_usd, change_pct")
        .in("ticker", tickers);
      signalMap = Object.fromEntries((signals ?? []).map(s => [s.ticker, s]));
    }

    const enriched = (holdings ?? []).map(h => ({ ...h, signal: signalMap[h.ticker] ?? null }));
    return NextResponse.json({ portfolio, holdings: enriched });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const body = await req.json();
    const { ticker, name, asset_type, quantity, avg_cost, notes } = body;

    if (!ticker) return NextResponse.json({ error: "ticker is required" }, { status: 400 });

    let { data: portfolio } = await supabase
      .from("portfolios")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!portfolio) {
      const { data: created } = await supabase
        .from("portfolios")
        .insert({ user_id: user.id })
        .select("id")
        .single();
      portfolio = created;
    }

    const { data: holding, error } = await supabase
      .from("holdings")
      .insert({
        portfolio_id: portfolio!.id,
        ticker:    ticker.toUpperCase(),
        name:      name      ?? null,
        asset_type: asset_type ?? null,
        quantity:  quantity  ? Number(quantity)  : null,
        avg_cost:  avg_cost  ? Number(avg_cost)  : null,
        notes:     notes     ?? null,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ holding }, { status: 201 });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const holding_id = req.nextUrl.searchParams.get("holding_id");
    if (!holding_id) return NextResponse.json({ error: "holding_id required" }, { status: 400 });

    // Verify ownership
    const { data: holding } = await supabase
      .from("holdings")
      .select("id, portfolios!inner(user_id)")
      .eq("id", holding_id)
      .single();

    const owner = (holding?.portfolios as unknown as { user_id: string } | null)?.user_id;
    if (!holding || owner !== user.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await supabase.from("holdings").delete().eq("id", holding_id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}
