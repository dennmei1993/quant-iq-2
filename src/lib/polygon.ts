/**
 * lib/polygon.ts
 * Polygon.io REST API helpers for real asset prices + sparkline OHLC data.
 *
 * Free tier limits:
 *   - 5 API calls / minute
 *   - Previous close & aggregates (daily OHLC) available
 *   - Real-time quote NOT available on free tier → we use prev close
 */

const BASE = 'https://api.polygon.io'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TickerPrice {
  ticker:     string
  price:      number   // previous close
  open:       number
  high:       number
  low:        number
  change:     number   // $ change vs prior close
  change_pct: number   // % change vs prior close
  volume:     number
  updated_at: string   // ISO timestamp of the trading day
}

export interface SparklineBar {
  t: number  // Unix ms timestamp
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

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ─── Crypto ticker mapping ────────────────────────────────────────────────────
// Polygon crypto format: X:BTCUSD
// Covers all 20 seeded cryptos from the asset universe.

const CRYPTO_MAP: Record<string, string> = {
  BTC:   'X:BTCUSD',
  ETH:   'X:ETHUSD',
  BNB:   'X:BNBUSD',
  SOL:   'X:SOLUSD',
  XRP:   'X:XRPUSD',
  USDC:  'X:USDCUSD',
  ADA:   'X:ADAUSD',
  AVAX:  'X:AVAXUSD',
  DOGE:  'X:DOGEUSD',
  TRX:   'X:TRXUSD',
  LINK:  'X:LINKUSD',
  DOT:   'X:DOTUSD',
  MATIC: 'X:MATICUSD',
  SHIB:  'X:SHIBUSD',
  LTC:   'X:LTCUSD',
  UNI:   'X:UNIUSD',
  ATOM:  'X:ATOMUSD',
  XLM:   'X:XLMUSD',
  NEAR:  'X:NEARUSD',
  ICP:   'X:ICPUSD',
}

function toPolygonTicker(ticker: string): string {
  return CRYPTO_MAP[ticker] ?? ticker
}

// ─── Previous close (single ticker) ──────────────────────────────────────────

async function fetchPrevClose(ticker: string): Promise<TickerPrice | null> {
  const url = `${BASE}/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${polygonKey()}`
  try {
    const res = await fetch(url, { next: { revalidate: 0 } })
    if (!res.ok) {
      console.error(`[polygon] prev close ${ticker} → HTTP ${res.status}`)
      return null
    }
    const json = await res.json()
    if (!json.results?.length) return null

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
  } catch (err) {
    console.error(`[polygon] prev close ${ticker} error:`, err)
    return null
  }
}

// ─── 30-day sparkline (single ticker) ────────────────────────────────────────

async function fetchSparkline(ticker: string): Promise<TickerSparkline | null> {
  const to   = isoDate(1)   // yesterday
  const from = isoDate(44)  // ~30 trading days back

  const url =
    `${BASE}/v2/aggs/ticker/${ticker}/range/1/day/${from}/${to}` +
    `?adjusted=true&sort=asc&limit=30&apiKey=${polygonKey()}`

  try {
    const res = await fetch(url, { next: { revalidate: 0 } })
    if (!res.ok) {
      console.error(`[polygon] sparkline ${ticker} → HTTP ${res.status}`)
      return null
    }
    const json = await res.json()
    if (!json.results?.length) return null

    const bars: SparklineBar[] = json.results.slice(-30).map((r: any) => ({
      t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v,
    }))

    return { ticker, bars }
  } catch (err) {
    console.error(`[polygon] sparkline ${ticker} error:`, err)
    return null
  }
}

// ─── Batch exports (rate-limit aware) ────────────────────────────────────────
// Free tier: 5 req/min → 13s pause between batches of 5.
// Remove the sleep if you upgrade to a paid Polygon plan.

export async function fetchPricesForTickers(
  tickers: string[]
): Promise<Map<string, TickerPrice>> {
  const result   = new Map<string, TickerPrice>()
  const BATCH    = 5
  const DELAY_MS = 13_000

  for (let i = 0; i < tickers.length; i += BATCH) {
    await Promise.all(
      tickers.slice(i, i + BATCH).map(async t => {
        const price = await fetchPrevClose(toPolygonTicker(t))
        if (price) result.set(t, { ...price, ticker: t })
      })
    )
    if (i + BATCH < tickers.length) {
      console.log(`[polygon] price batch ${Math.floor(i / BATCH) + 1} done — waiting ${DELAY_MS / 1000}s`)
      await sleep(DELAY_MS)
    }
  }

  return result
}

export async function fetchSparklinesForTickers(
  tickers: string[]
): Promise<Map<string, SparklineBar[]>> {
  const result   = new Map<string, SparklineBar[]>()
  const BATCH    = 5
  const DELAY_MS = 13_000

  for (let i = 0; i < tickers.length; i += BATCH) {
    await Promise.all(
      tickers.slice(i, i + BATCH).map(async t => {
        const sparkline = await fetchSparkline(toPolygonTicker(t))
        if (sparkline) result.set(t, sparkline.bars)
      })
    )
    if (i + BATCH < tickers.length) {
      console.log(`[polygon] sparkline batch ${Math.floor(i / BATCH) + 1} done — waiting ${DELAY_MS / 1000}s`)
      await sleep(DELAY_MS)
    }
  }

  return result
}
