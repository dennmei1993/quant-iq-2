// lib/stripe.ts
import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-01-27.acacia",
});

export const PRICES: Record<string, string | undefined> = {
  pro_monthly:      process.env.STRIPE_PRO_MONTHLY_PRICE_ID,
  pro_annual:       process.env.STRIPE_PRO_ANNUAL_PRICE_ID,
  advisor_monthly:  process.env.STRIPE_ADVISOR_MONTHLY_PRICE_ID,
  advisor_annual:   process.env.STRIPE_ADVISOR_ANNUAL_PRICE_ID,
};

export type PlanKey = "pro" | "advisor";
export type IntervalKey = "monthly" | "annual";
