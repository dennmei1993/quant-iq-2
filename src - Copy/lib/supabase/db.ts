// src/lib/supabase/db.ts
// DB helpers for cron route handlers.
//
// Uses createServiceClient() from your existing src/lib/supabase/server.ts —
// no new Supabase client setup needed.
//
// Import map:
//   supabaseAdmin      → the service role client instance
//   upsertAsset        → public.assets upsert
//   upsertUniverseTicker → public.universe_tickers upsert
//   getCachedTickers   → bulk CUSIP cache lookup
//   cacheCusipMappings → bulk CUSIP cache write
//   startCronLog       → insert into public.cron_logs (status: running)
//   completeCronLog    → update public.cron_logs (status: success/failed/skipped)

import { createServiceClient } from './server'
import type { Json } from '@/types/supabase'

// Convenience re-export so integrations import from one place
export const supabaseAdmin = createServiceClient()

// ─────────────────────────────────────────
// public.assets
// ─────────────────────────────────────────
export async function upsertAsset({
  ticker,
  name,
  assetType = 'stock',
  exchange,
  sector,
}: {
  ticker:     string
  name?:      string
  assetType?: string
  exchange?:  string
  sector?:    string
}) {
  // Step 1: insert if not exists (ignoreDuplicates = true means no-op on conflict)
  // This sets track_price = true only for brand new tickers.
  const { error: insertErr } = await supabaseAdmin.from('assets').upsert(
    {
      ticker,
      name:        name ?? ticker,
      asset_type:  assetType,
      exchange,
      sector,
      track_price: true,  // enable daily price download for new tickers
    },
    { onConflict: 'ticker', ignoreDuplicates: true }  // don't touch existing rows
  )
  if (insertErr) throw new Error(`upsertAsset insert error: ${insertErr.message}`)

  // Step 2: update metadata only (never overwrite track_price on existing tickers)
  const { error: updateErr } = await supabaseAdmin.from('assets')
    .update({
      name:       name ?? ticker,
      asset_type: assetType,
      ...(exchange ? { exchange } : {}),
      ...(sector   ? { sector }   : {}),
    })
    .eq('ticker', ticker)
  if (updateErr) throw new Error(`upsertAsset update error: ${updateErr.message}`)
}

// ─────────────────────────────────────────
// public.universe_tickers
// Re-activates ticker if previously deactivated
// ─────────────────────────────────────────
export async function upsertUniverseTicker({
  ticker,
  sourceKey,
  metadata = {} as Json,
}: {
  ticker:    string
  sourceKey: string
  metadata?: Json
}) {
  const { error } = await supabaseAdmin.from('universe_tickers').upsert(
    {
      ticker,
      source_key:          sourceKey,
      is_active:           true,
      last_seen_at:        new Date().toISOString(),
      deactivated_at:      null,
      deactivation_reason: null,
      metadata,
    },
    { onConflict: 'ticker,source_key', ignoreDuplicates: false }
  )
  if (error) throw new Error(`upsertUniverseTicker error: ${error.message}`)
}

// ─────────────────────────────────────────
// public.cusip_ticker_map — bulk cache check (single query, not N+1)
// ─────────────────────────────────────────
export async function getCachedTickers(
  cusips: string[]
): Promise<Record<string, string>> {
  if (cusips.length === 0) return {}

  const { data, error } = await supabaseAdmin
    .from('cusip_ticker_map')
    .select('cusip, ticker')
    .in('cusip', cusips)

  if (error) throw new Error(`getCachedTickers error: ${error.message}`)

  return Object.fromEntries(
    (data ?? [])
      .filter((r): r is typeof r & { ticker: string } => r.ticker !== null)
      .map(r => [r.cusip, r.ticker])
  )
}

export async function cacheCusipMappings(
  mappings: { cusip: string; ticker: string; companyName?: string; figi?: string }[]
) {
  if (mappings.length === 0) return

  const { error } = await supabaseAdmin.from('cusip_ticker_map').upsert(
    mappings.map(m => ({
      cusip:        m.cusip,
      ticker:       m.ticker,
      company_name: m.companyName ?? null,
      figi:         m.figi        ?? null,
      source:       'OPENFIGI',
      resolved_at:  new Date().toISOString(),
    })),
    { onConflict: 'cusip', ignoreDuplicates: false }
  )
  if (error) throw new Error(`cacheCusipMappings error: ${error.message}`)
}

// ─────────────────────────────────────────
// public.cron_logs — matches your existing table columns exactly
// ─────────────────────────────────────────
export async function startCronLog({
  jobName,
  jobGroup    = 'intelligence',
  triggeredBy = 'schedule',
  meta        = {} as Json,
}: {
  jobName:      string
  jobGroup?:    'prices' | 'intelligence' | 'analysis' | 'maintenance'
  triggeredBy?: 'schedule' | 'manual' | 'webhook'
  meta?:        Json
}): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('cron_logs')
    .insert({
      job_name:     jobName,
      job_group:    jobGroup,
      status:       'running',
      triggered_by: triggeredBy,
      meta,
    })
    .select('id')
    .single()

  if (error) throw new Error(`startCronLog error: ${error.message}`)
  return data.id
}

export async function completeCronLog(
  logId: string,
  {
    status,
    recordsIn    = 0,
    recordsOut   = 0,
    errorMessage,
    errorDetail,
    meta,
  }: {
    status:        'success' | 'failed' | 'skipped'
    recordsIn?:    number
    recordsOut?:   number
    errorMessage?: string
    errorDetail?:  string
    meta?:         Json
  }
) {
  const { error } = await supabaseAdmin
    .from('cron_logs')
    .update({
      status,
      finished_at:   new Date().toISOString(),
      records_in:    recordsIn,
      records_out:   recordsOut,
      error_message: errorMessage ?? null,
      error_detail:  errorDetail  ?? null,
      ...(meta ? { meta: meta as Json } : {}),
    })
    .eq('id', logId)

  if (error) throw new Error(`completeCronLog error: ${error.message}`)
}
