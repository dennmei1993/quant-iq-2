// src/lib/track-asset.ts  (quant-iq-2)
//
// Call this whenever a user adds an asset to watchlist or portfolio.
// Delegates to /api/assets/track which proxies to the engine.
// Never throws — safe to use in any route without try/catch.
//
// Usage:
//   import { trackAsset } from '@/lib/track-asset'
//   await trackAsset(ticker)   // in watchlist add route
//   await trackAsset(ticker)   // in portfolio/holdings add route

export async function trackAsset(ticker: string): Promise<{
  backfilled: number
  already_tracked: boolean
  error?: string
}> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL
      ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')

    const res = await fetch(`${baseUrl}/api/assets/track`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ticker }),
      signal:  AbortSignal.timeout(55_000),
    })

    const data = await res.json()

    if (data.backfilled > 0) {
      console.log(`[track-asset] ${ticker}: backfilled ${data.backfilled} rows`)
    }

    return {
      backfilled:      data.backfilled ?? 0,
      already_tracked: data.already_tracked ?? false,
      error:           data.error,
    }
  } catch (e: any) {
    console.warn(`[track-asset] ${ticker}:`, e.message ?? String(e))
    return { backfilled: 0, already_tracked: false, error: String(e) }
  }
}
