// app/api/cron/themes/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { generateTheme, generateAssetSignals, type MacroContext } from "@/lib/ai";
import { computeAnchorScore, shouldReplaceTheme } from "@/lib/anchor";
import { generateSyntheticEvents } from "@/lib/macro";
import { syncThemeTickers, recalculateThemeWeights } from "@/lib/theme-tickers";
import { cronLog } from '@/lib/cron-logger'

export const runtime     = "nodejs";
export const maxDuration = 300;
export const dynamic     = 'force-dynamic'

const TIMEFRAMES = ["1m", "3m", "6m"] as const;
const TTL_HOURS  = { "1m": 24, "3m": 72, "6m": 168 } as const;

// ─── Types ────────────────────────────────────────────────────────────────────

type EventRow = {
  id:              string
  headline:        string
  event_type:      string | null
  sectors:         string[] | null
  sentiment_score: number | null
  impact_score:    number | null
  ai_summary:      string | null
  published_at:    string
}

type ThemeRow = {
  id:                string
  name:              string
  anchor_score:      number
  is_anchored:       boolean
  anchored_since:    string | null
  conviction:        number
  candidate_tickers: string[] | null
  brief:             string | null
}

type AssetRow = {
  ticker:     string
  name:       string
  asset_type: string
  sector:     string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function query<T>(q: any): Promise<T | null> {
  const result = await q
  return (result as any).data as T | null
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {

  const isVercelCron = req.headers.get("x-vercel-cron") === "1"
  const isManualRun  = req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`

  if (!isVercelCron && !isManualRun) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // ── Start log entry ───────────────────────────────────────────────────────
  const cronHandle = await cronLog.start('themes', 'analysis', req as unknown as Request)

  const db    = createServiceClient()
  const stats = { themes_kept: 0, themes_replaced: 0, signals: 0, prices: 0, errors: 0 }
  const log:  string[] = []
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

  try {

    // ── 1. Fetch events ─────────────────────────────────────────────────────
    let events = await query<EventRow[]>(
      db.from("events")
        .select("id, headline, event_type, sectors, sentiment_score, impact_score, ai_summary, published_at")
        .eq("ai_processed", true)
        .gte("impact_score", 1)
        .gte("published_at", since)
        .order("impact_score", { ascending: false })
        .order("published_at", { ascending: false })
        .limit(50)
    )

    if (!events?.length) {
      await cronHandle.skip('No qualifying events in last 48h')
      return NextResponse.json({ ok: true, message: "No qualifying events", ...stats })
    }

    events = [...events]
    log.push(`Loaded ${events.length} events for anchor scoring`)

    const { score: newScore, anchor_event, anchor_reason } = computeAnchorScore(events)
    log.push(`New anchor score: ${newScore.toFixed(3)} — "${anchor_reason}"`)

    // ── 2. Load macro context ───────────────────────────────────────────────
    let macroContext: MacroContext | undefined

    try {
      const macroRows = await query<{ aspect: string; score: number }[]>(
        db.from("macro_scores").select("aspect, score")
      )

      if (macroRows?.length) {
        const aspects: Record<string, number> = {}
        let total = 0

        for (const row of macroRows) {
          aspects[row.aspect] = row.score
          total += row.score
        }

        const overall = parseFloat((total / macroRows.length).toFixed(2))
        const regime  = overall >= 4  ? "Risk-on — broad bullish momentum"
                      : overall >= 1  ? "Mildly bullish — selective opportunities"
                      : overall >= -1 ? "Neutral — mixed signals"
                      : overall >= -4 ? "Risk-off — caution warranted"
                      : "Strongly risk-off — defensive positioning"

        macroContext = { overall, aspects, regime, commentary: regime }
        log.push(`Macro context: ${overall >= 0 ? "+" : ""}${overall}/10 — ${regime}`)

        const syntheticEvents = generateSyntheticEvents(macroRows, 0.8)
        if (syntheticEvents.length > 0) {
          const syntheticAsRows = syntheticEvents.map((e, i) => ({
            id:              `synthetic-${i}`,
            headline:        e.headline ?? '',
            event_type:      e.event_type ?? null,
            sectors:         e.sectors ?? null,
            sentiment_score: e.sentiment_score ?? null,
            impact_score:    e.impact_score ?? null,
            ai_summary:      e.ai_summary ?? null,
            published_at:    e.published_at,
          }))
          events.push(...syntheticAsRows)
          log.push(`Injected ${syntheticEvents.length} synthetic macro events into theme pool`)
        }
      }
    } catch {
      log.push("Macro scores not available — generating themes without macro context")
    }

    // ── 3. Evaluate each timeframe ──────────────────────────────────────────
    const generatedThemes: Array<{
      name: string; timeframe: string
      candidate_tickers: string[]; conviction: number; brief: string
    }> = []

    for (const tf of TIMEFRAMES) {
      try {
        const currentThemes = await query<ThemeRow[]>(
          db.from("themes")
            .select("id, name, anchor_score, is_anchored, anchored_since, conviction, candidate_tickers, brief")
            .eq("timeframe", tf)
            .eq("is_active", true)
            .limit(1)
        )

        const current      = currentThemes?.[0] ?? null
        const currentScore = current?.anchor_score ?? 0

        const { replace, reason: replaceReason } = shouldReplaceTheme(currentScore, newScore)

        if (current && !replace) {
          log.push(`${tf}: keeping "${current.name}" (${replaceReason})`)

          await (db.from("themes") as any)
            .update({
              anchor_score: newScore,
              expires_at:   new Date(Date.now() + TTL_HOURS[tf] * 3_600_000).toISOString(),
            })
            .eq("id", current.id)

          generatedThemes.push({
            timeframe:         tf,
            name:              current.name,
            candidate_tickers: current.candidate_tickers ?? [],
            conviction:        current.conviction,
            brief:             current.brief ?? "",
          })

          await recalculateThemeWeights(db, current.id, current.conviction)
          stats.themes_kept++
          continue
        }

        log.push(`${tf}: ${!current ? "generating first theme" : `replacing "${current.name}" — ${replaceReason}`}`)

        if (current) {
          await (db.from("themes") as any).update({ is_active: false }).eq("id", current.id)
        }

        await new Promise(r => setTimeout(r, 1500))
        const theme      = await generateTheme(events, tf, macroContext)
        const now        = new Date().toISOString()
        const expires_at = new Date(Date.now() + TTL_HOURS[tf] * 3_600_000).toISOString()

        await (db.from("themes") as any).insert({
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

        const newThemeResult = await (db
          .from("themes")
          .select("id")
          .eq("timeframe", tf)
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(1) as unknown as Promise<{ data: { id: string }[] | null }>)

        const newThemeId = newThemeResult.data?.[0]?.id
        if (newThemeId) {
          const syncResult = await syncThemeTickers(db, newThemeId, theme.conviction, theme.ticker_weights)
          log.push(`${tf}: synced ${syncResult.upserted} ticker weights (${syncResult.skipped} skipped — not in assets)`)
        }

        generatedThemes.push({ timeframe: tf, ...theme })
        stats.themes_replaced++

        if (current) {
          await alertUsersThemeReplaced(db, tf, current.name, theme.name, anchor_reason)
        }

      } catch (err) {
        console.error(`[cron/themes] ${tf} failed:`, err)
        log.push(`${tf}: ERROR — ${err instanceof Error ? err.message : String(err)}`)
        stats.errors++
      }
    }

    // ── 4. Update asset signals ─────────────────────────────────────────────
    try {
      const assets = await query<AssetRow[]>(
        db.from("assets")
          .select("ticker, name, asset_type, sector")
          .eq("is_active", true)
          .eq("bootstrap_priority", 1)
          .limit(100)
      )

      if (assets?.length) {
        await new Promise(r => setTimeout(r, 1500))
        const signals = await generateAssetSignals(assets, events, generatedThemes)

        for (const s of signals) {
          await (db.from("asset_signals") as any)
            .update({
              signal:     s.signal,
              score:      s.score,
              rationale:  s.rationale,
              updated_at: new Date().toISOString(),
            })
            .eq("ticker", s.ticker)
        }

        stats.signals = signals.length
        log.push(`Updated ${signals.length} asset signals`)
      }
    } catch (err) {
      console.error("[cron/themes] asset signals failed:", err)
      log.push(`Asset signals ERROR — ${err instanceof Error ? err.message : String(err)}`)
      stats.errors++
    }

    // ── 5. Refresh Polygon prices ───────────────────────────────────────────
    stats.prices = await refreshPolygonPrices(db)
    log.push(`Done — kept: ${stats.themes_kept}, replaced: ${stats.themes_replaced}, signals: ${stats.signals}, prices: ${stats.prices}`)

    console.log("[cron/themes]", { ...stats, log })

    // ── Finalise log ────────────────────────────────────────────────────────
    await cronHandle.success({
      records_in:  events.length,
      records_out: stats.themes_kept + stats.themes_replaced + stats.signals,
      meta: {
        themes_kept:     stats.themes_kept,
        themes_replaced: stats.themes_replaced,
        signals_updated: stats.signals,
        prices_updated:  stats.prices,
        errors:          stats.errors,
        anchor_score:    newScore,
        anchor_reason,
        log,
      },
    })

    return NextResponse.json({ ok: true, ...stats, log })

  } catch (err) {
    // Unexpected outer failure — something went wrong before or between steps
    console.error("[cron/themes] fatal:", err)
    await cronHandle.fail(err, {
      records_in:  0,
      records_out: stats.themes_kept + stats.themes_replaced + stats.signals,
      meta: {
        themes_kept:     stats.themes_kept,
        themes_replaced: stats.themes_replaced,
        signals_updated: stats.signals,
        errors:          stats.errors,
        log,
      },
    })
    return NextResponse.json({ ok: false, error: String(err), ...stats }, { status: 500 })
  }
}

// ─── Alert users on theme replacement ────────────────────────────────────────

async function alertUsersThemeReplaced(
  db:        ReturnType<typeof createServiceClient>,
  timeframe: string,
  oldName:   string,
  newName:   string,
  reason:    string
) {
  try {
    const portfolios = await query<{ user_id: string }[]>(
      db.from("portfolios").select("user_id")
    )

    if (!portfolios?.length) return

    const tfLabel: Record<string, string> = {
      "1m": "1-month", "3m": "3-month", "6m": "6-month",
    }

    for (const { user_id } of portfolios) {
      await (db.from("alerts") as any).insert({
        user_id,
        type:       "theme_update",
        title:      `${tfLabel[timeframe] ?? timeframe} theme updated`,
        body:       `"${oldName}" replaced by "${newName}". Trigger: ${reason}.`,
        is_read:    false,
        created_at: new Date().toISOString(),
      })
    }
  } catch (err) {
    console.error("[cron/themes] alert users failed:", err)
  }
}

// ─── Polygon price refresh ────────────────────────────────────────────────────

async function refreshPolygonPrices(db: ReturnType<typeof createServiceClient>) {
  const key = process.env.POLYGON_API_KEY
  if (!key) return 0

  const assets = await query<{ ticker: string }[]>(
    db.from("assets").select("ticker").in("asset_type", ["stock", "etf"])
  )

  if (!assets?.length) return 0

  try {
    const tickers = assets.map(a => a.ticker).join(",")
    const res     = await fetch(
      `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${tickers}&apiKey=${key}`
    )
    if (!res.ok) return 0

    const data    = await res.json()
    let   updated = 0

    for (const item of data.tickers ?? []) {
      const close     = item.day?.c ?? item.lastTrade?.p
      const prev      = item.prevDay?.c
      const changePct = close && prev ? +((close - prev) / prev * 100).toFixed(3) : null
      if (!close) continue

      await (db.from("asset_signals") as any)
        .update({
          price_usd:  close,
          change_pct: changePct,
          updated_at: new Date().toISOString(),
        })
        .eq("ticker", item.ticker)

      updated++
    }

    return updated
  } catch {
    return 0
  }
}
