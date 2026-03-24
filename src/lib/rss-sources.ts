/**
 * lib/rss-sources.ts
 *
 * Master list of RSS feeds to ingest.
 * To add a source: append one entry. Nothing else changes.
 *
 * Feed status notes (as of 2025):
 *   Reuters      — old feeds.reuters.com URLs are dead; use reutersagency.com
 *   FT           — RSS requires subscription cookie; public feed blocked
 *   Bloomberg    — public RSS feeds live and reliable
 *   MarketWatch  — Dow Jones public feeds work
 *   CNBC         — RSS feeds live and reliable
 *   Seeking Alpha— blocks bots; disabled
 *   Yahoo Finance— reliable public RSS, good volume
 *   Fed          — official XML feeds, free, no auth needed
 */

export interface FeedSource {
  id:       string
  name:     string
  url:      string
  category: 'markets' | 'macro' | 'central_bank' | 'filings' | 'geopolitical' | 'tech'
  enabled:  boolean
  priority: number
}

export const FEED_SOURCES: FeedSource[] = [

  // ── Bloomberg ─────────────────────────────────────────────────────────────
  { id: 'bloomberg-markets',    name: 'Bloomberg Markets',    url: 'https://feeds.bloomberg.com/markets/news.rss',    category: 'markets',     enabled: true,  priority: 1 },
  { id: 'bloomberg-politics',   name: 'Bloomberg Politics',   url: 'https://feeds.bloomberg.com/politics/news.rss',   category: 'geopolitical',enabled: true,  priority: 2 },
  { id: 'bloomberg-technology', name: 'Bloomberg Technology', url: 'https://feeds.bloomberg.com/technology/news.rss', category: 'tech',        enabled: true,  priority: 2 },

  // ── CNBC ──────────────────────────────────────────────────────────────────
  { id: 'cnbc-top-news', name: 'CNBC Top News',  url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', category: 'markets', enabled: true, priority: 1 },
  { id: 'cnbc-finance',  name: 'CNBC Finance',   url: 'https://www.cnbc.com/id/10000664/device/rss/rss.html',  category: 'markets', enabled: true, priority: 2 },
  { id: 'cnbc-economy',  name: 'CNBC Economy',   url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html',  category: 'macro',   enabled: true, priority: 2 },
  { id: 'cnbc-earnings', name: 'CNBC Earnings',  url: 'https://www.cnbc.com/id/15839135/device/rss/rss.html',  category: 'markets', enabled: true, priority: 2 },

  // ── MarketWatch ───────────────────────────────────────────────────────────
  { id: 'marketwatch-pulse',     name: 'MarketWatch Market Pulse', url: 'https://feeds.content.dowjones.io/public/rss/mw_marketpulse',      category: 'markets', enabled: true, priority: 1 },
  { id: 'marketwatch-headlines', name: 'MarketWatch Headlines',    url: 'https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines', category: 'markets', enabled: true, priority: 2 },
  { id: 'marketwatch-economy',   name: 'MarketWatch Economy',      url: 'https://feeds.content.dowjones.io/public/rss/mw_economy',          category: 'macro',   enabled: true, priority: 2 },

  // ── Yahoo Finance ─────────────────────────────────────────────────────────
  { id: 'yahoo-finance-top', name: 'Yahoo Finance Top Stories', url: 'https://finance.yahoo.com/news/rssindex', category: 'markets', enabled: true, priority: 1 },

  // ── Reuters — blocks Vercel IPs entirely; all variants disabled ──────────
  // { id: 'reuters-business',  enabled: false }
  // { id: 'reuters-political', enabled: false }
  // { id: 'reuters-wire',      enabled: false }

  // ── AP News (reliable replacement for Reuters) ────────────────────────────
  { id: 'ap-top-news', name: 'AP Top News',  url: 'https://feeds.apnews.com/apnews/topnews',  category: 'markets',     enabled: true, priority: 1 },
  { id: 'ap-business', name: 'AP Business',  url: 'https://feeds.apnews.com/apnews/business', category: 'markets',     enabled: true, priority: 1 },
  { id: 'ap-politics', name: 'AP Politics',  url: 'https://feeds.apnews.com/apnews/politics', category: 'geopolitical',enabled: true, priority: 2 },

  // ── Federal Reserve (high value, low volume, no auth needed) ─────────────
  { id: 'fed-press-releases', name: 'Federal Reserve Press Releases', url: 'https://www.federalreserve.gov/feeds/press_all.xml', category: 'central_bank', enabled: true, priority: 1 },
  { id: 'fed-speeches',       name: 'Federal Reserve Speeches',       url: 'https://www.federalreserve.gov/feeds/speeches.xml', category: 'central_bank', enabled: true, priority: 1 },

  // ── Investopedia ──────────────────────────────────────────────────────────
  { id: 'investopedia-news', name: 'Investopedia News', url: 'https://www.investopedia.com/feedbuilder/feed/getfeed/?feedName=rss_headline', category: 'markets', enabled: true, priority: 3 },

  // ── Disabled ─────────────────────────────────────────────────────────────
  // FT — requires subscription cookie
  // Seeking Alpha — blocks bots aggressively
  // Old Reuters — feeds.reuters.com 404 since 2023
  // SEC EDGAR — non-standard feed format, needs custom parser

]

// Active feeds sorted by priority
export const activeSources = FEED_SOURCES
  .filter(f => f.enabled)
  .sort((a, b) => a.priority - b.priority)
