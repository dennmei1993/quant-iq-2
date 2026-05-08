/**
 * app/api/rss/feeds/route.ts
 *
 * GET /api/rss/feeds
 *
 * Returns a JSON list of all available feed URLs with their descriptions.
 * Used by the dashboard "Subscribe" UI to display subscribable feeds.
 * Also doubles as a machine-readable feed directory.
 *
 * Public — no auth required.
 */

import { NextResponse } from 'next/server'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://quant-iq.vercel.app'

const FEEDS = [
  {
    id:          'all',
    title:       'All intelligence',
    description: 'All AI-classified macro and market events',
    url:         `${APP_URL}/api/rss`,
  },
  {
    id:          'high-impact',
    title:       'High-impact events only',
    description: 'Events likely to move assets >2%',
    url:         `${APP_URL}/api/rss?impact=high`,
  },
  {
    id:          'monetary-policy',
    title:       'Central bank & monetary policy',
    description: 'Fed, ECB, rate decisions, FOMC commentary',
    url:         `${APP_URL}/api/rss?type=monetary_policy`,
  },
  {
    id:          'geopolitical',
    title:       'Geopolitical events',
    description: 'Trade, sanctions, elections, macro risk',
    url:         `${APP_URL}/api/rss?type=geopolitical`,
  },
  {
    id:          'economic-data',
    title:       'Economic data releases',
    description: 'CPI, NFP, GDP, PMI, and other macro data',
    url:         `${APP_URL}/api/rss?type=economic_data`,
  },
  {
    id:          'corporate',
    title:       'Corporate events',
    description: 'Earnings, M&A, guidance, management changes',
    url:         `${APP_URL}/api/rss?type=corporate`,
  },
  {
    id:          'technology',
    title:       'Technology sector',
    description: 'Events affecting technology stocks and ETFs',
    url:         `${APP_URL}/api/rss?sector=technology`,
  },
  {
    id:          'energy',
    title:       'Energy sector',
    description: 'Oil, gas, renewables, and energy policy',
    url:         `${APP_URL}/api/rss?sector=energy`,
  },
  {
    id:          'financials',
    title:       'Financials sector',
    description: 'Banks, insurance, and financial services',
    url:         `${APP_URL}/api/rss?sector=financials`,
  },
  {
    id:          'healthcare',
    title:       'Healthcare sector',
    description: 'Pharma, biotech, medtech, and health policy',
    url:         `${APP_URL}/api/rss?sector=healthcare`,
  },
]

export async function GET() {
  return NextResponse.json({ feeds: FEEDS }, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
