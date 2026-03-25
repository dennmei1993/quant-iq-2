// src/app/api/cron/themes/route.ts
import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/server"
import { generateTheme, generateAssetSignals } from "@/lib/ai"
import { computeAnchorScore, shouldReplaceTheme } from "@/lib/anchor"
import type { Database } from "@/types/supabase"

export const runtime     = "nodejs"
export const maxDuration = 300

const TIMEFRAMES = ["1m", "3m", "6m"] as const
const TTL_HOURS  = { "1m": 24, "3m": 72, "6m": 168 } as const

type ThemeSlim = {
  id: string; name: string; anchor_score: number; is_anchored: boolean
  anchored_since: string | null; conviction: number | null
  candidate_tickers: string[] | null; brief: string | null
}

export async function GET(req: NextRequest) {
  const isVercelCron = req.headers.get("x-vercel-cron") === "1"
  const isManualRun  = req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`
  if (!isVercelCron && !isManualRun) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const db    = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w     = db as any   // write client — service role bypasses RLS, cast needed for chained updates
  const stats = { themes_kept: 0, themes_replaced: 0, signals: 0, prices: 0, errors: 0 }
  const log:  string[] = []
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

  // ── 1. Fetch qualifying events ────────────────────────────────────────────
  const { data: events } = await db
    .from("events")
    .select("id, headline, event_type, sectors, sentiment_score, impact_score, ai_summary, published_at")
    .eq("ai_processed", true)
    .gte("impact_score", 1)
    .gte("published_at", since)
    .order("impact_score", { ascending: false })
    .order("published_at",  { ascending: false })
    .limit(50)

  if (!events?.length) {
    return NextResponse.json({ ok: true, message: "No qualifying events", ...stats })
  }

  log.push(`Loaded ${events.length} events for anchor scoring`)

  const { score: newScore, anchor_event, anchor_reason } = computeAnchorScore(
    events as Database["public"]["Tables"]["events"]["Row"][]
  )
  log.push(`New anchor score: ${newScore.toFixed(3)} — "${anchor_reason}"`)

  const generatedThemes: Array<{
    name: string; timeframe: string
    candidate_tickers: string[]; conviction: number; brief: string
  }> = []

  // ── 2. Evaluate each timeframe ────────────────────────────────────────────
  for (const tf of TIMEFRAMES) {
    try {
      const { data: currentData } = await db
        .from("themes")
        .select("id, name, anchor_score, is_anchored, anchored_since, conviction, candidate_tickers, brief")
        .eq("timeframe", tf)
        .eq("is_active", true)
        .limit(1)

      const current      = (currentData as ThemeSlim[] | null)?.[0] ?? null
      const currentScore = current?.anchor_score ?? 0
      const { replace, reason: replaceReason } = shouldReplaceTheme(currentScore, newScore)

      if (current && !replace) {
        log.push(`${tf}: keeping "${current.name}" (${replaceReason})`)
        await w.from("themes")
          .update({
            anchor_score: newScore,
            expires_at:   new Date(Date.now() + TTL_HOURS[tf] * 3_600_000).toISOString(),
          })
          .eq("id", current.id)

        generatedThemes.push({
          timeframe:         tf,
          name:              current.name,
          candidate_tickers: current.candidate_tickers ?? [],
          conviction:        current.conviction ?? 50,
          brief:             current.brief ?? "",
        })
        stats.themes_kept++
        continue
      }

      log.push(`${tf}: ${!current ? "generating first theme" : `replacing "${current.name}" — ${replaceReason}`}`)

      if (current) {
        await w.from("themes").update({ is_active: false }).eq("id", current.id)
      }

      await new Promise(r => setTimeout(r, 1500))
      const theme      = await generateTheme(events as any, tf)
      const now        = new Date().toISOString()
      const expires_at = new Date(Date.now() + TTL_HOURS[tf] * 3_600_000).toISOString()

      await w.from("themes").insert({
        name:              theme.name,
        label:             theme.label,
        timeframe:         tf,
        conviction:        theme.conviction,
        momentum:          theme.momentum,
        brief:             theme.brief,
        candidate_tickers: theme.candidate_tickers,
        is_active:         true,
        expires_at,
        anchor_event_id:   anchor_event?.id ?? null,
        anchor_score:      newScore,
        anchored_since:    now,
        is_anchored:       newScore > 0.15,
        anchor_reason,
      })

      generatedThemes.push({ timeframe: tf, ...theme })
      stats.themes_replaced++

      if (current) {
        await alertUsersThemeReplaced(w, tf, current.name, theme.name, anchor_reason)
      }

    } catch (err) {
      console.error(`[cron/themes] ${tf} failed:`, err)
      stats.errors++
    }
  }

  // ── 3. Update asset signals ───────────────────────────────────────────────
  try {
    const { data: assets } = await db.from("assets").select("ticker, name, asset_type, sector")

    if (assets?.length) {
      await new Promise(r => setTimeout(r, 1500))
      const signals = await generateAssetSignals(assets as any, events as any, generatedThemes)

      for (const s of signals) {
        await w.from("asset_signals")
          .update({ signal: s.signal, score: s.score, rationale: s.rationale, updated_at: new Date().toISOString() })
          .eq("ticker", s.ticker)
      }

      stats.signals = signals.length
      log.push(`Updated ${signals.length} asset signals`)
    }
  } catch (err) {
    console.error("[cron/themes] asset signals failed:", err)
    stats.errors++
  }

  // ── 4. Refresh Polygon prices ─────────────────────────────────────────────
  stats.prices = await refreshPolygonPrices(w)

  log.push(`Done — kept: ${stats.themes_kept}, replaced: ${stats.themes_replaced}`)
  console.log("[cron/themes]", { ...stats, log })
  return NextResponse.json({ ok: true, ...stats, log })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function alertUsersThemeReplaced(w: any, timeframe: string, oldName: string, newName: string, reason: string) {
  try {
    const { data: portfolios } = await w.from("portfolios").select("user_id")
    if (!portfolios?.length) return
    const tf_label: Record<string, string> = { "1m": "1-month", "3m": "3-month", "6m": "6-month" }
    for (const { user_id } of portfolios) {
      await w.from("alerts").insert({
        user_id,
        type:  "theme_update",
        title: `${tf_label[timeframe] ?? timeframe} theme updated`,
        body:  `"${oldName}" replaced by "${newName}". Trigger: ${reason}.`,
      })
    }
  } catch (err) {
    console.error("[cron/themes] alertUsersThemeReplaced failed:", err)
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function refreshPolygonPrices(w: any) {
  const key = process.env.POLYGON_API_KEY
  if (!key) return 0

  const { data: assets } = await w.from("assets").select("ticker").in("asset_type", ["stock", "etf"])
  if (!assets?.length) return 0

  try {
    const tickers = assets.map((a: any) => a.ticker).join(",")
    const res = await fetch(
      `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${tickers}&apiKey=${key}`
    )
    if (!res.ok) return 0

    const data = await res.json()
    let updated = 0
    for (const item of data.tickers ?? []) {
      const close     = item.day?.c ?? item.lastTrade?.p
      const prev      = item.prevDay?.c
      const changePct = close && prev ? +((close - prev) / prev * 100).toFixed(3) : null
      if (!close) continue
      await w.from("asset_signals")
        .update({ price_usd: close, change_pct: changePct, updated_at: new Date().toISOString() })
        .eq("ticker", item.ticker)
      updated++
    }
    return updated
  } catch { return 0 }
}