// POST /api/billing/webhook
// Stripe webhook — handles subscription lifecycle events.
// Set in Stripe Dashboard → Webhooks → Add endpoint:
//   URL: https://your-app.vercel.app/api/billing/webhook
//   Events: customer.subscription.created, .updated, .deleted, invoice.payment_failed
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { stripe } from "@/lib/stripe";
import Stripe from "stripe";

// Required: Stripe needs the raw body to verify the signature
export const config = { api: { bodyParser: false } };

export async function POST(req: NextRequest) {
  const payload = await req.text();
  const sig     = req.headers.get("stripe-signature") ?? "";

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const supabase = createServiceClient();

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      if (["active", "trialing"].includes(sub.status)) {
        await upgradePlan(supabase, sub);
      }
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      await downgradePlan(supabase, sub);
      break;
    }
    case "invoice.payment_failed": {
      const inv = event.data.object as Stripe.Invoice;
      console.warn("[stripe] payment failed for customer:", inv.customer);
      break;
    }
  }

  return NextResponse.json({ received: true });
}

async function upgradePlan(
  supabase: ReturnType<typeof createServiceClient>,
  sub: Stripe.Subscription
) {
  const userId = sub.metadata?.supabase_user_id;
  const plan   = sub.metadata?.plan as "pro" | "advisor" | undefined;
  if (!userId || !plan) return;

  await supabase
    .from("profiles")
    .update({ plan, stripe_subscription_id: sub.id, updated_at: new Date().toISOString() })
    .eq("id", userId);

  // Welcome alert
  await supabase.from("alerts").insert({
    user_id: userId,
    type:    "macro_shift",
    title:   `Welcome to ${plan.charAt(0).toUpperCase() + plan.slice(1)}!`,
    body:    `Your account is now active. All ${plan} features are unlocked.`,
  });
}

async function downgradePlan(
  supabase: ReturnType<typeof createServiceClient>,
  sub: Stripe.Subscription
) {
  const userId = sub.metadata?.supabase_user_id;
  if (!userId) return;

  await supabase
    .from("profiles")
    .update({ plan: "free", stripe_subscription_id: null, updated_at: new Date().toISOString() })
    .eq("id", userId);
}
