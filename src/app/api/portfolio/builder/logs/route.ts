// src/app/api/portfolio/builder/logs?run_id=
// GET — fetch LLM logs for a specific build run

import { NextRequest, NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const runId = req.nextUrl.searchParams.get("run_id");

    if (!runId) return NextResponse.json({ error: "run_id is required" }, { status: 400 });

    // Verify ownership via join
    const { data: run } = await supabase
      .from("portfolio_build_runs")
      .select("id")
      .eq("id", runId)
      .eq("user_id", user.id)
      .single();

    if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { data: logs, error } = await supabase
      .from("portfolio_build_llm_logs")
      .select("id, step, prompt, response, model, input_tokens, output_tokens, latency_ms, created_at")
      .eq("run_id", runId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return NextResponse.json({ logs: logs ?? [] });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}
