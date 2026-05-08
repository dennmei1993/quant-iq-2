// src/lib/integrations/validateUniverse.ts
// Checks every active ticker in universe_tickers for staleness.
// Called by: src/app/api/cron/validate-universe/route.ts
//
// Rules by source:
//   MAG7       → never deactivated (static)
//   13F        → retained 18 months after last seen in any filing
//   BERKSHIRE  → retained 18 months after last seen in any filing
//   POLITICIAN → retained 12 months after last trade disclosure
//
//   ALL sources — hard deactivate immediately if:
//     assets.is_active = false (delisted/merged)
//     assets.failure_count >= 5
//     no price data in 30+ days

import { supabaseAdmin, startCronLog, completeCronLog } from '@/lib/supabase/db'
import type { Json } from '@/types/supabase'
import { randomUUID } from 'crypto'

// ─────────────────────────────────────────
// Config — tune without touching logic
// ─────────────────────────────────────────
export const CONFIG = {
  maxPriceGapDays: 30,
  maxFailureCount: 5,
  retentionMonths: {
    '13F':        18,
    'BERKSHIRE':  18,
    'POLITICIAN': 12,
  } as Record<string, number>,
  retentionSources: ['13F', 'BERKSHIRE', 'POLITICIAN'],
  staticSources:    ['MAG7'],
}

interface UniverseRow {
  ticker:               string
  source_key:           string
  is_active:            boolean
  first_seen_at:        string
  last_seen_at:         string
  deactivated_at:       string | null
  failure_count:        number | null
  asset_active:         boolean
}

interface CheckResult {
  shouldDeactivate: boolean
  reason:           string | null
  lastPriceDate:    string | null
  daysSincePrice:   number
  daysSinceSource?: number
  retentionMonths?: number
  failureCount?:    number
}

// ─────────────────────────────────────────
// Main export — called by route handler
// ─────────────────────────────────────────
export async function validateUniverse() {
  const runId = randomUUID()
  const logId = await startCronLog({
    jobName:     'validate_universe',
    jobGroup:    'maintenance',
    triggeredBy: 'schedule',
    meta:        { runId } as Json,
  })

  const stats = { checked: 0, deactivated: 0, reactivated: 0, keptActive: 0, skipped: 0 }

  try {
    // Fetch all tracked ticker-source pairs (active + inactive)
    const { data: rows, error } = await supabaseAdmin
      .from('universe_tickers')
      .select(`
        ticker,
        source_key,
        is_active,
        first_seen_at,
        last_seen_at,
        deactivated_at,
        assets ( failure_count, is_active )
      `)
    if (error) throw new Error(`Fetch universe error: ${error.message}`)

    const tickers = (rows ?? []).map(r => ({
      ticker:         r.ticker,
      source_key:     r.source_key,
      is_active:      r.is_active,
      first_seen_at:  r.first_seen_at,
      last_seen_at:   r.last_seen_at,
      deactivated_at: r.deactivated_at,
      failure_count:  (r.assets as { failure_count: number | null })?.failure_count ?? null,
      asset_active:   (r.assets as { is_active: boolean })?.is_active ?? true,
    })) as UniverseRow[]

    console.log(`[VALIDATE] Checking ${tickers.length} ticker-source pairs`)

    // Bulk fetch latest price date per ticker (single query)
    const uniqueTickers = [...new Set(tickers.map(t => t.ticker))]
    const priceMap      = await fetchLatestPriceDates(uniqueTickers)

    // Bulk fetch last-seen-in-source dates (two queries: filings + politician)
    const lastSeenMap   = await fetchLastSeenInSourceDates(tickers)

    for (const row of tickers) {
      stats.checked++

      // Skip static sources entirely (MAG7 never deactivated)
      if (CONFIG.staticSources.includes(row.source_key)) {
        stats.skipped++
        continue
      }

      const check = evaluateTicker({ row, priceMap, lastSeenMap })

      if (check.shouldDeactivate && row.is_active) {
        await deactivateTicker(row.ticker, row.source_key, check.reason!)
        await writeValidationLog({ runId, row, action: 'deactivated', check })
        stats.deactivated++
        console.log(`[VALIDATE] ❌ ${row.ticker} (${row.source_key}): ${check.reason} — ${check.daysSinceSource ?? check.daysSincePrice}d`)

      } else if (!check.shouldDeactivate && !row.is_active) {
        await reactivateTicker(row.ticker, row.source_key)
        await writeValidationLog({ runId, row, action: 'reactivated', check })
        stats.reactivated++
        console.log(`[VALIDATE] ✅ Reactivated ${row.ticker} (${row.source_key})`)

      } else {
        await writeValidationLog({ runId, row, action: 'kept_active', check })
        stats.keptActive++
      }
    }

    console.log(`[VALIDATE] Done. ${JSON.stringify(stats)}`)
    await completeCronLog(logId, {
      status:     'success',
      recordsIn:  stats.checked,
      recordsOut: stats.deactivated + stats.reactivated,
      meta:       stats as Json,
    })

    return { success: true, ...stats }

  } catch (err) {
    const error = err as Error
    await completeCronLog(logId, {
      status:       'failed',
      recordsIn:    stats.checked,
      recordsOut:   0,
      errorMessage: error.message,
      errorDetail:  error.stack,
    })
    throw err
  }
}

// ─────────────────────────────────────────
// Pure evaluation — no DB calls
// ─────────────────────────────────────────
function evaluateTicker({
  row,
  priceMap,
  lastSeenMap,
}: {
  row:          UniverseRow
  priceMap:     Record<string, string>
  lastSeenMap:  Record<string, string>
}): CheckResult {
  const today          = new Date()
  const lastPriceDate  = priceMap[row.ticker] ?? null
  const daysSincePrice = lastPriceDate
    ? Math.floor((today.getTime() - new Date(lastPriceDate).getTime()) / 864e5)
    : 9999

  // Hard deactivations — apply to all retention sources
  if (!row.asset_active) {
    return { shouldDeactivate: true, reason: 'delisted', lastPriceDate, daysSincePrice }
  }
  if ((row.failure_count ?? 0) >= CONFIG.maxFailureCount) {
    return { shouldDeactivate: true, reason: 'high_failure_count', lastPriceDate, daysSincePrice, failureCount: row.failure_count ?? 0 }
  }
  if (daysSincePrice > CONFIG.maxPriceGapDays) {
    return { shouldDeactivate: true, reason: 'no_price_data', lastPriceDate, daysSincePrice }
  }

  // Retention window — 13F, BERKSHIRE, POLITICIAN
  if (CONFIG.retentionSources.includes(row.source_key)) {
    const retentionMonths  = CONFIG.retentionMonths[row.source_key]
    const retentionDays    = retentionMonths * 30
    const mapKey           = `${row.ticker}::${row.source_key}`
    const lastSeenInSource = lastSeenMap[mapKey] ?? row.first_seen_at
    const daysSinceSource  = Math.floor(
      (today.getTime() - new Date(lastSeenInSource).getTime()) / 864e5
    )

    if (daysSinceSource > retentionDays) {
      const reason = row.source_key === 'POLITICIAN' ? 'no_recent_trades' : 'not_in_latest_filing'
      return { shouldDeactivate: true, reason, lastPriceDate, daysSincePrice, daysSinceSource, retentionMonths }
    }

    return { shouldDeactivate: false, reason: null, lastPriceDate, daysSincePrice, daysSinceSource, retentionMonths }
  }

  return { shouldDeactivate: false, reason: null, lastPriceDate, daysSincePrice }
}

// ─────────────────────────────────────────
// Bulk data fetchers
// ─────────────────────────────────────────
async function fetchLatestPriceDates(tickers: string[]): Promise<Record<string, string>> {
  if (tickers.length === 0) return {}

  // Use a DB-side aggregate via RPC to avoid fetching all rows.
  // Falls back to a per-ticker query if the RPC doesn't exist yet.
  const { data, error } = await supabaseAdmin.rpc(
    'get_latest_price_dates',
    { ticker_list: tickers }
  )

  if (error) {
    console.warn(`[VALIDATE] RPC error (${error.code}: ${error.message}) — using fallback`)
    return fetchLatestPriceDatesFallback(tickers)
  }

  const rows = data as { ticker: string; last_date: string }[] ?? []
  console.log(`[VALIDATE] RPC returned ${rows.length} price dates`)
  return Object.fromEntries(rows.map(r => [r.ticker, r.last_date]))
}

// Fallback: query max date per ticker in small parallel batches
async function fetchLatestPriceDatesFallback(tickers: string[]): Promise<Record<string, string>> {
  const map: Record<string, string> = {}
  const CHUNK = 20 // query 20 tickers at a time

  for (let i = 0; i < tickers.length; i += CHUNK) {
    const chunk = tickers.slice(i, i + CHUNK)
    // Fetch only the most recent row per ticker using limit + order
    await Promise.all(chunk.map(async ticker => {
      const { data } = await supabaseAdmin
        .from('daily_prices')
        .select('date')
        .eq('ticker', ticker)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (data?.date) map[ticker] = data.date
    }))
  }

  return map
}

async function fetchLastSeenInSourceDates(
  rows: UniverseRow[]
): Promise<Record<string, string>> {
  const result: Record<string, string> = {}

  // ── 13F + BERKSHIRE: last period_of_report in holdings_13f ──
  const filingTickers = rows
    .filter(r => ['13F', 'BERKSHIRE'].includes(r.source_key))
    .map(r => r.ticker)

  if (filingTickers.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('holdings_13f')
      .select('ticker, filings_13f!inner(source_key, period_of_report)')
      .in('ticker', filingTickers)
      .in('filings_13f.source_key', ['13F', 'BERKSHIRE'])
      .not('ticker', 'is', null)

    if (error) throw new Error(`fetchLastSeen 13F error: ${error.message}`)

    for (const row of data ?? []) {
      const filing    = row.filings_13f as { source_key: string; period_of_report: string }
      const key       = `${row.ticker}::${filing.source_key}`
      const existing  = result[key]
      if (!existing || filing.period_of_report > existing) {
        result[key] = filing.period_of_report
      }
    }
  }

  // ── POLITICIAN: last transaction_date ──
  const polTickers = rows
    .filter(r => r.source_key === 'POLITICIAN')
    .map(r => r.ticker)

  if (polTickers.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('politician_trades')
      .select('ticker, transaction_date')
      .in('ticker', polTickers)
      .order('transaction_date', { ascending: false })

    if (error) throw new Error(`fetchLastSeen politician error: ${error.message}`)

    for (const row of data ?? []) {
      const key = `${row.ticker}::POLITICIAN`
      if (!result[key]) result[key] = row.transaction_date
    }
  }

  return result
}

// ─────────────────────────────────────────
// DB mutations
// ─────────────────────────────────────────
async function deactivateTicker(ticker: string, sourceKey: string, reason: string) {
  const { error } = await supabaseAdmin
    .from('universe_tickers')
    .update({ is_active: false, deactivated_at: new Date().toISOString(), deactivation_reason: reason })
    .eq('ticker', ticker)
    .eq('source_key', sourceKey)
  if (error) throw new Error(`deactivateTicker error: ${error.message}`)
}

async function reactivateTicker(ticker: string, sourceKey: string) {
  const { error } = await supabaseAdmin
    .from('universe_tickers')
    .update({ is_active: true, deactivated_at: null, deactivation_reason: null, last_seen_at: new Date().toISOString() })
    .eq('ticker', ticker)
    .eq('source_key', sourceKey)
  if (error) throw new Error(`reactivateTicker error: ${error.message}`)
}

async function writeValidationLog({
  runId, row, action, check,
}: {
  runId:  string
  row:    UniverseRow
  action: 'kept_active' | 'deactivated' | 'reactivated'
  check:  CheckResult
}) {
  const { error } = await supabaseAdmin.from('universe_validation_log').insert({
    run_id:           runId,
    ticker:           row.ticker,
    source_key:       row.source_key,
    action,
    reason:           check.reason,
    last_price_date:  check.lastPriceDate,
    days_since_price: check.daysSincePrice,
    failure_count:    check.failureCount ?? null,
    in_latest_filing: check.daysSinceSource != null
      ? check.daysSinceSource <= (check.retentionMonths ?? 0) * 30
      : null,
  })
  if (error) console.error(`writeValidationLog error: ${error.message}`)
}
