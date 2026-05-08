// src/app/api/portfolio/builder/recommendation/route.ts
//
// GET    ?portfolio_id=   — fetch active recommendation (status='recommendations') for portfolio
// POST                    — mark a ticker as added (was_confirmed=true, added_at=now)
//                           also transitions run status to 'recommendations' if still 'draft'
// DELETE ?portfolio_id=   — abandon all existing recommendation runs for portfolio
//                           called when a new build is started

import { NextRequest, NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/supabase";

// ─── GET — fetch active recommendation ───────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const portfolioId = req.nextUrl.searchParams.get("portfolio_id");

    if (!portfolioId) {
      return NextResponse.json({ error: "portfolio_id required" }, { status: 400 });
    }

    // Verify ownership
    const { data: portfolio } = await supabase
      .from("portfolios").select("id")
      .eq("id", portfolioId).eq("user_id", user.id).single();
    if (!portfolio) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Find the most recent run with status = 'recommendations'
    const { data: run, error: runErr } = await supabase
      .from("portfolio_build_runs")
      .select(`
        id, mode, status, strategy, created_at,
        portfolio_build_tickers (
          id, ticker, name, signal, weight, price,
          rationale, theme_name, included,
          was_confirmed, added_at,
          fundamental_score, technical_score
        ),
        portfolio_build_themes (
          id, theme_name, suggested_allocation, selected, fit_reason, conviction
        )
      `)
      .eq("portfolio_id", portfolioId)
      .eq("user_id", user.id)
      .eq("status", "recommendations")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (runErr) throw runErr;

    if (!run) {
      return NextResponse.json({ recommendation: null });
    }

    return NextResponse.json({ recommendation: run });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}

// ─── POST — transition to recommendations + optionally mark ticker added ──────

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const body = await req.json();
    const { run_id, ticker_id, portfolio_id } = body;

    if (!run_id) return NextResponse.json({ error: "run_id required" }, { status: 400 });

    // Verify ownership
    const { data: run } = await supabase
      .from("portfolio_build_runs")
      .select("id, status, portfolio_id")
      .eq("id", run_id).eq("user_id", user.id).single();

    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

    // Transition status to 'recommendations' if still 'draft'
    if (run.status === "draft") {
      await supabase.from("portfolio_build_runs")
        .update({ status: "recommendations" })
        .eq("id", run_id);
    }

    // If ticker_id provided, mark that ticker as added
    if (ticker_id) {
      await supabase.from("portfolio_build_tickers")
        .update({ was_confirmed: true, added_at: new Date().toISOString() })
        .eq("id", ticker_id)
        .eq("run_id", run_id);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}

// ─── DELETE — abandon existing recommendations when new build starts ──────────

export async function DELETE(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const portfolioId = req.nextUrl.searchParams.get("portfolio_id");

    if (!portfolioId) return NextResponse.json({ error: "portfolio_id required" }, { status: 400 });

    // Verify ownership
    const { data: portfolio } = await supabase
      .from("portfolios").select("id")
      .eq("id", portfolioId).eq("user_id", user.id).single();
    if (!portfolio) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Abandon all 'recommendations' and 'draft' runs for this portfolio
    const { error } = await supabase
      .from("portfolio_build_runs")
      .update({ status: "abandoned" })
      .eq("portfolio_id", portfolioId)
      .eq("user_id", user.id)
      .in("status", ["recommendations", "draft"]);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}
