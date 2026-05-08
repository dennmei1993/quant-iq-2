/**
 * lib/rss-parser.ts
 *
 * Generic RSS 2.0 / Atom 1.0 parser.
 *
 * No external dependencies — uses the Web Fetch API and native DOMParser
 * (available in Next.js Edge / Node runtimes via @xmldom/xmldom polyfill,
 * or directly in Node 18+ via the built-in parseXml experiment).
 *
 * We use a lightweight regex + string approach that handles both RSS 2.0
 * and Atom 1.0 without pulling in a full XML parser library.
 *
 * Output: RawArticle[] — normalised shape consumed by the ingest cron.
 */

import type { FeedSource } from './rss-sources'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RawArticle {
  url:         string        // canonical deduplication key
  headline:    string        // item title, stripped of HTML
  summary:     string | null // description/summary, stripped of HTML
  publishedAt: string        // ISO 8601
  source:      string        // feed source id e.g. 'reuters-markets'
  sourceName:  string        // human label e.g. 'Reuters Markets'
  category:    FeedSource['category']
}

// ─── Fetch + parse ────────────────────────────────────────────────────────────

/**
 * Fetch a single RSS/Atom feed and return normalised articles.
 * Returns [] on any network or parse error (never throws).
 */
export async function fetchFeed(source: FeedSource): Promise<RawArticle[]> {
  try {
    const res = await fetch(source.url, {
      headers: {
        // Identify ourselves politely; some feeds block headless UA
        'User-Agent': 'QuantIQ/1.0 (financial news aggregator; +https://quant-iq.vercel.app)',
        'Accept':     'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
      // 10-second timeout — don't let a slow feed block the whole cron
      signal: AbortSignal.timeout(10_000),
      next:   { revalidate: 0 }, // always fresh
    })

    if (!res.ok) {
      console.warn(`[rss] ${source.id}: HTTP ${res.status}`)
      return []
    }

    const xml = await res.text()
    return parseXml(xml, source)

  } catch (err) {
    console.warn(`[rss] ${source.id}: fetch failed —`, (err as Error).message)
    return []
  }
}

/**
 * Fetch all provided feeds concurrently (up to maxConcurrent at a time).
 * Returns a flat, deduplicated array sorted by publishedAt desc.
 */
export async function fetchAllFeeds(
  sources: FeedSource[],
  maxConcurrent = 5
): Promise<RawArticle[]> {
  const results: RawArticle[] = []

  // Process in batches to avoid overwhelming the network
  for (let i = 0; i < sources.length; i += maxConcurrent) {
    const batch = sources.slice(i, i + maxConcurrent)
    const batchResults = await Promise.all(batch.map(fetchFeed))
    results.push(...batchResults.flat())
  }

  // Deduplicate by URL across all feeds
  const seen = new Set<string>()
  const deduped = results.filter(a => {
    if (seen.has(a.url)) return false
    seen.add(a.url)
    return true
  })

  // Sort newest first
  return deduped.sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  )
}

// ─── XML parsing ──────────────────────────────────────────────────────────────

function parseXml(xml: string, source: FeedSource): RawArticle[] {
  // Detect format
  const isAtom = xml.includes('<feed') && xml.includes('xmlns="http://www.w3.org/2005/Atom"')
  return isAtom ? parseAtom(xml, source) : parseRss(xml, source)
}

// ── RSS 2.0 ──────────────────────────────────────────────────────────────────

function parseRss(xml: string, source: FeedSource): RawArticle[] {
  const items = splitOnTag(xml, 'item')
  return items.flatMap(item => {
    const title   = extractText(item, 'title')
    const link    = extractText(item, 'link') || extractAttr(item, 'guid', '_text')
    const desc    = extractText(item, 'description')
    const pubDate = extractText(item, 'pubDate')

    if (!title || !link) return []

    const publishedAt = parseDate(pubDate)
    if (!publishedAt) return []

    // Skip items older than 48 hours
    if (Date.now() - new Date(publishedAt).getTime() > 48 * 3_600_000) return []

    return [{
      url:         normaliseUrl(link),
      headline:    stripHtml(title).trim(),
      summary:     desc ? stripHtml(desc).trim().slice(0, 500) : null,
      publishedAt,
      source:      source.id,
      sourceName:  source.name,
      category:    source.category,
    }]
  })
}

// ── Atom 1.0 ─────────────────────────────────────────────────────────────────

function parseAtom(xml: string, source: FeedSource): RawArticle[] {
  const entries = splitOnTag(xml, 'entry')
  return entries.flatMap(entry => {
    const title   = extractText(entry, 'title')
    // Atom links: <link href="..."/> or <link rel="alternate" href="..."/>
    const link    = extractAtomLink(entry)
    const summary = extractText(entry, 'summary') || extractText(entry, 'content')
    const updated = extractText(entry, 'updated') || extractText(entry, 'published')

    if (!title || !link) return []

    const publishedAt = parseDate(updated)
    if (!publishedAt) return []

    if (Date.now() - new Date(publishedAt).getTime() > 48 * 3_600_000) return []

    return [{
      url:         normaliseUrl(link),
      headline:    stripHtml(title).trim(),
      summary:     summary ? stripHtml(summary).trim().slice(0, 500) : null,
      publishedAt,
      source:      source.id,
      sourceName:  source.name,
      category:    source.category,
    }]
  })
}

// ─── XML helpers ──────────────────────────────────────────────────────────────

/** Split XML string into array of inner content between <tag>...</tag> */
function splitOnTag(xml: string, tag: string): string[] {
  const results: string[] = []
  const openTag  = `<${tag}`
  const closeTag = `</${tag}>`
  let pos = 0

  while (true) {
    const start = xml.indexOf(openTag, pos)
    if (start === -1) break
    const end = xml.indexOf(closeTag, start)
    if (end === -1) break
    results.push(xml.slice(start, end + closeTag.length))
    pos = end + closeTag.length
  }

  return results
}

/** Extract text content of a tag, handling CDATA */
function extractText(xml: string, tag: string): string {
  // Match <tag>...</tag> or <tag attr="...">...</tag>
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i')
  const m  = xml.match(re)
  if (!m) return ''
  let content = m[1].trim()
  // Unwrap CDATA
  const cdata = content.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/)
  if (cdata) content = cdata[1].trim()
  return content
}

/** Extract a specific attribute from a self-closing or open tag */
function extractAttr(xml: string, tag: string, attr: string): string {
  if (attr === '_text') return extractText(xml, tag)
  const re = new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`, 'i')
  return xml.match(re)?.[1] ?? ''
}

/** For Atom: find the href of the alternate/canonical link */
function extractAtomLink(entry: string): string {
  // Prefer rel="alternate"
  const altM = entry.match(/<link[^>]+rel="alternate"[^>]+href="([^"]+)"/i)
  if (altM) return altM[1]
  // Fall back to any link with href
  const anyM = entry.match(/<link[^>]+href="([^"]+)"/i)
  if (anyM) return anyM[1]
  // Or plain <link>url</link>
  return extractText(entry, 'link')
}

// ─── Utility helpers ──────────────────────────────────────────────────────────

/** Strip HTML tags and decode common entities */
/** Strip HTML tags and decode common HTML/XML entities */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g,    ' ')
    .replace(/&amp;/g,      '&')
    .replace(/&lt;/g,       '<')
    .replace(/&gt;/g,       '>')
    .replace(/&quot;/g,     '"')
    .replace(/&apos;/g,     "'")   // XML entity — RSS feeds use this
    .replace(/&#39;/g,      "'")   // decimal apostrophe
    .replace(/&#x27;/g,     "'")   // hex apostrophe
    .replace(/&#8216;/g,    '\u2018') // left single quote
    .replace(/&#8217;/g,    '\u2019') // right single quote / curly apostrophe
    .replace(/&#8220;/g,    '\u201C') // left double quote
    .replace(/&#8221;/g,    '\u201D') // right double quote
    .replace(/&#8211;/g,    '\u2013') // en dash
    .replace(/&#8212;/g,    '\u2014') // em dash
    .replace(/&#160;/g,     ' ')   // non-breaking space (decimal)
    .replace(/&nbsp;/g,     ' ')   // non-breaking space (named)
    .replace(/&#x[0-9a-fA-F]+;/g, c => {
      try { return String.fromCodePoint(parseInt(c.slice(3, -1), 16)) } catch { return '' }
    })
    .replace(/&#[0-9]+;/g, c => {
      try { return String.fromCodePoint(parseInt(c.slice(2, -1), 10)) } catch { return '' }
    })
    .replace(/\s{2,}/g,    ' ')
    .trim()
}

/** Parse a variety of date formats into ISO 8601 string */
function parseDate(raw: string | undefined | null): string | null {
  if (!raw) return null
  try {
    const d = new Date(raw.trim())
    if (isNaN(d.getTime())) return null
    return d.toISOString()
  } catch {
    return null
  }
}

/** Strip tracking params and normalise URL for deduplication */
function normaliseUrl(url: string): string {
  try {
    const u = new URL(url.trim())
    // Remove common tracking query params
    const drop = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','ref','source']
    drop.forEach(p => u.searchParams.delete(p))
    return u.toString()
  } catch {
    return url.trim()
  }
}
