// src/app/api/cron/economic-data/route.ts
//
// Fetches authoritative economic indicators from:
//   FRED  — GDP, PCE, Fed funds rate, Treasury yields, consumer sentiment
//   BLS   — CPI, core CPI, unemployment rate, nonfarm payrolls
//   Finnhub — real-time fed funds rate, market rates
//
// Writes to economic_indicators table (one row per indicator, upserted).
// Runs at 0 6 * * * — before macro cron (0 9) so macro scores can read real data.
//
// Required env vars:
//   FRED_API_KEY         — from fred.stlouisfed.org/docs/api/
//   BLS_API_KEY          — from www.bls.gov/developers/
//   FINNHUB_API_KEY      — from finnhub.io
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface IndicatorRow {
  indicator:  string;
  value:      number | null;
  previous:   number | null;
  change:     number | null;
  period:     string | null;
  unit:       string;
  source:     string;
  series_id:  string;
  direction:  "rising" | "falling" | "stable";
  commentary: string;
}

// ─── FRED fetcher ─────────────────────────────────────────────────────────────

async function fetchFred(seriesId: string, limit = 2): Promise<{ value: number; date: string }[]> {
  const url = new URL("https://api.stlouisfed.org/fred/series/observations");
  url.searchParams.set("series_id",  seriesId);
  url.searchParams.set("api_key",    process.env.FRED_API_KEY!);
  url.searchParams.set("file_type",  "json");
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit",      String(limit));

  const res  = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
  const text = await res.text();
  let data: any = {};
  try { data = JSON.parse(text); } catch {
    console.error("FRED JSON parse failed:", text.slice(0, 200));
    return [];
  }
  const obs = data.observations;
  if (!Array.isArray(obs)) {
    console.error("FRED unexpected response:", JSON.stringify(data).slice(0, 300));
    return [];
  }
  console.log("[economic-data] FRED", seriesId, "raw obs:", JSON.stringify(obs.slice(0, 2)));
  const filtered = obs
    .filter((o: any) => o.value !== "." && o.value != null)
    .map((o: any) => ({ value: parseFloat(o.value), date: o.date }))
    .filter((o: any) => !isNaN(o.value));
  console.log("[economic-data] FRED", seriesId, "filtered count:", filtered.length);
  return filtered;
}

// ─── BLS fetcher ──────────────────────────────────────────────────────────────

async function fetchBls(seriesIds: string[], startYear: number, endYear: number): Promise<Record<string, { value: number; period: string }[]>> {
  const res = await fetch("https://api.bls.gov/publicAPI/v2/timeseries/data/", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      seriesid:       seriesIds,
      startyear:      String(startYear),
      endyear:        String(endYear),
      registrationkey: process.env.BLS_API_KEY!,
    }),
    signal: AbortSignal.timeout(15000),
  });

  const text = await res.text();
  let data: any = {};
  try { data = JSON.parse(text); } catch { 
    console.error("BLS JSON parse failed:", text.slice(0, 200));
    return {};
  }
  const result: Record<string, { value: number; period: string }[]> = {};
  const series = data.Results?.series;
  if (!Array.isArray(series)) {
    console.error("BLS unexpected response:", JSON.stringify(data).slice(0, 300));
    return {};
  }
  for (const s of series) {
    result[s.seriesID] = (Array.isArray(s.data) ? s.data : [])
      .slice(0, 14)
      .map((d: any) => ({
        value:  parseFloat(d.value),
        period: `${d.periodName} ${d.year}`,
      }))
      .filter((d: any) => !isNaN(d.value));
  }
  return result;
}

// ─── Direction helper ─────────────────────────────────────────────────────────

function direction(current: number, previous: number, threshold = 0.05): "rising" | "falling" | "stable" {
  const delta = current - previous;
  if (Math.abs(delta) < threshold) return "stable";
  return delta > 0 ? "rising" : "falling";
}

// ─── Indicator builders ───────────────────────────────────────────────────────

async function buildFredIndicators(): Promise<{ rows: IndicatorRow[]; errors: string[] }> {
  const rows:   IndicatorRow[] = [];
  const errors: string[]       = [];

  if (!process.env.FRED_API_KEY) {
    return { rows, errors: ["FRED_API_KEY not set — add to Vercel environment variables"] };
  }

  console.log("[economic-data] FRED key present, fetching FEDFUNDS");
  // Fed funds rate (monthly effective rate)
  try {
    const obs = await fetchFred("FEDFUNDS", 2);
    console.log("[economic-data] FEDFUNDS obs count:", obs.length, obs[0] ?? "empty");
    if (obs.length >= 1) {
      const cur  = obs[0];
      const prev = obs[1] ?? obs[0];
      rows.push({
        indicator:  "fed_funds_rate",
        value:      cur.value,
        previous:   prev.value,
        change:     parseFloat((cur.value - prev.value).toFixed(3)),
        period:     cur.date,
        unit:       "%",
        source:     "FRED",
        series_id:  "FEDFUNDS",
        direction:  direction(cur.value, prev.value, 0.01),
        commentary: `Fed funds rate at ${cur.value}% (${direction(cur.value, prev.value, 0.01)} from ${prev.value}%). ` +
          `${cur.value >= 5 ? "Restrictive territory — weighing on rate-sensitive sectors." : cur.value >= 4 ? "Moderately restrictive — balanced policy stance." : "Accommodative — supportive for equities."}`,
      });
    }
  } catch (e: any) { errors.push("fed_funds_rate: " + (e.message ?? String(e))); }

  // 10Y Treasury yield
  try {
    const obs = await fetchFred("DGS10", 5);
    if (obs.length >= 1) {
      const cur  = obs[0];
      const prev = obs[Math.min(4, obs.length - 1)];
      rows.push({
        indicator:  "treasury_10y",
        value:      cur.value,
        previous:   prev.value,
        change:     parseFloat((cur.value - prev.value).toFixed(3)),
        period:     cur.date,
        unit:       "%",
        source:     "FRED",
        series_id:  "DGS10",
        direction:  direction(cur.value, prev.value, 0.05),
        commentary: `10Y Treasury at ${cur.value}%. ` +
          `${cur.value > 4.5 ? "Elevated yields — headwind for growth/tech equities and REITs." : cur.value > 3.5 ? "Moderate yield environment." : "Low yields — supportive for long-duration assets."}`,
      });
    }
  } catch (e: any) { errors.push("treasury_10y: " + (e.message ?? String(e))); }

  // 2Y Treasury yield
  try {
    const obs = await fetchFred("DGS2", 5);
    if (obs.length >= 1) {
      const cur  = obs[0];
      const prev = obs[Math.min(4, obs.length - 1)];
      rows.push({
        indicator:  "treasury_2y",
        value:      cur.value,
        previous:   prev.value,
        change:     parseFloat((cur.value - prev.value).toFixed(3)),
        period:     cur.date,
        unit:       "%",
        source:     "FRED",
        series_id:  "DGS2",
        direction:  direction(cur.value, prev.value, 0.05),
        commentary: `2Y Treasury at ${cur.value}%.`,
      });
    }
  } catch (e: any) { errors.push("treasury_2y: " + (e.message ?? String(e))); }

  // Yield curve spread (10Y - 2Y)
  const t10 = rows.find(r => r.indicator === "treasury_10y");
  const t2  = rows.find(r => r.indicator === "treasury_2y");
  if (t10?.value != null && t2?.value != null) {
    const spread = parseFloat((t10.value - t2.value).toFixed(3));
    rows.push({
      indicator:  "yield_spread_10y2y",
      value:      spread,
      previous:   null,
      change:     null,
      period:     t10.period,
      unit:       "%",
      source:     "FRED",
      series_id:  "DGS10-DGS2",
      direction:  spread > 0 ? "rising" : "falling",
      commentary: spread < 0
        ? `Yield curve inverted at ${spread}% — historically a recession precursor.`
        : spread < 0.5
        ? `Yield curve flat at ${spread}% — limited term premium.`
        : `Normal yield curve at ${spread}% spread.`,
    });
  }

  // Real GDP growth (quarterly)
  try {
    const obs = await fetchFred("A191RL1Q225SBEA", 2);  // real GDP growth rate
    if (obs.length >= 1) {
      const cur  = obs[0];
      const prev = obs[1] ?? obs[0];
      rows.push({
        indicator:  "gdp_growth_real",
        value:      cur.value,
        previous:   prev.value,
        change:     parseFloat((cur.value - prev.value).toFixed(2)),
        period:     cur.date,
        unit:       "% annualised",
        source:     "FRED",
        series_id:  "A191RL1Q225SBEA",
        direction:  direction(cur.value, prev.value, 0.1),
        commentary: `Real GDP growth at ${cur.value}% annualised. ` +
          `${cur.value < 0 ? "Contraction — recessionary signal." : cur.value < 1.5 ? "Sluggish growth — late-cycle conditions." : cur.value < 3 ? "Moderate growth — mid-cycle." : "Strong growth — early-to-mid cycle."}`,
      });
    }
  } catch (e: any) { errors.push("gdp_growth_real: " + (e.message ?? String(e))); }

  // PCE inflation (Fed's preferred measure)
  try {
    const obs = await fetchFred("PCEPI", 14);  // monthly, need 12m for YoY
    if (obs.length >= 13) {
      const cur   = obs[0];
      const yr_ago = obs[12];
      const yoy   = parseFloat(((cur.value / yr_ago.value - 1) * 100).toFixed(2));
      rows.push({
        indicator:  "pce_yoy",
        value:      yoy,
        previous:   null,
        change:     null,
        period:     cur.date,
        unit:       "% YoY",
        source:     "FRED",
        series_id:  "PCEPI",
        direction:  yoy > 2.5 ? "rising" : yoy < 1.5 ? "falling" : "stable",
        commentary: `PCE inflation at ${yoy}% YoY (Fed target: 2%). ` +
          `${yoy > 3 ? "Well above target — pressure for hawkish policy." : yoy > 2 ? "Above target — Fed remains cautious." : "Near or below target — accommodative policy possible."}`,
      });
    }
  } catch (e: any) { errors.push("pce_yoy: " + (e.message ?? String(e))); }

  // University of Michigan consumer sentiment
  try {
    const obs = await fetchFred("UMCSENT", 2);
    if (obs.length >= 1) {
      const cur  = obs[0];
      const prev = obs[1] ?? obs[0];
      rows.push({
        indicator:  "consumer_sentiment",
        value:      cur.value,
        previous:   prev.value,
        change:     parseFloat((cur.value - prev.value).toFixed(1)),
        period:     cur.date,
        unit:       "index",
        source:     "FRED",
        series_id:  "UMCSENT",
        direction:  direction(cur.value, prev.value, 1),
        commentary: `Consumer sentiment at ${cur.value} (historical avg ~86). ` +
          `${cur.value < 70 ? "Very weak — consumer stress, cautious on discretionary." : cur.value < 80 ? "Below average — subdued consumer confidence." : cur.value < 90 ? "Near normal." : "Strong — positive for consumer discretionary."}`,
      });
    }
  } catch (e: any) { errors.push("consumer_sentiment: " + (e.message ?? String(e))); }

  return rows;
}

async function buildBlsIndicators(): Promise<IndicatorRow[]> {
  const rows: IndicatorRow[] = [];
  const currentYear = new Date().getFullYear();

  try {
    const bls = await fetchBls(
      [
        "CUUR0000SA0",    // CPI all items
        "CUUR0000SA0L1E", // Core CPI (ex food & energy)
        "LNS14000000",    // Unemployment rate
        "CES0000000001",  // Nonfarm payrolls (total)
      ],
      currentYear - 2,
      currentYear
    );

    // CPI YoY — (current_index / index_12_months_ago - 1) × 100
    const cpiSeries = bls["CUUR0000SA0"];
    if (cpiSeries && cpiSeries.length >= 13) {
      const cur   = cpiSeries[0];
      const yrAgo = cpiSeries[12];
      const yoy   = parseFloat(((cur.value / yrAgo.value - 1) * 100).toFixed(2));
      rows.push({
        indicator:  "cpi_yoy",
        value:      yoy,
        previous:   null,
        change:     null,
        period:     cur.period,
        unit:       "% YoY",
        source:     "BLS",
        series_id:  "CUUR0000SA0",
        direction:  yoy > 3 ? "rising" : yoy < 2 ? "falling" : "stable",
        commentary: `CPI ${yoy}% YoY in ${cur.period}. ` +
          `${yoy > 3.5 ? "Well above Fed target — persistent inflation pressure." : yoy > 2.5 ? "Above target — Fed remains cautious." : yoy > 2 ? "Near target — inflation cooling." : "At or below target."}`,
      });
    } else if (cpiSeries && cpiSeries.length >= 2) {
      const cur = cpiSeries[0];
      rows.push({
        indicator:  "cpi_yoy",
        value:      cur.value,
        previous:   null,
        change:     null,
        period:     cur.period,
        unit:       "index (1982-84=100)",
        source:     "BLS",
        series_id:  "CUUR0000SA0",
        direction:  "stable",
        commentary: `CPI index at ${cur.value} in ${cur.period}. Insufficient history for YoY %.`,
      });
    }

    // Core CPI YoY
    const coreCpi = bls["CUUR0000SA0L1E"];
    if (coreCpi && coreCpi.length >= 13) {
      const cur   = coreCpi[0];
      const yrAgo = coreCpi[12];
      const yoy   = parseFloat(((cur.value / yrAgo.value - 1) * 100).toFixed(2));
      rows.push({
        indicator:  "core_cpi_yoy",
        value:      yoy,
        previous:   null,
        change:     null,
        period:     cur.period,
        unit:       "% YoY",
        source:     "BLS",
        series_id:  "CUUR0000SA0L1E",
        direction:  yoy > 3 ? "rising" : yoy < 2 ? "falling" : "stable",
        commentary: `Core CPI (ex food & energy) ${yoy}% YoY in ${cur.period}. ` +
          `${yoy > 3.5 ? "Sticky core inflation — Fed unlikely to cut." : yoy > 2.5 ? "Above target, gradual moderation." : "Core inflation contained."}`,
      });
    } else if (coreCpi && coreCpi.length >= 2) {
      const cur = coreCpi[0];
      rows.push({
        indicator:  "core_cpi_yoy",
        value:      cur.value,
        previous:   null,
        change:     null,
        period:     cur.period,
        unit:       "index (1982-84=100)",
        source:     "BLS",
        series_id:  "CUUR0000SA0L1E",
        direction:  "stable",
        commentary: `Core CPI index at ${cur.value} in ${cur.period}.`,
      });
    }

    // Unemployment rate
    const unemp = bls["LNS14000000"];
    if (unemp?.length >= 2) {
      const cur  = unemp[0];
      const prev = unemp[1];
      rows.push({
        indicator:  "unemployment_rate",
        value:      cur.value,
        previous:   prev.value,
        change:     parseFloat((cur.value - prev.value).toFixed(1)),
        period:     cur.period,
        unit:       "%",
        source:     "BLS",
        series_id:  "LNS14000000",
        direction:  direction(cur.value, prev.value, 0.1),
        commentary: `Unemployment at ${cur.value}% (${cur.period}). ` +
          `${cur.value > 5 ? "Elevated — labour market weakening, Fed may ease." : cur.value > 4 ? "Softening — approaching neutral." : cur.value > 3 ? "Near full employment." : "Very tight labour market — wage pressure risk."}`,
      });
    }

    // Nonfarm payrolls
    const payrolls = bls["CES0000000001"];
    if (payrolls?.length >= 2) {
      const cur  = payrolls[0];
      const prev = payrolls[1];
      const momChange = parseFloat((cur.value - prev.value).toFixed(1));
      rows.push({
        indicator:  "nonfarm_payrolls",
        value:      momChange,     // MoM change in thousands
        previous:   null,
        change:     null,
        period:     cur.period,
        unit:       "thousands (MoM change)",
        source:     "BLS",
        series_id:  "CES0000000001",
        direction:  momChange > 150 ? "rising" : momChange > 50 ? "stable" : "falling",
        commentary: `Nonfarm payrolls ${momChange > 0 ? "+" : ""}${momChange}k in ${cur.period}. ` +
          `${momChange > 250 ? "Very strong — tight labour market." : momChange > 150 ? "Solid job growth." : momChange > 50 ? "Moderate growth — softening." : "Weak payrolls — labour market cooling significantly."}`,
      });
    }

  } catch (e) { console.error("BLS fetch error:", e); }

  return rows;
}

// Finnhub economic calendar is unreliable — FRED covers fed funds rate and yields.
// Keeping this stub for future use (e.g. earnings calendar, IPO calendar).
async function buildFinnhubIndicators(): Promise<IndicatorRow[]> {
  return [];
}

// ─── GET / POST handler ───────────────────────────────────────────────────────

export async function GET(req: NextRequest) { return handler(req); }
export async function POST(req: NextRequest) { return handler(req); }

async function handler(req: NextRequest) {
  try {
  console.log("[economic-data] handler started");
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";
  const validSecret  = process.env.CRON_SECRET
    ? req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`
    : false;

  if (!isVercelCron && !validSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const started  = Date.now();

  // Fetch all sources in parallel
  console.log("[economic-data] starting parallel fetch");
  const [fredRes, blsRows, finnhubRows] = await Promise.allSettled([
    buildFredIndicators(),
    buildBlsIndicators(),
    buildFinnhubIndicators(),
  ]);

  console.log("[economic-data] fetch complete, building rows");
  console.log("[economic-data] fredRes status:", fredRes.status);
  console.log("[economic-data] blsRows status:", blsRows.status);
  console.log("[economic-data] finnhubRows status:", finnhubRows.status);
  
  const fredRows   = fredRes.status === "fulfilled" ? fredRes.value.rows   : [];
  const fredErrors = fredRes.status === "fulfilled" ? fredRes.value.errors : [`FRED: ${(fredRes as any).reason?.message}`];
  console.log("[economic-data] fredRows length:", Array.isArray(fredRows) ? fredRows.length : "NOT ARRAY", typeof fredRows);
  console.log("[economic-data] fredErrors:", fredErrors);

  const blsValue = blsRows.status === "fulfilled" ? blsRows.value : [];
  console.log("[economic-data] blsValue length:", Array.isArray(blsValue) ? blsValue.length : "NOT ARRAY", typeof blsValue);

  const finnhubValue = finnhubRows.status === "fulfilled" ? finnhubRows.value : [];
  console.log("[economic-data] finnhubValue length:", Array.isArray(finnhubValue) ? finnhubValue.length : "NOT ARRAY", typeof finnhubValue);

  const allRows: IndicatorRow[] = [
    ...(Array.isArray(fredRows)     ? fredRows     : []),
    ...(Array.isArray(blsValue)     ? blsValue     : []),
    ...(Array.isArray(finnhubValue) ? finnhubValue : []),
  ];
  console.log("[economic-data] allRows length:", allRows.length);

  const errors: string[] = [
    ...(Array.isArray(fredErrors) ? fredErrors : []),
    ...(blsRows.status     === "rejected" ? [`BLS: ${blsRows.reason?.message}`]         : []),
    ...(finnhubRows.status === "rejected" ? [`Finnhub: ${finnhubRows.reason?.message}`] : []),
  ];

  // Upsert all rows
  const results: string[] = [];
  await Promise.allSettled(
    allRows.map(async row => {
      const { error } = await supabase
        .from("economic_indicators")
        .upsert(
          { ...row, refreshed_at: new Date().toISOString() },
          { onConflict: "indicator" }
        );
      if (error) errors.push(`${row.indicator}: ${error.message}`);
      else       results.push(`${row.indicator} (${row.source}): ${row.value} ${row.unit}`);
    })
  );

  const elapsed = Math.round((Date.now() - started) / 1000);
  console.log(`[economic-data] ${elapsed}s — ${results.length} indicators, ${errors.length} errors`);

  return NextResponse.json({
    ok:          errors.length === 0,
    indicators:  results,
    errors,
    elapsed_s:   elapsed,
    refreshed_at: new Date().toISOString(),
  });
  } catch (e: any) {
    console.error("[economic-data] fatal:", e);
    return NextResponse.json({ ok: false, error: e.message ?? String(e) }, { status: 500 });
  }
}
