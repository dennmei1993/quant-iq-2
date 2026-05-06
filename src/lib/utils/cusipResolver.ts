// src/lib/utils/cusipResolver.ts
// Resolves CUSIPs → tickers via OpenFIGI API.
// Checks DB cache first (bulk query, not N+1).
// Docs: https://www.openfigi.com/api

import { getCachedTickers, cacheCusipMappings, upsertAsset } from '@/lib/supabase/db'

const OPENFIGI_URL   = 'https://api.openfigi.com/v3/mapping'
const OPENFIGI_KEY   = process.env.OPENFIGI_API_KEY ?? null
const BATCH_SIZE     = 10   // OpenFIGI hard limit: 10 per request without a key
const BATCH_DELAY_MS = 1500 // delay between batches — free tier allows ~1 req/3s

// ─────────────────────────────────────────
// Main export — resolves a list of CUSIPs
// Returns: { [cusip]: ticker | null }
// ─────────────────────────────────────────
export async function resolveCusips(
  cusips: string[]
): Promise<Record<string, string | null>> {
  if (cusips.length === 0) return {}

  // 1. Bulk cache check — single query for all CUSIPs
  const cached  = await getCachedTickers(cusips)
  const results : Record<string, string | null> = { ...cached }
  const toFetch = cusips.filter(c => !(c in cached))

  if (toFetch.length === 0) return results

  // 2. Batch fetch from OpenFIGI in groups of 10 with delay between each
  for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
    const batch   = toFetch.slice(i, i + BATCH_SIZE)
    const fetched = await fetchFromOpenFIGI(batch)
    Object.assign(results, fetched)
    if (i + BATCH_SIZE < toFetch.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS))
    }
  }

  return results
}

// ─────────────────────────────────────────
// Fetch one batch from OpenFIGI with exponential backoff on 429
// ─────────────────────────────────────────
async function fetchFromOpenFIGI(
  cusips: string[]
): Promise<Record<string, string | null>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (OPENFIGI_KEY) headers['X-OPENFIGI-APIKEY'] = OPENFIGI_KEY

  const body = JSON.stringify(
    cusips.map(cusip => ({ idType: 'ID_CUSIP', idValue: cusip, exchCode: 'US' }))
  )

  // Retry up to 3 times on 429 with exponential backoff: 5s → 10s → 20s
  const MAX_RETRIES = 3

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoffMs = 5000 * Math.pow(2, attempt - 1)
      console.log(`[CUSIP] Rate limited — retrying in ${backoffMs / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})`)
      await new Promise(r => setTimeout(r, backoffMs))
    }

    const res = await fetch(OPENFIGI_URL, { method: 'POST', headers, body })

    if (res.status === 429) continue // retry with backoff

    if (!res.ok) {
      throw new Error(`OpenFIGI error: ${res.status} ${await res.text()}`)
    }

    const data: Array<{ data?: Array<{ ticker?: string; figi?: string; name?: string }> }>
      = await res.json()

    const results : Record<string, string | null> = {}
    const toCache : { cusip: string; ticker: string; companyName?: string; figi?: string }[] = []

    for (let i = 0; i < cusips.length; i++) {
      const cusip = cusips[i]
      const entry = data[i]

      if (entry?.data && entry.data.length > 0) {
        const match  = entry.data.find(d => d.ticker) ?? entry.data[0]
        const ticker = match.ticker ?? null
        results[cusip] = ticker
        if (ticker) {
          toCache.push({ cusip, ticker, companyName: match.name, figi: match.figi })
        }
      } else {
        results[cusip] = null
      }
    }

    // Upsert assets first — cusip_ticker_map.ticker FK references public.assets(ticker)
    await Promise.all(
      toCache.map(m => upsertAsset({ ticker: m.ticker, name: m.companyName, assetType: 'stock' }))
    )

    // Bulk cache write
    await cacheCusipMappings(toCache)

    return results
  }

  // All retries exhausted
  throw new Error('OpenFIGI: rate limit exceeded after max retries')
}
