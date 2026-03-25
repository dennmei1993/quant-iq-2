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
    const profileResult = await (supabase
      .from("profiles")
      .select("plan")
      .eq("id", user.id)
      .single() as unknown as Promise<{ data: { plan: string } | null }>)

    const profile = profileResult.data

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

    // Recent events with impact_score >= 3 (medium+) in last 48h
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const eventsResult = await (supabase
      .from("events")
      .select("headline, event_type, sectors, sentiment_score, impact_score, ai_summary")
      .eq("ai_processed", true)
      .gte("impact_score", 3)
      .gte("published_at", since)
      .order("impact_score", { ascending: false })
      .order("published_at", { ascending: false })
      .limit(10) as unknown as Promise<{ data: {
        headline: string
        event_type: string | null
        sectors: string[] | null
        sentiment_score: number | null
        impact_score: number | null
        ai_summary: string | null
      }[] | null }>)

    const events = eventsResult.data ?? []

    // Active themes
    const { data: themes } = await supabase
      .from("themes")
      .select("name, timeframe, conviction, brief")
      .eq("is_active", true);

    const macroContext = themes?.length
      ? `Active themes: ${themes.map((t: any) => `${t.name} (${t.timeframe}, conviction ${t.conviction ?? 0})`).join('; ')}`
      : undefined

    const content = await generateAdvisoryMemo(
      holdings,
      events.map(e => ({
        headline:        e.headline,
        ai_summary:      e.ai_summary,
        sentiment_score: e.sentiment_score ?? 0,
        impact_score:    e.impact_score ?? 1,
      })),
      macroContext
    );

    const memoResult = await (supabase
      .from("advisory_memos") as any)
      .insert({ user_id: user.id, portfolio_id, content, model: "claude-sonnet-4-20250514" })
      .select("id, content, created_at")
      .single()

    const memo = (memoResult as any).data
    const error = (memoResult as any).error

    if (error) throw error;
    return NextResponse.json({ memo }, { status: 201 });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}
