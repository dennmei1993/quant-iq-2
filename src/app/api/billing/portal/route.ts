// POST /api/billing/portal
// Returns: { portal_url: string }  — Stripe Customer Portal for self-serve plan management
import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/supabase";
import { stripe } from "@/lib/stripe";

export async function POST() {
  try {
    const { supabase, user } = await requireUser();

    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .single();

    if (!profile?.stripe_customer_id) {
      return NextResponse.json({ error: "No active subscription found" }, { status: 400 });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
    });

    return NextResponse.json({ portal_url: session.url });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}
