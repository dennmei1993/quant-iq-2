/**
 * lib/theme-tickers.ts
 *
 * Synchronises theme_tickers rows after a theme is generated or kept.
 *
 * Called from the themes cron after each theme insert/update.
 *
 * Flow:
 *  1. Receive themeId + ticker_weights (from Claude's ThemeOutput)
 *  2. Resolve which tickers exist in the assets table (FK constraint)
 *  3. Upsert one row per valid ticker into theme_tickers
 *     - relevance  = Claude's weight (0–1)
 *     - conviction_pct = theme.conviction / 100
 *     - weight     = relevance × conviction_pct
 *  4. Delete rows for tickers no longer in the theme
 *
 * Weight precedence (enforced in DB):
 *   manual_weight IS NOT NULL → final_weight = manual_weight (human wins)
 *   manual_weight IS NULL     → final_weight = relevance × conviction_pct
 */

import type { TickerWeight } from '@/lib/ai'

type AnySupabaseClient = any

export interface SyncResult {
  upserted: number
  deleted:  number
  skipped:  number   // tickers not in assets table
}

/**
 * Sync theme_tickers for a single theme after generation.
 *
 * @param db          Service-role Supabase client
 * @param themeId     UUID of the theme row
 * @param conviction  Theme conviction score (0–100)
 * @param weights     Claude's ticker_weights output
 */
export async function syncThemeTickers(
  db:         AnySupabaseClient,
  themeId:    string,
  conviction: number,
  weights:    TickerWeight[]
): Promise<SyncResult> {
  if (!weights?.length) return { upserted: 0, deleted: 0, skipped: 0 }

  const convictionPct = Math.max(0, Math.min(1, conviction / 100))
  const now           = new Date().toISOString()

  // ── 1. Resolve which tickers exist in assets ──────────────────────────────
  const allTickers    = weights.map(w => w.ticker.toUpperCase().trim())
  const assetsResult  = await (db
    .from('assets')
    .select('ticker')
    .in('ticker', allTickers) as unknown as Promise<{ data: { ticker: string }[] | null }>)

  const validTickers  = new Set((assetsResult.data ?? []).map(a => a.ticker))
  const skipped       = allTickers.filter(t => !validTickers.has(t)).length

  const validWeights  = weights.filter(w => validTickers.has(w.ticker.toUpperCase().trim()))

  // ── 2. Upsert valid tickers ───────────────────────────────────────────────
  if (validWeights.length > 0) {
    const rows = validWeights.map(w => {
      const relevance = Math.max(0, Math.min(1, Number(w.weight) || 0))
      const weight    = parseFloat((relevance * convictionPct).toFixed(4))
      return {
        theme_id:              themeId,
        ticker:                w.ticker.toUpperCase().trim(),
        relevance,
        conviction_pct:        convictionPct,
        weight,
        added_by:              'ai',
        rationale:             w.rationale ?? null,
        last_recalculated_at:  now,
        updated_at:            now,
      }
    })

    await (db
      .from('theme_tickers') as any)
      .upsert(rows, {
        onConflict:     'theme_id,ticker',
        ignoreDuplicates: false,
      })
  }

  // ── 3. Remove tickers no longer in the theme ──────────────────────────────
  // (keeps manual rows if ticker was manually added — those won't be in validWeights)
  const deleteResult = await (db
    .from('theme_tickers') as any)
    .delete()
    .eq('theme_id', themeId)
    .eq('added_by', 'ai')                     // only remove AI-added rows
    .not('ticker', 'in', `(${allTickers.map(t => `"${t}"`).join(',')})`)

  const deleted = (deleteResult as any).count ?? 0

  return { upserted: validWeights.length, deleted, skipped }
}

/**
 * Recalculate weights for an existing theme when conviction changes.
 * Called when a theme is kept (anchor persistence) and conviction_pct drifts.
 */
export async function recalculateThemeWeights(
  db:         AnySupabaseClient,
  themeId:    string,
  conviction: number
): Promise<void> {
  const convictionPct = Math.max(0, Math.min(1, conviction / 100))
  const now           = new Date().toISOString()

  // Fetch current rows
  const result = await (db
    .from('theme_tickers')
    .select('id, relevance')
    .eq('theme_id', themeId) as unknown as Promise<{ data: { id: string; relevance: number }[] | null }>)

  const rows = result.data ?? []
  if (!rows.length) return

  // Batch update conviction_pct + recomputed weight
  for (const row of rows) {
    const weight = parseFloat((row.relevance * convictionPct).toFixed(4))
    await (db.from('theme_tickers') as any)
      .update({
        conviction_pct:       convictionPct,
        weight,
        last_recalculated_at: now,
        updated_at:           now,
      })
      .eq('id', row.id)
  }
}
