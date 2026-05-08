/**
 * app/api/rss/route.ts
 *
 * GET /api/rss
 *
 * Publishes Quant IQ's classified event intelligence as a valid RSS 2.0 feed.
 * Users can subscribe in any RSS reader (Feedly, Reeder, NetNewsWire, etc.)
 *
 * Query params (all optional):
 *   impact  : high | medium | low       — filter by impact level
 *   sector  : technology | energy | ... — filter by sector
 *   type    : monetary_policy | geopolitical | corporate | economic_data | regulatory
 *   limit   : 1–50, default 20
 *
 * Example URLs:
 *   /api/rss                            — all recent classified events
 *   /api/rss?impact=high                — high-impact events only
 *   /api/rss?sector=technology          — tech sector events
 *   /api/rss?type=monetary_policy       — Fed/central bank events
 *   /api/rss?impact=high&sector=energy  — combined filters
 *
 * Auth: PUBLIC — no session required (read-only, classified data only).
 * Rate limiting: Vercel Edge caching set to 15 minutes.
 *
 * Feed metadata:
 *   Title       : Quant IQ — [filter description] Intelligence Feed
 *   Description : AI-classified macro and market events
 *   Items       : Each event becomes one <item> with AI summary in <description>
 *                 and structured metadata in <category> tags
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

// Valid filter values
const VALID_IMPACTS  = ['high', 'medium', 'low']
const VALID_TYPES    = ['monetary_policy', 'geopolitical', 'corporate', 'economic_data', 'regulatory']

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://quant-iq.vercel.app'

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const impact  = params.get('impact')
  const sector  = params.get('sector')
  const type    = params.get('type')
  const limit   = Math.min(50, Math.max(1, parseInt(params.get('limit') ?? '20', 10)))

  // Validate params
  if (impact && !VALID_IMPACTS.includes(impact)) {
    return new NextResponse('Invalid impact param', { status: 400 })
  }
  if (type && !VALID_TYPES.includes(type)) {
    return new NextResponse('Invalid type param', { status: 400 })
  }

  // Use service client — this is a public endpoint, no user session needed
  const supabase = createServiceClient()

  // Build query
  let query = supabase
    .from('events')
    .select('id, headline, source_url, source, source_name, published_at, event_type, sectors, sentiment_score, impact_score, tickers, ai_summary')
    .eq('ai_processed', true)
    .not('ai_summary', 'is', null)
    .order('published_at', { ascending: false })
    .limit(limit)

  if (impact)  query = query.eq('impact_score', impact)
  if (type)    query = query.eq('event_type', type)
  if (sector)  query = query.contains('sectors', [sector])

  const { data: events, error } = await query

  if (error) {
    console.error('[rss] DB error:', error.message)
    return new NextResponse('Internal error', { status: 500 })
  }

  // Build human-readable feed title from active filters
  const filterParts: string[] = []
  if (impact)  filterParts.push(`${impact}-impact`)
  if (type)    filterParts.push(type.replace(/_/g, ' '))
  if (sector)  filterParts.push(sector.replace(/_/g, ' '))
  const filterLabel = filterParts.length > 0 ? filterParts.join(', ') : 'all'
  const feedTitle   = `Quant IQ — ${filterLabel} intelligence`

  // Build canonical feed URL (with same params)
  const feedUrl = `${APP_URL}/api/rss${req.nextUrl.search}`

  // Render RSS 2.0 XML
  const xml = buildRss({
    title:       feedTitle,
    description: 'AI-classified macro and market intelligence from Quant IQ. Events are scored for sentiment, impact level, and affected sectors.',
    link:        `${APP_URL}/dashboard/events`,
    feedUrl,
    items:       events ?? [],
  })

  return new NextResponse(xml, {
    status: 200,
    headers: {
      'Content-Type':  'application/rss+xml; charset=utf-8',
      // Cache for 15 minutes at the CDN edge — matches cron cadence
      'Cache-Control': 'public, max-age=900, stale-while-revalidate=300',
    },
  })
}

// ─── RSS 2.0 builder ─────────────────────────────────────────────────────────

interface RssItem {
  id:              string
  headline:        string
  source_url:      string | null
  source:          string | null
  source_name:     string | null
  published_at:    string
  event_type:      string | null
  sectors:         string[] | null
  sentiment_score: number | null
  impact_score: number | null
  tickers:         string[] | null
  ai_summary:      string | null
}

interface RssFeedParams {
  title:       string
  description: string
  link:        string
  feedUrl:     string
  items:       RssItem[]
}

function buildRss({ title, description, link, feedUrl, items }: RssFeedParams): string {
  const now = new Date().toUTCString()

  const itemsXml = items.map(item => {
    const pubDate   = new Date(item.published_at).toUTCString()
    const itemLink  = item.source_url ?? `${APP_URL}/dashboard/events`
    const guid      = item.source_url ?? `${APP_URL}/events/${item.id}`

    // Build rich description combining AI summary + structured metadata
    const sentimentLabel = sentimentStr(item.sentiment_score)
    const tickersStr     = item.tickers?.length ? `Tickers: ${item.tickers.join(', ')}. ` : ''
    const sectorsStr     = item.sectors?.length ? `Sectors: ${item.sectors.join(', ')}. ` : ''
    const impactStr      = item.impact_score ? `Impact: ${item.impact_score}. ` : ''
    const sourceStr      = item.source_name ? `Source: ${item.source_name}. ` : ''

    const fullDescription = [
      item.ai_summary ?? item.headline,
      '',
      impactStr + sentimentLabel + tickersStr + sectorsStr + sourceStr,
    ].join('\n').trim()

    // Category tags: one per sector + event type
    const categories = [
      item.event_type,
      ...(item.sectors ?? []),
      item.impact_score ? `impact:${item.impact_score}` : null,
    ]
      .filter(Boolean)
      .map(c => `      <category>${xmlEscape(c!)}</category>`)
      .join('\n')

    return `
  <item>
    <title>${xmlEscape(item.headline)}</title>
    <link>${xmlEscape(itemLink)}</link>
    <guid isPermaLink="${item.source_url ? 'true' : 'false'}">${xmlEscape(guid)}</guid>
    <pubDate>${pubDate}</pubDate>
    <description><![CDATA[${fullDescription}]]></description>
    <source url="${xmlEscape(feedUrl)}">${xmlEscape(title)}</source>
${categories}
  </item>`
  }).join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:content="http://purl.org/rss/modules/content/">

  <channel>
    <title>${xmlEscape(title)}</title>
    <link>${xmlEscape(link)}</link>
    <description>${xmlEscape(description)}</description>
    <language>en-us</language>
    <lastBuildDate>${now}</lastBuildDate>
    <ttl>15</ttl>
    <atom:link href="${xmlEscape(feedUrl)}" rel="self" type="application/rss+xml"/>
    <image>
      <url>${APP_URL}/icon.png</url>
      <title>${xmlEscape(title)}</title>
      <link>${xmlEscape(link)}</link>
    </image>
${itemsXml}
  </channel>
</rss>`
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function xmlEscape(s: string): string {
  return s
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&apos;')
}

function sentimentStr(score: number | null): string {
  if (score == null) return ''
  if (score >= 0.3)  return `Sentiment: bullish (${(score * 100).toFixed(0)}). `
  if (score <= -0.3) return `Sentiment: bearish (${(score * 100).toFixed(0)}). `
  return `Sentiment: neutral. `
}
