// src/app/api/portfolio/watchlist/route.ts
//
// GET    /api/portfolio/watchlist?portfolio_id=   — fetch watchlist enriched with signals
// POST   /api/portfolio/watchlist                 — add ticker(s) to portfolio watchlist
// DELETE /api/portfolio/watchlist?id=             — remove a watchlist entry by row id

import { NextRequest, NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/supabase";

// ----------------------------------------------------------------------------
// GET
// ----------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const portfolioId = req.nextUrl.searchParams.get("portfolio_id");

    if (!portfolioId) {
      return NextResponse.json({ error: "portfolio_id is required" }, { status: 400 });
    }

    // Fetch watchlist rows
    const { data: rows, error: wErr } = await supabase
      .from("portfolio_watchlist")
      .select("id, ticker, notes, added_at")
      .eq("portfolio_id", portfolioId)
      .eq("user_id", user.id)
      .order("added_at", { ascending: false });

    if (wErr) throw wErr;
    if (!rows?.length) return NextResponse.json({ watchlist: [] });

    const tickers = rows.map(r => r.ticker);

    // Enrich with asset metadata + live signals in parallel
    const [{ data: signals }, { data: assets }] = await Promise.all([
      supabase
        .from("asset_signals")
        .select("ticker, signal, fundamental_score, technical_score, price_usd, change_pct, rationale")
        .in("ticker", tickers),
      supabase
        .from("assets")
        .select("ticker, name, sector, asset_type, analyst_rating, logo_url")
        .in("ticker", tickers),
    ]);

    const signalMap = new Map((signals ?? []).map(s => [s.ticker, s]));
    const assetMap  = new Map((assets  ?? []).map(a => [a.ticker, a]));

    const enriched = rows.map(r => ({
      ...r,
      ...assetMap.get(r.ticker),
      signal: signalMap.get(r.ticker) ?? null,
    }));

    return NextResponse.json({ watchlist: enriched });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}

// ----------------------------------------------------------------------------
// POST — add one or many tickers
// ----------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const body = await req.json();

    const { portfolio_id } = body;
    if (!portfolio_id) {
      return NextResponse.json({ error: "portfolio_id is required" }, { status: 400 });
    }

    // Verify portfolio ownership
    const { data: portfolio } = await supabase
      .from("portfolios")
      .select("id")
      .eq("id", portfolio_id)
      .eq("user_id", user.id)
      .single();
    if (!portfolio) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });

    // Accept single ticker or array
    const items: Array<{ ticker: string; notes?: string }> = Array.isArray(body.tickers)
      ? body.tickers
      : [{ ticker: body.ticker, notes: body.notes }];

    const rows = items
      .filter(i => i.ticker?.trim())
      .map(i => ({
        portfolio_id,
        user_id:  user.id,
        ticker:   i.ticker.trim().toUpperCase(),
        notes:    i.notes ?? null,
        added_at: new Date().toISOString(),
      }));

    if (!rows.length) {
      return NextResponse.json({ error: "No valid tickers provided" }, { status: 400 });
    }

    // Upsert — ignore conflicts (same portfolio + ticker already exists)
    const { data, error } = await supabase
      .from("portfolio_watchlist")
      .upsert(rows, { onConflict: "portfolio_id,ticker", ignoreDuplicates: true })
      .select();

    if (error) throw error;
    return NextResponse.json({ inserted: data?.length ?? 0 }, { status: 201 });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}

// ----------------------------------------------------------------------------
// DELETE — remove by row id
// ----------------------------------------------------------------------------

export async function DELETE(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const id = req.nextUrl.searchParams.get("id");

    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const { error } = await supabase
      .from("portfolio_watchlist")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);   // ownership enforced by RLS + explicit check

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}
