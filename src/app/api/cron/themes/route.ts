// app/api/cron/themes/route.ts
// Vercel Cron — runs 09:00 UTC daily  (vercel.json: "0 9 * * *")
// 1. Fetch last 48 h of high/medium-impact events
// 2. For each timeframe (1m / 3m / 6m): deactivate old theme → generate new one
// 3. Update asset signals based on themes + events
// 4. Refresh Polygon prices for stocks + ETFs
//
// Test locally:
//   curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/themes

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { generateTheme, generateAssetSignals } from "@/lib/ai";

export const runtime     = "nodejs";
export const maxDuration = 300;

const TIMEFRAMES = ["1m", "3m", "6m"] as const;
const TTL_HOURS  = { "1m": 24, "3m": 72, "6m": 168 } as const;

export async function GET(req: NextRequest) {
  const isVercelCron = req.headers.get("x-vercel-cron") === "1"
  const isManualRun = req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`

  if (!isVercelCron && !isManualRun) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db    = createServiceClient();
  const stats = { themes: 0, signals: 0, prices: 0, errors: 0 };
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  // ── 1. Fetch qualifying events ────────────────────────────────────────────
  const { data: events } = await db
    .from("events")
    .select("headline, event_type, sectors, sentiment_score, impact_level, ai_summary")
    .eq("ai_processed", true)
    .in("impact_level", ["high", "medium"])
    .gte("published_at", since)
    .order("published_at", { ascending: false })
    .limit(30);

  if (!events?.length) {
    return NextResponse.json({ ok: true, message: "No qualifying events", ...stats });
  }

  const generatedThemes: Array<{
    name: string; timeframe: string;
    candidate_tickers: string[]; conviction: number; brief: string;
  }> = [];

  // ── 2. Generate themes ────────────────────────────────────────────────────
  for (const tf of TIMEFRAMES) {
    try {
      await db.from("themes")
        .update({ is_active: false })
        .eq("timeframe", tf)
        .eq("is_active", true);

      await new Promise(r => setTimeout(r, 1500));
      const theme = await generateTheme(events, tf);

      const expires_at = new Date(
        Date.now() + TTL_HOURS[tf] * 60 * 60 * 1000
      ).toISOString();

      await db.from("themes").insert({
        name:              theme.name,
        label:             theme.label,
        timeframe:         tf,
        conviction:        theme.conviction,
        momentum:          theme.momentum,
        brief:             theme.brief,
        candidate_tickers: theme.candidate_tickers,
        is_active:         true,
        expires_at,
      });

      generatedThemes.push({ timeframe: tf, ...theme });
      stats.themes++;
    } catch { stats.errors++; }
  }

  // ── 3. Update asset signals ───────────────────────────────────────────────
  try {
    const { data: assets } = await db
      .from("assets")
      .select("ticker, name, asset_type, sector");

    if (assets?.length) {
      await new Promise(r => setTimeout(r, 1500));
      const signals = await generateAssetSignals(assets, events, generatedThemes);

      for (const s of signals) {
        await db.from("asset_signals")
          .update({ signal: s.signal, score: s.score, rationale: s.rationale, updated_at: new Date().toISOString() })
          .eq("ticker", s.ticker);
      }
      stats.signals = signals.length;
    }
  } catch { stats.errors++; }

  // ── 4. Refresh Polygon prices ─────────────────────────────────────────────
  stats.prices = await refreshPolygonPrices(db);

  console.log("[cron/themes]", stats);
  return NextResponse.json({ ok: true, ...stats });
}

async function refreshPolygonPrices(db: ReturnType<typeof createServiceClient>) {
  const key = process.env.POLYGON_API_KEY;
  if (!key) return 0;

  const { data: assets } = await db
    .from("assets")
    .select("ticker")
    .in("asset_type", ["stock", "etf"]);

  if (!assets?.length) return 0;

  try {
    const tickers = assets.map(a => a.ticker).join(",");
    const res = await fetch(
      `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${tickers}&apiKey=${key}`
    );
    if (!res.ok) return 0;
    const data = await res.json();
    let updated = 0;

    for (const item of data.tickers ?? []) {
      const close    = item.day?.c ?? item.lastTrade?.p;
      const prev     = item.prevDay?.c;
      const changePct = close && prev ? +((close - prev) / prev * 100).toFixed(3) : null;
      if (!close) continue;

      await db.from("asset_signals")
        .update({ price_usd: close, change_pct: changePct, updated_at: new Date().toISOString() })
        .eq("ticker", item.ticker);
      updated++;
    }
    return updated;
  } catch { return 0; }
}
