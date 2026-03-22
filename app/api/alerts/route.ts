// GET   /api/alerts            — last 20 alerts for the user
// PATCH /api/alerts            — mark alerts as read  { ids: string[] }
import { NextRequest, NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/supabase";

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase
      .from("alerts")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw error;

    const unread_count = (data ?? []).filter(a => !a.is_read).length;
    return NextResponse.json({ alerts: data ?? [], unread_count });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const { ids } = await req.json() as { ids: string[] };

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "ids[] is required" }, { status: 400 });
    }

    const { error } = await supabase
      .from("alerts")
      .update({ is_read: true })
      .in("id", ids)
      .eq("user_id", user.id); // RLS belt-and-braces

    if (error) throw error;
    return NextResponse.json({ ok: true, updated: ids.length });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}
