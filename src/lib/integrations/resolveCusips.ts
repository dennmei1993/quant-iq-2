// src/lib/integrations/resolveCusips.ts
// Resolves unresolved holdings_13f rows (ticker IS NULL) in small daily batches.
// Called by: src/app/api/cron/resolve-cusips/route.ts
//
// Why lazy resolution:
//   - Large filers (Vanguard: 17k, BlackRock: 48k CUSIPs) would exceed
//     Vercel's 300s timeout if resolved synchronously during ingest
//   - OpenFIGI free tier rate limits make bulk resolution impractical in one run
//   - Once resolved and cached, re-runs are instant (cache hit, no API call)
//
// Strategy:
//   - Each run processes BATCH_PER_RUN unresolved CUSIPs (default 100)
//   - 100 CUSIPs = 10 OpenFIGI requests × 1.5s delay = ~15s per run
//   - At 100/day, 48k BlackRock holdings resolve in ~480 days
//   - With OPENFIGI_API_KEY (free registration): increase to 500/run (25 per request)

import { supabaseAdmin, upsertAsset, upsertUniverseTicker, startCronLog, completeCronLog } from '@/lib/supabase/db'
import { resolveCusips } from '@/lib/utils/cusipResolver'
import type { Json } from '@/types/supabase'

const BATCH_PER_RUN = 100 // CUSIPs to resolve per daily run

export async function resolvePendingCusips() {
  const logId = await startCronLog({
    jobName:     'resolve_cusips',
    jobGroup:    'intelligence',
    triggeredBy: 'schedule',
  })

  let recordsIn = 0, recordsOut = 0

  try {
    // 1. Fetch unresolved holdings — distinct CUSIPs with no ticker yet
    //    Also get filing context so we can upsert universe_tickers correctly
    const { data: unresolved, error: fetchErr } = await supabaseAdmin
      .from('holdings_13f')
      .select(`
        cusip,
        company_name,
        filings_13f!inner ( source_key, manager_name, cik, period_of_report )
      `)
      .is('ticker', null)
      .not('cusip', 'is', null)
      .limit(BATCH_PER_RUN)

    if (fetchErr) throw new Error(`Fetch unresolved error: ${fetchErr.message}`)
    if (!unresolved || unresolved.length === 0) {
      console.log('[CUSIP] No unresolved holdings — all CUSIPs resolved ✓')
      await completeCronLog(logId, { status: 'skipped', recordsIn: 0, recordsOut: 0 })
      return { success: true, message: 'All CUSIPs resolved', recordsIn: 0, recordsOut: 0 }
    }

    // Deduplicate CUSIPs (same CUSIP can appear in multiple filings)
    const uniqueCusips = [...new Set(unresolved.map(r => r.cusip as string))]
    recordsIn = uniqueCusips.length
    console.log(`[CUSIP] Resolving ${recordsIn} unique CUSIPs...`)

    // 2. Resolve via OpenFIGI (checks cache first, then API in batches of 10)
    const cusipToTicker = await resolveCusips(uniqueCusips)

    // 3. For each resolved CUSIP, update all matching holdings_13f rows
    //    and upsert into universe_tickers
    for (const row of unresolved) {
      const cusip   = row.cusip as string
      const ticker  = cusipToTicker[cusip] ?? null
      if (!ticker) continue

      const filing = row.filings_13f as {
        source_key:      string
        manager_name:    string
        cik:             string
        period_of_report:string
      }

      // Update the holdings row with the resolved ticker
      const { error: updateErr } = await supabaseAdmin
        .from('holdings_13f')
        .update({ ticker })
        .is('ticker', null)
        .eq('cusip', cusip)

      if (updateErr) {
        console.error(`[CUSIP] Failed to update holding for ${cusip}: ${updateErr.message}`)
        continue
      }

      // Ensure asset exists in public.assets
      await upsertAsset({
        ticker,
        name:      row.company_name ?? undefined,
        assetType: 'stock',
      })

      // Add to universe_tickers for this source
      await upsertUniverseTicker({
        ticker,
        sourceKey: filing.source_key,
        metadata: {
          manager: filing.manager_name,
          cik:     filing.cik,
          period:  filing.period_of_report,
        } as Json,
      })

      recordsOut++
    }

    // 4. Report remaining unresolved count for monitoring
    const { count: remaining } = await supabaseAdmin
      .from('holdings_13f')
      .select('*', { count: 'exact', head: true })
      .is('ticker', null)

    console.log(`[CUSIP] Resolved ${recordsOut}/${recordsIn} this run. Remaining: ${remaining ?? '?'}`)

    await completeCronLog(logId, {
      status:     'success',
      recordsIn,
      recordsOut,
      meta:       { remaining: remaining ?? 0 } as Json,
    })

    return { success: true, recordsIn, recordsOut, remaining: remaining ?? 0 }

  } catch (err) {
    const error = err as Error
    console.error('[CUSIP] Error:', error.message)
    await completeCronLog(logId, {
      status:       'failed',
      recordsIn,
      recordsOut,
      errorMessage: error.message,
      errorDetail:  error.stack,
    })
    throw err
  }
}
