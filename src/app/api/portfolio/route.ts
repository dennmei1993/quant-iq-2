// src/app/api/portfolio/route.ts
//
// GET    /api/portfolio?portfolio_id=   — fetch portfolio + enriched holdings
//                                         (omit portfolio_id to get first/all)
// POST   /api/portfolio                 — action: "create_portfolio" | "add_holding"
// PATCH  /api/portfolio                 — update portfolio preferences
// DELETE /api/portfolio?holding_id=     — remove a holding
// DELETE /api/portfolio?portfolio_id=   — remove a portfolio and all its holdings

import { NextRequest, NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const portfolioId = req.nextUrl.searchParams.get("portfolio_id");

    const { data: portfolios, error: pErr } = await supabase
      .from("portfolios")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });

    if (pErr) throw pErr;

    if (!portfolios?.length) {
      return NextResponse.json({ portfolios: [], holdings: [] });
    }

    const target =
      (portfolioId ? portfolios.find(p => p.id === portfolioId) : undefined) ??
      portfolios[0];

    const { data: holdings, error: hErr } = await supabase
      .from("holdings")
      .select("*")
      .eq("portfolio_id", target.id)
      .order("created_at", { ascending: false });

    if (hErr) throw hErr;

    const tickers = (holdings ?? []).map(h => h.ticker).filter(t => t !== "CASH");
    let signalMap: Record<string, { signal: string; score: number | null; price_usd: number | null; change_pct: number | null }> = {};

    if (tickers.length) {
      const { data: signals } = await supabase
        .from("asset_signals")
        .select("ticker, signal, score, price_usd, change_pct")
        .in("ticker", tickers);
      signalMap = Object.fromEntries((signals ?? []).map(s => [s.ticker, s]));
    }

    const enriched = (holdings ?? []).map(h => ({
      ...h,
      signal: h.ticker === "CASH" ? null : (signalMap[h.ticker] ?? null),
    }));

    return NextResponse.json({ portfolios, portfolio: target, holdings: enriched });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const body = await req.json();
    const { action } = body;

    if (action === "create_portfolio") {
      const { name, risk_appetite, benchmark, target_holdings, preferred_assets, cash_pct, investment_horizon, total_capital, universe, sector_exclude } = body;
      if (!name?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });

      const { data: portfolio, error } = await supabase
        .from("portfolios")
        .insert({
          user_id: user.id, name: name.trim(),
          risk_appetite:      risk_appetite      ?? "moderate",
          benchmark:          benchmark          ?? "SPY",
          target_holdings:    target_holdings    ?? 20,
          preferred_assets:   preferred_assets   ?? [],
          cash_pct:           cash_pct           ?? 0,
          investment_horizon: investment_horizon ?? "long",
          total_capital:      total_capital      ?? 0,
          universe:           body.universe       ?? [],
          sector_exclude:     body.sector_exclude ?? [],
        })
        .select().single();

      if (error) throw error;
      return NextResponse.json({ portfolio }, { status: 201 });
    }

    if (action === "add_holding") {
      const { portfolio_id, ticker, name, asset_type, quantity, avg_cost, notes } = body;
      if (!ticker?.trim()) return NextResponse.json({ error: "ticker is required" }, { status: 400 });

      const { data: portfolio, error: pErr } = await supabase
        .from("portfolios").select("id").eq("id", portfolio_id).eq("user_id", user.id).single();
      if (pErr || !portfolio) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });

      const { data: holding, error } = await supabase
        .from("holdings")
        .insert({
          portfolio_id: portfolio.id, ticker: ticker.trim().toUpperCase(),
          name: name ?? null, asset_type: asset_type ?? null,
          quantity: quantity ? Number(quantity) : null,
          avg_cost: avg_cost ? Number(avg_cost) : null,
          notes: notes ?? null,
        })
        .select().single();

      if (error) throw error;
      return NextResponse.json({ holding }, { status: 201 });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const holdingId = req.nextUrl.searchParams.get("holding_id");

    if (holdingId) {
      const { quantity, avg_cost } = await req.json();
      const { data: holding } = await supabase
        .from("holdings").select("id, portfolios!inner(user_id)").eq("id", holdingId).single();
      const owner = (holding?.portfolios as unknown as { user_id: string } | null)?.user_id;
      if (!holding || owner !== user.id) return NextResponse.json({ error: "Not found" }, { status: 404 });

      const { error } = await supabase.from("holdings").update({
        quantity: quantity != null ? Number(quantity) : null,
        avg_cost: avg_cost != null ? Number(avg_cost) : null,
      }).eq("id", holdingId);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    const { portfolio_id, ...prefs } = await req.json();
    if (!portfolio_id) return NextResponse.json({ error: "portfolio_id is required" }, { status: 400 });

    const ALLOWED = new Set(["name", "risk_appetite", "benchmark", "target_holdings", "preferred_assets", "cash_pct", "investment_horizon", "total_capital", "universe", "sector_exclude"]);
    const update = Object.fromEntries(Object.entries(prefs).filter(([k]) => ALLOWED.has(k)));
    if (!Object.keys(update).length) return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });

    const { error } = await supabase.from("portfolios").update(update).eq("id", portfolio_id).eq("user_id", user.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const holding_id   = req.nextUrl.searchParams.get("holding_id");
    const portfolio_id = req.nextUrl.searchParams.get("portfolio_id");

    // ── Delete portfolio ──────────────────────────────────────────────────────
    if (portfolio_id) {
      const { data: portfolio } = await supabase
        .from("portfolios")
        .select("id")
        .eq("id", portfolio_id)
        .eq("user_id", user.id)
        .single();

      if (!portfolio) {
        return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
      }

      // Delete all holdings first (cascade may not be set)
      await supabase.from("holdings").delete().eq("portfolio_id", portfolio_id);
      await supabase.from("portfolios").delete().eq("id", portfolio_id);
      return NextResponse.json({ ok: true });
    }

    // ── Delete holding ────────────────────────────────────────────────────────
    if (!holding_id) {
      return NextResponse.json({ error: "holding_id or portfolio_id is required" }, { status: 400 });
    }

    // Verify ownership via portfolio join
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