// src/app/api/portfolio/performance/route.ts
//
// GET /api/portfolio/performance?portfolio_id=&period=1m|3m|6m|1y|all
//
// Returns:
//   series:    [{ date, value, invested, return_pct }]   — portfolio daily value
//   benchmark: [{ date, value, return_pct }]             — SPY normalised to same start
//   summary:   { total_return_pct, vs_benchmark_pct, realised_gain, unrealised_gain, start_date }

import { NextRequest, NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/supabase";

const PERIOD_DAYS: Record<string, number> = {
  "1m":  30,
  "3m":  90,
  "6m":  180,
  "1y":  365,
  "all": 99999,
};

export async function GET(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const portfolioId = req.nextUrl.searchParams.get("portfolio_id");
    const period      = req.nextUrl.searchParams.get("period") ?? "3m";

    if (!portfolioId) {
      return NextResponse.json({ error: "portfolio_id is required" }, { status: 400 });
    }

    // Verify ownership
    const { data: portfolio } = await supabase
      .from("portfolios").select("id, total_capital, benchmark")
      .eq("id", portfolioId).eq("user_id", user.id).single();
    if (!portfolio) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });

    const benchmarkTicker = portfolio.benchmark ?? "SPY";

    // ── Fetch all transactions ──────────────────────────────────────────────
    const { data: transactions } = await supabase
      .from("transactions")
      .select("ticker, type, quantity, price, total_amount, executed_at")
      .eq("portfolio_id", portfolioId)
      .order("executed_at", { ascending: true });

    const txns = transactions ?? [];

    // Earliest transaction date — start of history
    const startDate = txns.length > 0
      ? new Date(txns[0].executed_at).toISOString().split("T")[0]
      : null;

    // If no transactions, fall back to current holdings as of today
    const { data: currentHoldings } = await supabase
      .from("holdings")
      .select("ticker, quantity, avg_cost")
      .eq("portfolio_id", portfolioId);

    const holdings = currentHoldings ?? [];

    if (!startDate && holdings.length === 0) {
      return NextResponse.json({ series: [], benchmark: [], summary: null });
    }

    // ── Date range ─────────────────────────────────────────────────────────
    const periodDays = PERIOD_DAYS[period] ?? 90;
    const today      = new Date();
    const cutoff     = new Date(today);
    cutoff.setDate(cutoff.getDate() - periodDays);

    const effectiveStart = startDate
      ? new Date(Math.max(new Date(startDate).getTime(), cutoff.getTime()))
      : cutoff;

    const startStr = effectiveStart.toISOString().split("T")[0];
    const endStr   = today.toISOString().split("T")[0];

    // ── Fetch all relevant tickers' daily prices ───────────────────────────
    const tickers = [...new Set([
      ...txns.map(t => t.ticker).filter(Boolean),
      ...holdings.map(h => h.ticker),
      benchmarkTicker,
    ])] as string[];

    const { data: prices } = await supabase
      .from("daily_prices")
      .select("ticker, date, close")
      .in("ticker", tickers)
      .gte("date", startStr)
      .lte("date", endStr)
      .order("date", { ascending: true });

    // Build price lookup: { ticker: { date: close } }
    const priceMap: Record<string, Record<string, number>> = {};
    for (const row of prices ?? []) {
      if (!priceMap[row.ticker]) priceMap[row.ticker] = {};
      priceMap[row.ticker][row.date] = Number(row.close);
    }

    // ── Get all trading dates from SPY prices ─────────────────────────────
    const tradingDates = Object.keys(priceMap[benchmarkTicker] ?? {}).sort();
    if (tradingDates.length === 0) {
      return NextResponse.json({ series: [], benchmark: [], summary: null });
    }

    // ── Reconstruct portfolio value for each date ─────────────────────────
    // If we have transactions, reconstruct from them
    // Otherwise use current holdings backfilled with prices
    const series: { date: string; value: number; invested: number; return_pct: number }[] = [];

    if (txns.length > 0) {
      // Transaction-based reconstruction
      for (const date of tradingDates) {
        const dateTs = new Date(date + "T23:59:59Z").getTime();

        // Compute positions as of this date using average cost method
        const positions: Record<string, { qty: number; totalCost: number }> = {};
        let realisedGain = 0;

        for (const txn of txns) {
          if (new Date(txn.executed_at).getTime() > dateTs) break;
          const ticker = txn.ticker;
          if (!ticker || !["buy", "sell"].includes(txn.type)) continue;

          if (!positions[ticker]) positions[ticker] = { qty: 0, totalCost: 0 };
          const pos = positions[ticker];
          const qty   = Number(txn.quantity ?? 0);
          const price = Number(txn.price    ?? 0);

          if (txn.type === "buy") {
            pos.totalCost += qty * price;
            pos.qty       += qty;
          } else if (txn.type === "sell") {
            const avgCost = pos.qty > 0 ? pos.totalCost / pos.qty : 0;
            realisedGain += (price - avgCost) * qty;
            pos.qty       -= qty;
            pos.totalCost -= avgCost * qty;
            if (pos.qty < 0)       pos.qty = 0;
            if (pos.totalCost < 0) pos.totalCost = 0;
          }
        }

        // Calculate market value for this date
        let marketValue = 0;
        let invested    = 0;
        for (const [ticker, pos] of Object.entries(positions)) {
          if (pos.qty <= 0) continue;
          const closePrice = priceMap[ticker]?.[date];
          if (closePrice != null) {
            marketValue += pos.qty * closePrice;
            invested    += pos.totalCost;
          } else {
            // Use last known price if today's not available
            const knownDates = Object.keys(priceMap[ticker] ?? {}).filter(d => d <= date).sort();
            const lastDate   = knownDates[knownDates.length - 1];
            if (lastDate) {
              marketValue += pos.qty * priceMap[ticker][lastDate];
              invested    += pos.totalCost;
            }
          }
        }

        const totalValue  = marketValue + realisedGain;
        const returnPct   = invested > 0 ? ((marketValue - invested) / invested) * 100 : 0;

        series.push({ date, value: Math.round(totalValue * 100) / 100, invested: Math.round(invested * 100) / 100, return_pct: Math.round(returnPct * 100) / 100 });
      }
    } else {
      // Fallback: backfill current holdings with historical prices
      for (const date of tradingDates) {
        let marketValue = 0;
        let invested    = 0;
        for (const h of holdings) {
          const qty   = Number(h.quantity ?? 0);
          const cost  = Number(h.avg_cost ?? 0);
          const close = priceMap[h.ticker]?.[date];
          if (close != null && qty > 0) {
            marketValue += qty * close;
            invested    += qty * cost;
          }
        }
        const returnPct = invested > 0 ? ((marketValue - invested) / invested) * 100 : 0;
        series.push({ date, value: Math.round(marketValue * 100) / 100, invested: Math.round(invested * 100) / 100, return_pct: Math.round(returnPct * 100) / 100 });
      }
    }

    // ── Benchmark series — SPY normalised to portfolio start capital ───────
    const benchmarkPrices  = priceMap[benchmarkTicker] ?? {};
    const firstDate        = tradingDates[0];
    const firstBenchPrice  = benchmarkPrices[firstDate];
    const startCapital     = series[0]?.value ?? Number(portfolio.total_capital) ?? 10000;

    const benchmark = tradingDates.map(date => {
      const close = benchmarkPrices[date];
      if (close == null || firstBenchPrice == null) return null;
      const normValue  = (close / firstBenchPrice) * startCapital;
      const returnPct  = ((close - firstBenchPrice) / firstBenchPrice) * 100;
      return { date, value: Math.round(normValue * 100) / 100, return_pct: Math.round(returnPct * 100) / 100 };
    }).filter(Boolean);

    // ── Summary ────────────────────────────────────────────────────────────
    const firstPoint = series[0];
    const lastPoint  = series[series.length - 1];
    const firstBench = benchmark[0];
    const lastBench  = benchmark[benchmark.length - 1];

    // Realised gain from transactions
    let realisedGainTotal = 0;
    const closedTxns = txns.filter(t => t.type === "sell");
    // Sum realised gains from holdings
    const { data: holdingRows } = await supabase
      .from("holdings").select("realised_gain").eq("portfolio_id", portfolioId);
    for (const h of holdingRows ?? []) realisedGainTotal += Number(h.realised_gain ?? 0);

    const totalReturnPct  = firstPoint && lastPoint && firstPoint.value > 0
      ? ((lastPoint.value - firstPoint.value) / firstPoint.value) * 100 : 0;
    const benchReturnPct  = firstBench && lastBench ? (lastBench as any).return_pct : 0;
    const vsBenchmarkPct  = totalReturnPct - benchReturnPct;
    const unrealisedGain  = lastPoint ? lastPoint.value - lastPoint.invested : 0;

    return NextResponse.json({
      series,
      benchmark,
      summary: {
        start_date:        firstDate,
        total_return_pct:  Math.round(totalReturnPct  * 100) / 100,
        vs_benchmark_pct:  Math.round(vsBenchmarkPct  * 100) / 100,
        benchmark_ticker:  benchmarkTicker,
        unrealised_gain:   Math.round(unrealisedGain   * 100) / 100,
        realised_gain:     Math.round(realisedGainTotal * 100) / 100,
        data_points:       series.length,
      },
    });
  } catch (e) {
    const { body, status } = errorResponse(e);
    return NextResponse.json(body, { status });
  }
}
