// src/app/api/portfolio/builder/run/route.ts
//
// POST /api/portfolio/builder/run   — create a new build run, return run_id
// GET  /api/portfolio/builder/run?portfolio_id=  — fetch run history for portfolio
// PATCH /api/portfolio/builder/run  — update run status (draft → confirmed/abandoned)

import { NextRequest, NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/supabase";

// ----------------------------------------------------------------------------
// POST — create run
// ----------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const { portfolio_id, mode } = await req.json();

    if (!portfolio_id || !mode) {
      return NextResponse.json({ error: "portfolio_id and mode are required" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("portfolio_build_runs")
      .insert({
        portfolio_id,
        user_id: user.id,
        mode,
        status: "draft",
      })
      .select("id")
      .single();

    if (error) throw error;
    return NextResponse.json({ run_id: data.id }, { status: 201 });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}

// ----------------------------------------------------------------------------
// GET — fetch run history for a portfolio
// ----------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const portfolioId = req.nextUrl.searchParams.get("portfolio_id");

    if (!portfolioId) {
      return NextResponse.json({ error: "portfolio_id is required" }, { status: 400 });
    }

    const { data: runs, error } = await supabase
      .from("portfolio_build_runs")
      .select(`
        id, mode, status, strategy, confirmed_at, created_at,
        portfolio_build_themes ( id, theme_name, suggested_allocation, selected, fit_reason, is_llm_generated ),
        portfolio_build_tickers ( id, ticker, name, signal, weight, price, rationale, theme_name, included, was_confirmed )
      `)
      .eq("portfolio_id", portfolioId)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) throw error;
    return NextResponse.json({ runs: runs ?? [] });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}

// ----------------------------------------------------------------------------
// PATCH — update run status + save themes/tickers snapshot
// ----------------------------------------------------------------------------

export async function PATCH(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const { run_id, status, strategy, themes, tickers } = await req.json();

    if (!run_id) {
      return NextResponse.json({ error: "run_id is required" }, { status: 400 });
    }

    // Verify ownership
    const { data: run } = await supabase
      .from("portfolio_build_runs")
      .select("id")
      .eq("id", run_id)
      .eq("user_id", user.id)
      .single();

    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

    // Update run row
    const update: Record<string, any> = {};
    if (status)   update.status   = status;
    if (strategy) update.strategy = strategy;
    if (status === "confirmed") update.confirmed_at = new Date().toISOString();

    if (Object.keys(update).length) {
      await supabase.from("portfolio_build_runs").update(update).eq("id", run_id);
    }

    // Upsert themes snapshot
    if (themes?.length) {
      await supabase.from("portfolio_build_themes").delete().eq("run_id", run_id);
      await supabase.from("portfolio_build_themes").insert(
        themes.map((t: any) => ({
          run_id,
          theme_id:             t.id ?? null,
          theme_name:           t.name,
          brief:                t.brief ?? null,
          conviction:           t.conviction ?? null,
          momentum:             t.momentum ?? null,
          fit_reason:           t.fit_reason ?? null,
          suggested_allocation: t.suggested_allocation ?? 0,
          selected:             t.selected ?? true,
          is_llm_generated:     t.is_llm_generated ?? false,
        }))
      );
    }

    // Upsert tickers snapshot
    if (tickers?.length) {
      await supabase.from("portfolio_build_tickers").delete().eq("run_id", run_id);
      await supabase.from("portfolio_build_tickers").insert(
        tickers.map((t: any) => ({
          run_id,
          ticker:        t.ticker,
          name:          t.name ?? null,
          theme_name:    t.theme_name ?? null,
          signal:        t.signal,
          weight:        t.weight ?? 0,
          price:         t.price ?? null,
          rationale:     t.rationale ?? null,
          included:      t.included ?? true,
          was_confirmed: t.was_confirmed ?? false,
        }))
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}
