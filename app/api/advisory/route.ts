// GET  /api/advisory   — last 5 memos for the authenticated user
// POST /api/advisory   — generate a new memo (Pro / Advisor only)
import { NextRequest, NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/supabase";
import { generateAdvisoryMemo } from "@/lib/ai";

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase
      .from("advisory_memos")
      .select("id, content, model, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5);
    if (error) throw error;
    return NextResponse.json({ memos: data ?? [] });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();

    // Plan gate — free users cannot generate memos
    const { data: profile } = await supabase
      .from("profiles")
      .select("plan")
      .eq("id", user.id)
      .single();

    if (!profile || profile.plan === "free") {
      return NextResponse.json(
        { error: "Advisory memos require a Pro or Advisor plan", upgrade_url: "/pricing" },
        { status: 403 }
      );
    }

    const { portfolio_id } = await req.json() as { portfolio_id: string };
    if (!portfolio_id) {
      return NextResponse.json({ error: "portfolio_id is required" }, { status: 400 });
    }

    // Fetch holdings
    const { data: holdings } = await supabase
      .from("holdings")
      .select("ticker, name, quantity, avg_cost")
      .eq("portfolio_id", portfolio_id);

    if (!holdings?.length) {
      return NextResponse.json({ error: "No holdings in this portfolio" }, { status: 400 });
    }

    // Recent high/medium impact events (last 48 h)
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data: events } = await supabase
      .from("events")
      .select("headline, event_type, sectors, sentiment_score, impact_level, ai_summary")
      .eq("ai_processed", true)
      .in("impact_level", ["high", "medium"])
      .gte("published_at", since)
      .order("published_at", { ascending: false })
      .limit(10);

    // Active themes
    const { data: themes } = await supabase
      .from("themes")
      .select("name, timeframe, conviction, brief")
      .eq("is_active", true);

    const content = await generateAdvisoryMemo(
      holdings,
      events ?? [],
      themes ?? []
    );

    const { data: memo, error } = await supabase
      .from("advisory_memos")
      .insert({ user_id: user.id, portfolio_id, content, model: "claude-sonnet-4-20250514" })
      .select("id, content, created_at")
      .single();

    if (error) throw error;
    return NextResponse.json({ memo }, { status: 201 });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}
