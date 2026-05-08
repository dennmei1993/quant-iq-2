// src/app/api/portfolio/transaction/route.ts
//
// POST   /api/portfolio/transaction  — record buy/sell/dividend/deposit/withdrawal
// GET    /api/portfolio/transaction  — fetch transactions for portfolio or ticker
// DELETE /api/portfolio/transaction  — delete a transaction and recalculate
//
// Position recalculation uses FIFO (first-in first-out):
//   - Buy transactions create lots ordered by executed_at
//   - Sells consume the oldest lots first, updating qty_sold on each buy lot
//   - Holdings.quantity and avg_cost are always derived — never manually set
//   - Holdings.realised_gain accumulates locked-in P&L from all sells

import { NextRequest, NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/supabase";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TxnRow {
  id:           string;
  type:         string;
  quantity:     number | null;
  price:        number | null;
  total_amount: number;
  fees:         number;
  qty_sold:     number;
  executed_at:  string;
  created_at:   string;
}

interface Lot {
  id:           string;
  qty_original: number;
  qty_remaining: number;
  price:        number;
  feesPerShare: number;
}

// ─── FIFO position recalculation ──────────────────────────────────────────────
//
// Algorithm:
//   1. Fetch all buy/sell/split transactions for ticker, ordered oldest-first
//   2. Build buy lots — each lot tracks qty_remaining
//   3. Process each sell oldest-first, consuming buy lots FIFO
//      - For each lot consumed: realised_gain += (sell_price − lot_price) × consumed
//      - Update qty_sold on the buy transaction row
//   4. Remaining open lots → quantity and weighted avg_cost for the holding
//   5. Upsert or delete holding

async function recalculatePosition(
  supabase:    any,
  portfolioId: string,
  ticker:      string,
  livePrice?:  number | null,
) {
  const { data: rawTxns, error } = await supabase
    .from("transactions")
    .select("id, type, quantity, price, fees, qty_sold, executed_at, created_at")
    .eq("portfolio_id", portfolioId)
    .eq("ticker", ticker)
    .in("type", ["buy", "sell", "split"])
    .order("executed_at", { ascending: true })
    .order("created_at",  { ascending: true });

  if (error) throw error;

  const txns: TxnRow[] = rawTxns ?? [];

  if (!txns.length) {
    await supabase.from("holdings")
      .delete().eq("portfolio_id", portfolioId).eq("ticker", ticker);
    return;
  }

  // ── Build buy lots, applying splits as we encounter them ──────────────────
  const lots: Lot[] = [];

  for (const txn of txns) {
    if (txn.type === "split" && txn.quantity) {
      // Stock split: adjust all existing lots
      const ratio = Number(txn.quantity);
      for (const lot of lots) {
        lot.qty_original  *= ratio;
        lot.qty_remaining *= ratio;
        lot.price         /= ratio;
        lot.feesPerShare  /= ratio;
      }
    } else if (txn.type === "buy" && txn.quantity && txn.price) {
      const qty  = Number(txn.quantity);
      const fees = Number(txn.fees ?? 0);
      lots.push({
        id:            txn.id,
        qty_original:  qty,
        qty_remaining: qty,
        price:         Number(txn.price),
        feesPerShare:  qty > 0 ? fees / qty : 0,
      });
    }
  }

  // ── Process sells FIFO ────────────────────────────────────────────────────
  let realisedGain = 0;
  // Reset qty_sold for all buy lots — will recompute from scratch
  const qtySoldMap: Record<string, number> = {};
  for (const lot of lots) qtySoldMap[lot.id] = 0;

  for (const txn of txns) {
    if (txn.type !== "sell" || !txn.quantity || !txn.price) continue;

    let qtyToSell      = Number(txn.quantity);
    const sellPrice    = Number(txn.price);
    const sellFees     = Number(txn.fees ?? 0);
    const feePerShare  = qtyToSell > 0 ? sellFees / qtyToSell : 0;

    for (const lot of lots) {
      if (qtyToSell <= 0.000001) break;
      if (lot.qty_remaining <= 0.000001) continue;

      const consumed = Math.min(qtyToSell, lot.qty_remaining);

      // Realised gain for this consumption
      realisedGain      += consumed * (sellPrice - lot.price - feePerShare - lot.feesPerShare);
      lot.qty_remaining -= consumed;
      qtySoldMap[lot.id] = (qtySoldMap[lot.id] ?? 0) + consumed;
      qtyToSell         -= consumed;
    }
  }

  // ── Persist qty_sold back onto each buy transaction ───────────────────────
  await Promise.all(
    Object.entries(qtySoldMap).map(([id, qtySold]) =>
      supabase.from("transactions")
        .update({ qty_sold: Math.round(qtySold * 1e8) / 1e8 })
        .eq("id", id)
    )
  );

  // ── Compute open position ─────────────────────────────────────────────────
  const openLots  = lots.filter(l => l.qty_remaining > 0.000001);
  const totalQty  = openLots.reduce((s, l) => s + l.qty_remaining, 0);

  if (totalQty <= 0.000001) {
    // Fully closed position — remove holding
    await supabase.from("holdings")
      .delete().eq("portfolio_id", portfolioId).eq("ticker", ticker);
    return;
  }

  // Weighted average cost of remaining lots (including buy-side fees)
  const totalCost = openLots.reduce((s, l) => s + l.qty_remaining * (l.price + l.feesPerShare), 0);
  const avgCost   = totalCost / totalQty;

  // Unrealised gain vs live price
  const unrealisedGain = livePrice != null ? (livePrice - avgCost) * totalQty : null;

  // First buy date
  const firstBought = txns.find(t => t.type === "buy");

  // ── Upsert holding (read-only fields — never edited by user) ──────────────
  const { error: upsertErr } = await supabase.from("holdings").upsert({
    portfolio_id:    portfolioId,
    ticker:          ticker.toUpperCase(),
    quantity:        Math.round(totalQty    * 1e8) / 1e8,
    avg_cost:        Math.round(avgCost     * 1e6) / 1e6,
    realised_gain:   Math.round(realisedGain  * 1e4) / 1e4,
    unrealised_gain: unrealisedGain != null
      ? Math.round(unrealisedGain * 1e4) / 1e4
      : null,
    first_bought_at: firstBought?.executed_at ?? null,
  }, { onConflict: "portfolio_id,ticker", ignoreDuplicates: false });

  if (upsertErr) throw upsertErr;
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const portfolioId = req.nextUrl.searchParams.get("portfolio_id");
    const ticker      = req.nextUrl.searchParams.get("ticker");
    const limit       = parseInt(req.nextUrl.searchParams.get("limit") ?? "200");

    if (!portfolioId) return NextResponse.json({ error: "portfolio_id required" }, { status: 400 });

    const { data: portfolio } = await supabase
      .from("portfolios").select("id").eq("id", portfolioId).eq("user_id", user.id).single();
    if (!portfolio) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });

    let q = supabase
      .from("transactions")
      .select("*")
      .eq("portfolio_id", portfolioId)
      .order("executed_at", { ascending: false })
      .limit(limit);

    if (ticker) q = q.eq("ticker", ticker.toUpperCase());

    const { data: transactions, error } = await q;
    if (error) throw error;

    return NextResponse.json({ transactions: transactions ?? [] });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const body = await req.json();
    const {
      portfolio_id, type, ticker, quantity, price,
      total_amount, fees = 0, executed_at, notes,
    } = body;

    if (!portfolio_id) return NextResponse.json({ error: "portfolio_id required" }, { status: 400 });
    if (!type)         return NextResponse.json({ error: "type required"         }, { status: 400 });

    const VALID = ["buy", "sell", "dividend", "deposit", "withdrawal", "split"];
    if (!VALID.includes(type)) {
      return NextResponse.json({ error: `type must be one of: ${VALID.join(", ")}` }, { status: 400 });
    }
    if (["buy", "sell", "dividend", "split"].includes(type) && !ticker) {
      return NextResponse.json({ error: "ticker required for this transaction type" }, { status: 400 });
    }

    const { data: portfolio } = await supabase
      .from("portfolios").select("id").eq("id", portfolio_id).eq("user_id", user.id).single();
    if (!portfolio) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });

    // Compute total_amount if not provided
    let amount = total_amount;
    if (amount == null && quantity != null && price != null) {
      amount = Number(quantity) * Number(price);
    }
    if (amount == null) return NextResponse.json({ error: "total_amount required" }, { status: 400 });

    // Validate sell does not exceed holding
    if (type === "sell" && ticker) {
      const { data: holding } = await supabase
        .from("holdings").select("quantity")
        .eq("portfolio_id", portfolio_id).eq("ticker", ticker.toUpperCase()).maybeSingle();
      const currentQty = Number(holding?.quantity ?? 0);
      if (Number(quantity) > currentQty + 0.000001) {
        return NextResponse.json({
          error: `Cannot sell ${quantity} — only ${currentQty.toFixed(8).replace(/\.?0+$/, "")} held`,
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
        qty_sold:     0,
        executed_at:  executed_at ?? new Date().toISOString(),
        notes:        notes ?? null,
      })
      .select().single();

    if (insertErr) throw insertErr;

    // Recalculate position
    if (ticker && ["buy", "sell", "split"].includes(type)) {
      const { data: signal } = await supabase
        .from("asset_signals").select("price_usd")
        .eq("ticker", ticker.toUpperCase()).maybeSingle();
      await recalculatePosition(
        supabase, portfolio_id, ticker.toUpperCase(),
        signal?.price_usd ? Number(signal.price_usd) : null,
      );
    }

    // Return updated holding alongside transaction
    const { data: holding } = await supabase
      .from("holdings").select("*")
      .eq("portfolio_id", portfolio_id)
      .eq("ticker", ticker?.toUpperCase() ?? "").maybeSingle();

    return NextResponse.json({ transaction, holding, ok: true }, { status: 201 });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}

// ─── DELETE ───────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const transactionId = req.nextUrl.searchParams.get("transaction_id");

    if (!transactionId) return NextResponse.json({ error: "transaction_id required" }, { status: 400 });

    const { data: txn } = await supabase
      .from("transactions")
      .select("id, ticker, type, portfolio_id, portfolios!inner(user_id)")
      .eq("id", transactionId).single();

    const owner = (txn?.portfolios as any)?.user_id;
    if (!txn || owner !== user.id) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await supabase.from("transactions").delete().eq("id", transactionId);

    if (txn.ticker && ["buy", "sell", "split"].includes(txn.type)) {
      const { data: signal } = await supabase
        .from("asset_signals").select("price_usd").eq("ticker", txn.ticker).maybeSingle();
      await recalculatePosition(
        supabase, txn.portfolio_id, txn.ticker,
        signal?.price_usd ? Number(signal.price_usd) : null,
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}

// ─── PATCH — edit a transaction ───────────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const { transaction_id, quantity, price, fees, executed_at, notes } = await req.json();
    if (!transaction_id) return NextResponse.json({ error: "transaction_id required" }, { status: 400 });

    // Verify ownership via portfolio join
    const { data: txn } = await supabase
      .from("transactions")
      .select("id, portfolio_id, ticker, type, portfolios!inner(user_id)")
      .eq("id", transaction_id)
      .single();

    const owner = (txn?.portfolios as any)?.user_id;
    if (!txn || owner !== user.id) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Update the transaction
    const update: Record<string, any> = {};
    if (quantity    != null) update.quantity     = quantity;
    if (price       != null) update.price        = price;
    if (fees        != null) update.fees         = fees;
    if (executed_at != null) update.executed_at  = executed_at;
    if (notes       !== undefined) update.notes  = notes;
    if (quantity != null && price != null) {
      update.total_amount = quantity * price + (fees ?? 0);
    }

    await supabase.from("transactions").update(update).eq("id", transaction_id);

    // Recalculate position (holdings) after edit
    if (txn.ticker && ["buy", "sell", "split"].includes(txn.type)) {
      const { data: signal } = await supabase
        .from("asset_signals").select("price_usd").eq("ticker", txn.ticker).maybeSingle();
      await recalculatePosition(
        supabase, txn.portfolio_id, txn.ticker,
        signal?.price_usd ? Number(signal.price_usd) : null,
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}
