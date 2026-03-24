/**
 * lib/rss-sources.ts
 *
 * Master list of RSS feeds to ingest.
 *
 * To add a new source: append one entry to FEED_SOURCES.
 * Nothing else needs to change — the ingest cron picks it up automatically.
 *
 * Fields:
 *   id       — stable identifier used in logs and deduplication
 *   name     — human-readable label
 *   url      — RSS / Atom feed URL
 *   category — broad topic hint passed to Claude for context
 *   enabled  — set false to pause without deleting
 *   priority — lower = fetched first; high-priority feeds processed before rate-limited ones
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
  // ── Reuters ────────────────────────────────────────────────────────────────
  {
    id:       'reuters-business',
    name:     'Reuters Business',
    url:      'https://feeds.reuters.com/reuters/businessNews',
    category: 'markets',
    enabled:  true,
    priority: 1,
  },
  {
    id:       'reuters-markets',
    name:     'Reuters Markets',
    url:      'https://feeds.reuters.com/reuters/financialsNewsGlobal',
    category: 'markets',
    enabled:  true,
    priority: 1,
  },
  {
    id:       'reuters-world',
    name:     'Reuters World News',
    url:      'https://feeds.reuters.com/reuters/worldNews',
    category: 'geopolitical',
    enabled:  true,
    priority: 2,
  },

  // ── Financial Times ────────────────────────────────────────────────────────
  {
    id:       'ft-markets',
    name:     'FT Markets',
    url:      'https://www.ft.com/markets?format=rss',
    category: 'markets',
    enabled:  true,
    priority: 1,
  },
  {
    id:       'ft-world',
    name:     'FT World',
    url:      'https://www.ft.com/world?format=rss',
    category: 'geopolitical',
    enabled:  true,
    priority: 2,
  },

  // ── WSJ ───────────────────────────────────────────────────────────────────
  {
    id:       'wsj-markets',
    name:     'WSJ Markets',
    url:      'https://feeds.content.dowjones.io/public/rss/mw_marketpulse',
    category: 'markets',
    enabled:  true,
    priority: 1,
  },
  {
    id:       'wsj-economy',
    name:     'WSJ Economy',
    url:      'https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines',
    category: 'macro',
    enabled:  true,
    priority: 2,
  },

  // ── Bloomberg (public RSS — limited) ──────────────────────────────────────
  {
    id:       'bloomberg-markets',
    name:     'Bloomberg Markets',
    url:      'https://feeds.bloomberg.com/markets/news.rss',
    category: 'markets',
    enabled:  true,
    priority: 1,
  },
  {
    id:       'bloomberg-politics',
    name:     'Bloomberg Politics',
    url:      'https://feeds.bloomberg.com/politics/news.rss',
    category: 'geopolitical',
    enabled:  true,
    priority: 2,
  },

  // ── Seeking Alpha ─────────────────────────────────────────────────────────
  {
    id:       'seeking-alpha-market',
    name:     'Seeking Alpha Market News',
    url:      'https://seekingalpha.com/market_currents.xml',
    category: 'markets',
    enabled:  true,
    priority: 2,
  },

  // ── CNBC ──────────────────────────────────────────────────────────────────
  {
    id:       'cnbc-top-news',
    name:     'CNBC Top News',
    url:      'https://www.cnbc.com/id/100003114/device/rss/rss.html',
    category: 'markets',
    enabled:  true,
    priority: 2,
  },
  {
    id:       'cnbc-finance',
    name:     'CNBC Finance',
    url:      'https://www.cnbc.com/id/10000664/device/rss/rss.html',
    category: 'markets',
    enabled:  true,
    priority: 2,
  },

  // ── Macro / Central bank (to add next sprint) ─────────────────────────────
  // {
  //   id:       'fed-press-releases',
  //   name:     'Federal Reserve Press Releases',
  //   url:      'https://www.federalreserve.gov/feeds/press_all.xml',
  //   category: 'central_bank',
  //   enabled:  false,
  //   priority: 1,
  // },
  // {
  //   id:       'sec-edgar-8k',
  //   name:     'SEC EDGAR 8-K Filings',
  //   url:      'https://efts.sec.gov/LATEST/search-index?q=%22%22&dateRange=custom&startdt=2024-01-01&forms=8-K&_source=hits.hits._source.period_of_report,hits.hits._source.entity_name&hits.hits.total=true',
  //   category: 'filings',
  //   enabled:  false,
  //   priority: 3,
  // },
]

// Active feeds sorted by priority
export const activeSources = FEED_SOURCES
  .filter(f => f.enabled)
  .sort((a, b) => a.priority - b.priority)
