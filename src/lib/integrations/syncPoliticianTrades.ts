// src/lib/integrations/syncPoliticianTrades.ts
// Fetches STOCK Act trade disclosures via Financial Modeling Prep (FMP) API.
// Free tier: 250 calls/day — sufficient for daily cron.
// Sign up at: https://financialmodelingprep.com — free key, instant access.
// Add to env: FMP_API_KEY=your_key
//
// Endpoints:
//   Senate: https://financialmodelingprep.com/stable/senate-trading?apikey=KEY
//   House:  https://financialmodelingprep.com/stable/house-trading?apikey=KEY

import {
  supabaseAdmin,
  upsertAsset,
  upsertUniverseTicker,
  startCronLog,
  completeCronLog,
} from '@/lib/supabase/db'
import type { Json } from '@/types/supabase'

const FMP_BASE    = 'https://financialmodelingprep.com/stable'
const FMP_API_KEY = process.env.FMP_API_KEY

const LOOKBACK_DAYS = 7
const INCLUDE_TYPES = ['purchase']

// ─────────────────────────────────────────
// FMP Senate response shape
// ─────────────────────────────────────────
interface FMPSenateTrade {
  symbol:          string
  disclosureDate:  string
  transactionDate: string
  firstName:       string
  lastName:        string
  office:          string
  district:        string   // state code e.g. 'CO'
  owner:           string
  assetDescription:string
  assetType:       string
  type:            string
  amount:          string
  comment:         string
  link:            string
}

// ─────────────────────────────────────────
// FMP House response shape
// ─────────────────────────────────────────
interface FMPHouseTrade {
  symbol:               string
  disclosureDate:       string
  transactionDate:      string
  firstName:            string
  lastName:             string
  office:               string
  district:             string   // state+district e.g. 'FL23'
  owner:                string
  assetDescription:     string
  assetType:            string
  type:                 string
  amount:               string
  capitalGainsOver200USD: string
  comment:              string
  link:                 string
}

// ─────────────────────────────────────────
// Normalised internal shape
// ─────────────────────────────────────────
interface NormalisedTrade {
  ticker:          string
  politicianName:  string
  chamber:         'House' | 'Senate'
  party:           string | null
  state:           string | null
  transactionType: string
  assetDescription:string | null
  amountRangeLow:  number | null
  amountRangeHigh: number | null
  transactionDate: string
  disclosureDate:  string
  rawPayload:      Record<string, unknown>
}

// ─────────────────────────────────────────
// Main sync — called by route handler
// ─────────────────────────────────────────
export async function syncPoliticianTrades() {
  const logId = await startCronLog({
    jobName:     'sync_politician_trades',
    jobGroup:    'intelligence',
    triggeredBy: 'schedule',
  })

  let recordsIn = 0, recordsOut = 0

  try {
    if (!FMP_API_KEY) throw new Error('FMP_API_KEY env var not set')

    // Fetch both chambers in parallel — if one fails, still process the other
    const [senateResult, houseResult] = await Promise.allSettled([
      fetchSenateTrades(),
      fetchHouseTrades(),
    ])

    const senateTrades = senateResult.status === 'fulfilled' ? senateResult.value : []
    const houseTrades  = houseResult.status  === 'fulfilled' ? houseResult.value  : []

    if (senateResult.status === 'rejected') console.warn(`[POLITICIAN] Senate fetch failed: ${senateResult.reason}`)
    if (houseResult.status  === 'rejected') console.warn(`[POLITICIAN] House fetch failed: ${houseResult.reason}`)

    const allTrades = [...senateTrades, ...houseTrades]
    recordsIn       = allTrades.length

    if (allTrades.length === 0) {
      console.warn('[POLITICIAN] Both sources returned no data')
      await completeCronLog(logId, { status: 'skipped', recordsIn: 0, recordsOut: 0 })
      return { success: false, recordsIn: 0, recordsOut: 0 }
    }

    console.log(`[POLITICIAN] Fetched ${senateTrades.length} Senate + ${houseTrades.length} House trades`)

    const filtered = filterTrades(allTrades)
    console.log(`[POLITICIAN] After filters: ${filtered.length} trades`)

    const uniqueTickers = new Set<string>()

    for (const trade of filtered) {
      const ticker = normaliseTicker(trade.ticker)
      if (!ticker) continue

      const inserted = await upsertTrade(trade, ticker)
      if (!inserted) continue

      recordsOut++

      if (!uniqueTickers.has(ticker)) {
        uniqueTickers.add(ticker)
        await upsertAsset({ ticker, name: trade.assetDescription ?? ticker, assetType: 'stock' })
        await upsertUniverseTicker({
          ticker,
          sourceKey: 'POLITICIAN',
          metadata: {
            last_politician:  trade.politicianName,
            last_transaction: trade.transactionType,
            last_trade_date:  trade.transactionDate,
            disclosure_date:  trade.disclosureDate,
            chamber:          trade.chamber,
            party:            trade.party,
          } as Json,
        })
      }
    }

    console.log(`[POLITICIAN] Done. Inserted: ${recordsOut}/${filtered.length}`)
    await completeCronLog(logId, { status: 'success', recordsIn, recordsOut })
    return { success: true, recordsIn, recordsOut }

  } catch (err) {
    const error = err as Error
    console.error('[POLITICIAN] Error:', error.message)
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

// ─────────────────────────────────────────
// Fetch Senate trades from FMP
// ─────────────────────────────────────────
async function fetchSenateTrades(): Promise<NormalisedTrade[]> {
  const res = await fetch(`${FMP_BASE}/senate-latest?page=0&limit=100&apikey=${FMP_API_KEY}`)
  if (!res.ok) throw new Error(`FMP Senate error: ${res.status} ${await res.text()}`)

  const data: FMPSenateTrade[] = await res.json()
  const cutoff = getCutoffDate()

  return (data ?? [])
    .filter(r => r.disclosureDate && new Date(r.disclosureDate) >= cutoff)
    .map(r => ({
      ticker:          r.symbol,
      politicianName:  `${r.firstName} ${r.lastName}`.trim(),
      chamber:         'Senate',
      party:           null,          // not in this endpoint
      state:           r.district || null,  // 'CO', 'NY' etc.
      transactionType: normaliseType(r.type),
      assetDescription:r.assetDescription || null,
      ...parseAmountRange(r.amount),
      transactionDate: r.transactionDate,
      disclosureDate:  r.disclosureDate,
      rawPayload:      r as unknown as Record<string, unknown>,
    }))
}

// ─────────────────────────────────────────
// Fetch House trades from FMP
// ─────────────────────────────────────────
async function fetchHouseTrades(): Promise<NormalisedTrade[]> {
  const res = await fetch(`${FMP_BASE}/house-latest?page=0&limit=100&apikey=${FMP_API_KEY}`)
  if (!res.ok) throw new Error(`FMP House error: ${res.status} ${await res.text()}`)

  const data: FMPHouseTrade[] = await res.json()
  const cutoff = getCutoffDate()

  return (data ?? [])
    .filter(r => r.disclosureDate && new Date(r.disclosureDate) >= cutoff)
    .map(r => ({
      ticker:          r.symbol,
      politicianName:  `${r.firstName} ${r.lastName}`.trim(),
      chamber:         'House',
      party:           null,           // not in this endpoint
      state:           r.district ? r.district.replace(/[0-9]/g, '') : null, // 'FL23' → 'FL'
      transactionType: normaliseType(r.type),
      assetDescription:r.assetDescription || null,
      ...parseAmountRange(r.amount),
      transactionDate: r.transactionDate,
      disclosureDate:  r.disclosureDate,
      rawPayload:      r as unknown as Record<string, unknown>,
    }))
}

// ─────────────────────────────────────────
// Filter by transaction type
// ─────────────────────────────────────────
function filterTrades(trades: NormalisedTrade[]): NormalisedTrade[] {
  return trades.filter(t => {
    if (!t.ticker || t.ticker === '--') return false
    if (INCLUDE_TYPES?.length > 0) {
      const type = t.transactionType.toLowerCase()
      if (!INCLUDE_TYPES.some(inc => type.includes(inc))) return false
    }
    return true
  })
}

// ─────────────────────────────────────────
// Upsert trade row — returns true if newly inserted
// ─────────────────────────────────────────
async function upsertTrade(trade: NormalisedTrade, ticker: string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabaseAdmin as any)
    .from('politician_trades')
    .upsert(
      {
        ticker,
        politician_name:   trade.politicianName,
        party:             trade.party,
        chamber:           trade.chamber,
        state:             trade.state,
        transaction_type:  trade.transactionType,
        asset_description: trade.assetDescription,
        amount_range_low:  trade.amountRangeLow,
        amount_range_high: trade.amountRangeHigh,
        transaction_date:  trade.transactionDate || null,
        disclosure_date:   trade.disclosureDate  || null,
        source:            'FMP',
        raw_payload:       JSON.parse(JSON.stringify(trade.rawPayload)),
      },
      {
        onConflict:       'politician_name,ticker,transaction_date,transaction_type',
        ignoreDuplicates: true,
      }
    )
    .select('id')

  if (error) throw new Error(`upsertTrade error: ${error.message}`)
  return (data?.length ?? 0) > 0
}

// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────
function getCutoffDate(): Date {
  const d = new Date()
  d.setDate(d.getDate() - LOOKBACK_DAYS)
  return d
}

function normaliseTicker(raw: string): string | null {
  if (!raw || raw === '--') return null
  const t = raw.trim().toUpperCase().replace(/[^A-Z0-9.]/g, '')
  return t.length > 0 && t.length <= 10 ? t : null
}

function normaliseType(raw: string): string {
  const t = (raw ?? '').toLowerCase().trim()
  if (t.includes('purchase') || t === 'buy') return 'Purchase'
  if (t.includes('sale') || t.includes('sell')) return 'Sale'
  if (t.includes('exchange')) return 'Exchange'
  return raw || 'Unknown'
}

function normaliseParty(raw: string): string | null {
  const p = (raw ?? '').toUpperCase()
  if (p === 'D' || p === 'DEMOCRAT')    return 'Democrat'
  if (p === 'R' || p === 'REPUBLICAN')  return 'Republican'
  if (p === 'I' || p === 'INDEPENDENT') return 'Independent'
  return raw || null
}

function parseAmountRange(str: string): { amountRangeLow: number | null; amountRangeHigh: number | null } {
  if (!str || str === '--') return { amountRangeLow: null, amountRangeHigh: null }
  const nums = str.replace(/[$,]/g, '').split('-').map(s => parseInt(s.trim(), 10))
  return {
    amountRangeLow:  isNaN(nums[0]) ? null : nums[0],
    amountRangeHigh: isNaN(nums[1]) ? null : nums[1],
  }
}
