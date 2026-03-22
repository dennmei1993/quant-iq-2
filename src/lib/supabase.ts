// lib/supabase.ts
// Supabase client factory.
// - createServiceClient()  → bypasses RLS, for cron jobs only
// - createServerClient()   → reads cookies, enforces RLS, for API routes
// - requireUser()          → extracts authed user or throws 401
// - requirePlan()          → guards plan-gated endpoints

import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SVC  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// ── Service client (cron jobs / webhook handlers) ─────────────────────────────
export function createServiceClient() {
  return createClient(URL, SVC, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── Server client (API routes — enforces RLS via session cookies) ─────────────
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();
  return createServerClient(URL, ANON, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) =>
        toSet.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options)
        ),
    },
  });
}

// ── requireUser — throws if not authenticated ─────────────────────────────────
export async function requireUser() {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Unauthorized");
  return { supabase, user };
}

// ── requirePlan — throws if user plan is below minimum ───────────────────────
export async function requirePlan(minPlan: "pro" | "advisor") {
  const { supabase, user } = await requireUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("plan")
    .eq("id", user.id)
    .single();

  const rank = { free: 0, pro: 1, advisor: 2 } as const;
  const current = rank[(profile?.plan as keyof typeof rank) ?? "free"];
  const required = rank[minPlan];

  if (current < required) {
    throw new Error(`upgrade_required:${minPlan}`);
  }
  return { supabase, user, plan: profile?.plan as string };
}

// ── errorResponse — consistent API error shape ────────────────────────────────
export function errorResponse(err: unknown) {
  const msg = err instanceof Error ? err.message : "Internal error";
  if (msg === "Unauthorized")          return { body: { error: "Unauthorized" }, status: 401 };
  if (msg.startsWith("upgrade_required")) {
    const plan = msg.split(":")[1];
    return { body: { error: `${plan} plan required`, upgrade_url: "/pricing" }, status: 403 };
  }
  return { body: { error: msg }, status: 500 };
}
