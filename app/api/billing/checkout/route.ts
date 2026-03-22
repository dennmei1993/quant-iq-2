// POST /api/billing/checkout
// Body: { plan: "pro" | "advisor", interval?: "monthly" | "annual" }
// Returns: { checkout_url: string }
import { NextRequest, NextResponse } from "next/server";
import { requireUser, createServiceClient, errorResponse } from "@/lib/supabase";
import { stripe, PRICES } from "@/lib/stripe";

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const { plan, interval = "monthly" } = await req.json() as {
      plan: "pro" | "advisor";
      interval?: "monthly" | "annual";
    };

    const priceId = PRICES[`${plan}_${interval}`];
    if (!priceId) {
      return NextResponse.json({ error: `Unknown plan: ${plan}_${interval}` }, { status: 400 });
    }

    // Get or create Stripe customer
    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_customer_id, email")
      .eq("id", user.id)
      .single();

    let customerId = profile?.stripe_customer_id ?? null;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: profile?.email ?? user.email ?? "",
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
      // Persist using service client (bypasses RLS for this write)
      await createServiceClient()
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", user.id);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "subscription",
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?upgraded=1`,
      cancel_url:  `${process.env.NEXT_PUBLIC_APP_URL}/pricing`,
      allow_promotion_codes: true,
      subscription_data: {
        trial_period_days: plan === "pro" ? 14 : undefined,
        metadata: { supabase_user_id: user.id, plan },
      },
      metadata: { supabase_user_id: user.id, plan },
    });

    return NextResponse.json({ checkout_url: session.url });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}
