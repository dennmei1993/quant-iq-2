/**
 * lib/polygon.ts
 * Polygon.io REST API helpers for real asset prices + sparkline OHLC data.
 *
 * Free tier: 5 req/min → 15s pause between batches of 5.
 * Retries on 429 rate limit with 15s backoff (up to 2 retries per ticker).
 */

const BASE = 'https://api.polygon.io'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TickerPrice {
  ticker:     string
  price:      number
  open:       number
  high:       number
  low:        number
  change:     number
  change_pct: number
  volume:     number
  updated_at: string
}

export interface SparklineBar {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

export interface TickerSparkline {
  ticker: string
  bars:   SparklineBar[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BATCH    = 5
const DELAY_MS = 15_000  // 15s between batches (free tier: 5 req/min)
const RETRIES  = 2       // retry on 429
const TIMEOUT  = 8_000   // 8s per request

// ─── Crypto ticker mapping ────────────────────────────────────────────────────

const CRYPTO_MAP: Record<string, string> = {
  BTC:   'X:BTCUSD',  ETH:   'X:ETHUSD',  BNB:   'X:BNBUSD',
  SOL:   'X:SOLUSD',  XRP:   'X:XRPUSD',  ADA:   'X:ADAUSD',
  AVAX:  'X:AVAXUSD', DOGE:  'X:DOGEUSD', MATIC: 'X:MATICUSD',
  LINK:  'X:LINKUSD', DOT:   'X:DOTUSD',  LTC:   'X:LTCUSD',
  UNI:   'X:UNIUSD',  ATOM:  'X:ATOMUSD', NEAR:  'X:NEARUSD',
  APT:   'X:APTUSD',  ARB:   'X:ARBUSD',  OP:    'X:OPUSD',
  SUI:   'X:SUIUSD',  INJ:   'X:INJUSD',  RNDR:  'X:RNDRUSD',
  BCH:   'X:BCHUSD',  ALGO:  'X:ALGOUSD',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function polygonKey(): string {
  const key = process.env.POLYGON_API_KEY
  if (!key) throw new Error('POLYGON_API_KEY is not set')
  return key
}

function isoDate(daysAgo = 0): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString().slice(0, 10)
}

function toPolygonTicker(ticker: string): string {
  return CRYPTO_MAP[ticker] ?? ticker
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ─── Core fetch with retry ────────────────────────────────────────────────────

async function polygonFetch(url: string): Promise<any | null> {
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) })

      if (res.status === 429) {
        console.warn(`[polygon] 429 rate limit — attempt ${attempt + 1}/${RETRIES + 1}, waiting 15s`)
        if (attempt < RETRIES) { await sleep(15_000); continue }
        return null
      }

      if (!res.ok) {
        console.error(`[polygon] HTTP ${res.status} for ${url.split('?')[0].split('/').slice(-2).join('/')}`)
        return null
      }

      return await res.json()
    } catch (err) {
      console.error(`[polygon] fetch error attempt ${attempt + 1}:`, err)
      if (attempt < RETRIES) { await sleep(5_000); continue }
      return null
    }
  }
  return null
}

// ─── Previous close (single ticker) ──────────────────────────────────────────

async function fetchPrevClose(ticker: string): Promise<TickerPrice | null> {
  const url  = `${BASE}/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${polygonKey()}`
  const json = await polygonFetch(url)
  if (!json?.results?.length) return null

  const r          = json.results[0]
  const change     = r.c - r.o
  const change_pct = r.o > 0 ? (change / r.o) * 100 : 0

  return {
    ticker,
    price:      r.c,
    open:       r.o,
    high:       r.h,
    low:        r.l,
    change:     parseFloat(change.toFixed(4)),
    change_pct: parseFloat(change_pct.toFixed(4)),
    volume:     r.v,
    updated_at: new Date(r.t).toISOString(),
  }
}

// ─── 30-day sparkline (single ticker) ────────────────────────────────────────

async function fetchSparkline(ticker: string): Promise<TickerSparkline | null> {
  const url  = `${BASE}/v2/aggs/ticker/${ticker}/range/1/day/${isoDate(44)}/${isoDate(1)}?adjusted=true&sort=asc&limit=30&apiKey=${polygonKey()}`
  const json = await polygonFetch(url)
  if (!json?.results?.length) return null

  return {
    ticker,
    bars: json.results.slice(-30).map((r: any) => ({
      t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v,
    })),
  }
}

// ─── Batch helper ─────────────────────────────────────────────────────────────

async function batchFetch<T>(
  tickers:  string[],
  fetcher:  (polygonTicker: string) => Promise<T | null>,
  label:    string
): Promise<Map<string, T>> {
  const result = new Map<string, T>()

  for (let i = 0; i < tickers.length; i += BATCH) {
    const batch = tickers.slice(i, i + BATCH)

    await Promise.all(batch.map(async t => {
      const data = await fetcher(toPolygonTicker(t))
      if (data) result.set(t, data)
    }))

    if (i + BATCH < tickers.length) {
      console.log(`[polygon] ${label} batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(tickers.length / BATCH)} done — waiting ${DELAY_MS / 1000}s`)
      await sleep(DELAY_MS)
    }
  }

  return result
}

// ─── Public exports ───────────────────────────────────────────────────────────

export async function fetchPricesForTickers(
  tickers: string[]
): Promise<Map<string, TickerPrice>> {
  const raw = await batchFetch(
    tickers,
    async (polygonTicker) => fetchPrevClose(polygonTicker),
    'price'
  )

  // Re-key with original ticker (not Polygon format)
  const result = new Map<string, TickerPrice>()
  for (const [originalTicker, price] of raw) {
    result.set(originalTicker, { ...price, ticker: originalTicker })
  }
  return result
}

export async function fetchSparklinesForTickers(
  tickers: string[]
): Promise<Map<string, SparklineBar[]>> {
  const raw = await batchFetch(
    tickers,
    async (polygonTicker) => fetchSparkline(polygonTicker),
    'sparkline'
  )

  const result = new Map<string, SparklineBar[]>()
  for (const [ticker, sparkline] of raw) {
    result.set(ticker, (sparkline as TickerSparkline).bars)
  }
  return result
}
