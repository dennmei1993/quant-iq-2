// src/app/api/portfolio/builder/confirm/route.ts
//
// POST — save confirmed tickers: BUY → holdings, WATCH → portfolio_watchlist

import { NextRequest, NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const { portfolio_id, tickers, strategy } = await req.json();

    if (!portfolio_id) return NextResponse.json({ error: "portfolio_id required" }, { status: 400 });

    // Verify ownership
    const { data: portfolio } = await supabase
      .from("portfolios").select("id, total_capital, cash_pct")
      .eq("id", portfolio_id).eq("user_id", user.id).single();
    if (!portfolio) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });

    const p          = portfolio as any;
    const cashPct    = strategy?.cash_reserve_pct ?? p.cash_pct ?? 0;
    const investable = (p.total_capital ?? 0) * (1 - cashPct / 100);

    // Existing portfolio watchlist — deduplicate
    const { data: existingWL } = await supabase
      .from("portfolio_watchlist").select("ticker")
      .eq("portfolio_id", portfolio_id).eq("user_id", user.id);
    const wlSet = new Set((existingWL ?? []).map(w => w.ticker));

    const buys    = (tickers as any[]).filter(t => t.signal === "BUY");
    const watches = (tickers as any[]).filter(t => t.signal === "WATCH" && !wlSet.has(t.ticker));

    // Insert BUY → holdings with quantity + avg_cost
    if (buys.length > 0) {
      const holdingRows = buys.map((t: any) => {
        const capital  = (t.weight / 100) * investable;
        const quantity = t.price && t.price > 0 ? Math.floor(capital / t.price) : null;
        return {
          portfolio_id,
          ticker:     t.ticker,
          name:       t.name ?? null,
          avg_cost:   t.price ?? null,
          quantity,
          notes:      `[${t.theme_name}] ${t.rationale}`,
          asset_type: null,
        };
      });
      const { error } = await supabase.from("holdings").insert(holdingRows);
      if (error) throw error;
    }

    // Insert WATCH → portfolio_watchlist (portfolio-scoped, not global watchlist)
    if (watches.length > 0) {
      const wlRows = watches.map((t: any) => ({
        portfolio_id: portfolio_id,
        user_id:      user.id,
        ticker:       t.ticker,
        notes:        `[${t.theme_name ?? "Builder"}] ${t.rationale ?? ""}`.trim(),
        added_at:     new Date().toISOString(),
      }));
      // upsert — ignore if ticker already on this portfolio's watchlist
      const { error } = await supabase
        .from("portfolio_watchlist")
        .upsert(wlRows, { onConflict: "portfolio_id,ticker", ignoreDuplicates: true });
      if (error) throw error;
    }

    return NextResponse.json({
      ok:                true,
      inserted_holdings: buys.length,
      inserted_watchlist: watches.length,
    });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}
