// src/app/api/portfolio/transaction/route.ts
//
// POST /api/portfolio/transaction
//   body: { portfolio_id, type, ticker, quantity, price, total_amount, fees, executed_at, notes }
//   types: buy | sell | dividend | deposit | withdrawal
//
// After every transaction, recalculates the affected holding (avg_cost, quantity, realised_gain)
// Uses average cost method for simplicity

import { NextRequest, NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/supabase";

// ─── Position recalculation ───────────────────────────────────────────────────

async function recalculatePosition(
  supabase:    any,
  portfolioId: string,
  ticker:      string
) {
  // Fetch all transactions for this ticker in this portfolio, oldest first
  const { data: txns, error } = await supabase
    .from("transactions")
    .select("type, quantity, price, total_amount, fees, executed_at")
    .eq("portfolio_id", portfolioId)
    .eq("ticker", ticker)
    .in("type", ["buy", "sell", "split"])
    .order("executed_at", { ascending: true });

  if (error) throw error;
  if (!txns?.length) {
    // No transactions — remove the holding if it exists
    await supabase.from("holdings").delete()
      .eq("portfolio_id", portfolioId).eq("ticker", ticker);
    return;
  }

  // Average cost method
  let quantity      = 0;
  let totalCost     = 0;   // running cost basis
  let realisedGain  = 0;
  let firstBoughtAt: string | null = null;

  for (const txn of txns) {
    const qty   = Number(txn.quantity ?? 0);
    const price = Number(txn.price   ?? 0);
    const fees  = Number(txn.fees    ?? 0);

    if (txn.type === "buy") {
      if (!firstBoughtAt) firstBoughtAt = txn.executed_at;
      // Weighted average cost
      const newCost = totalCost + (qty * price) + fees;
      quantity      = quantity + qty;
      totalCost     = newCost;

    } else if (txn.type === "sell") {
      const avgCost = quantity > 0 ? totalCost / quantity : 0;
      const gain    = (price * qty) - (avgCost * qty) - fees;
      realisedGain  += gain;
      quantity      -= qty;
      totalCost     -= avgCost * qty;
      if (quantity < 0) quantity = 0;
      if (totalCost < 0) totalCost = 0;

    } else if (txn.type === "split") {
      // Stock split — quantity changes, avg_cost adjusts inversely
      // qty here represents the split ratio (e.g. 2 for 2:1 split)
      const ratio = qty;
      quantity    = quantity * ratio;
      totalCost   = totalCost; // total cost stays the same
    }
  }

  const avgCost = quantity > 0 ? totalCost / quantity : 0;

  if (quantity <= 0) {
    // Position fully closed — remove holding, realised gain is preserved in transactions
    await supabase.from("holdings").delete()
      .eq("portfolio_id", portfolioId).eq("ticker", ticker);
    return;
  }

  // Upsert holding with recalculated values
  await supabase.from("holdings").upsert({
    portfolio_id:    portfolioId,
    ticker:          ticker.toUpperCase(),
    quantity:        Math.round(quantity * 1e8) / 1e8,  // 8 decimal precision
    avg_cost:        Math.round(avgCost * 1e4) / 1e4,   // 4 decimal precision
    realised_gain:   Math.round(realisedGain * 1e4) / 1e4,
    first_bought_at: firstBoughtAt,
  }, {
    onConflict: "portfolio_id,ticker",
    ignoreDuplicates: false,
  });
}

// ─── GET — fetch transactions for a portfolio or specific ticker ──────────────

export async function GET(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const portfolioId = req.nextUrl.searchParams.get("portfolio_id");
    const ticker      = req.nextUrl.searchParams.get("ticker");
    const limit       = parseInt(req.nextUrl.searchParams.get("limit") ?? "50");

    if (!portfolioId) {
      return NextResponse.json({ error: "portfolio_id is required" }, { status: 400 });
    }

    // Verify ownership
    const { data: portfolio } = await supabase
      .from("portfolios").select("id").eq("id", portfolioId).eq("user_id", user.id).single();
    if (!portfolio) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });

    let query = supabase
      .from("transactions")
      .select("*")
      .eq("portfolio_id", portfolioId)
      .order("executed_at", { ascending: false })
      .limit(limit);

    if (ticker) query = query.eq("ticker", ticker.toUpperCase());

    const { data: transactions, error } = await query;
    if (error) throw error;

    return NextResponse.json({ transactions: transactions ?? [] });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}

// ─── POST — record a transaction ─────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const body = await req.json();
    const {
      portfolio_id,
      type,
      ticker,
      quantity,
      price,
      total_amount,
      fees = 0,
      executed_at,
      notes,
    } = body;

    // Validate
    if (!portfolio_id) return NextResponse.json({ error: "portfolio_id is required" }, { status: 400 });
    if (!type)         return NextResponse.json({ error: "type is required" }, { status: 400 });

    const VALID_TYPES = ["buy", "sell", "dividend", "deposit", "withdrawal", "split"];
    if (!VALID_TYPES.includes(type)) {
      return NextResponse.json({ error: `type must be one of: ${VALID_TYPES.join(", ")}` }, { status: 400 });
    }

    // Ticker required for buy/sell/dividend/split
    if (["buy", "sell", "dividend", "split"].includes(type) && !ticker) {
      return NextResponse.json({ error: "ticker is required for this transaction type" }, { status: 400 });
    }

    // Verify portfolio ownership
    const { data: portfolio } = await supabase
      .from("portfolios").select("id").eq("id", portfolio_id).eq("user_id", user.id).single();
    if (!portfolio) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });

    // Compute total_amount if not provided
    let amount = total_amount;
    if (amount == null && quantity != null && price != null) {
      amount = Number(quantity) * Number(price);
    }
    if (amount == null) {
      return NextResponse.json({ error: "total_amount is required" }, { status: 400 });
    }

    // For sell: validate we have enough shares
    if (type === "sell" && ticker) {
      const { data: holding } = await supabase
        .from("holdings").select("quantity")
        .eq("portfolio_id", portfolio_id).eq("ticker", ticker.toUpperCase())
        .maybeSingle();

      const currentQty = Number(holding?.quantity ?? 0);
      if (Number(quantity) > currentQty) {
        return NextResponse.json({
          error: `Cannot sell ${quantity} shares — only ${currentQty} held`,
        }, { status: 400 });
      }
    }

    // Insert transaction
    const { data: transaction, error: insertErr } = await supabase
      .from("transactions")
      .insert({
        portfolio_id,
        ticker:       ticker ? ticker.toUpperCase() : null,
        type,
        quantity:     quantity != null ? Number(quantity) : null,
        price:        price    != null ? Number(price)    : null,
        total_amount: Number(amount),
        fees:         Number(fees),
        executed_at:  executed_at ?? new Date().toISOString(),
        notes:        notes ?? null,
      })
      .select()
      .single();

    if (insertErr) throw insertErr;

    // Recalculate position for buy/sell/split
    if (ticker && ["buy", "sell", "split"].includes(type)) {
      await recalculatePosition(supabase, portfolio_id, ticker.toUpperCase());
    }

    return NextResponse.json({ transaction, ok: true }, { status: 201 });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}

// ─── DELETE — remove a transaction and recalculate position ──────────────────

export async function DELETE(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const transactionId = req.nextUrl.searchParams.get("transaction_id");

    if (!transactionId) {
      return NextResponse.json({ error: "transaction_id is required" }, { status: 400 });
    }

    // Fetch transaction and verify ownership
    const { data: txn } = await supabase
      .from("transactions")
      .select("id, ticker, type, portfolio_id, portfolios!inner(user_id)")
      .eq("id", transactionId)
      .single();

    const owner = (txn?.portfolios as unknown as { user_id: string } | null)?.user_id;
    if (!txn || owner !== user.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await supabase.from("transactions").delete().eq("id", transactionId);

    // Recalculate position if a buy/sell was removed
    if (txn.ticker && ["buy", "sell", "split"].includes(txn.type)) {
      await recalculatePosition(supabase, txn.portfolio_id, txn.ticker);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}
