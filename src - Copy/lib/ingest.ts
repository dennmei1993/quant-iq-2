// src/lib/ingest.ts
// Fetches raw events from external APIs

export async function fetchNewsEvents() {
  const apiKey = process.env.NEWSAPI_KEY
  if (!apiKey) throw new Error('NEWSAPI_KEY not set')

  const queries = [
    'Federal Reserve interest rates',
    'US stock market economy',
    'geopolitical US trade war tariffs',
    'semiconductor AI technology investment',
    'oil energy OPEC commodity',
  ]

  const allArticles: NewsArticle[] = []

  for (const q of queries) {
    const url = new URL('https://newsapi.org/v2/everything')
    url.searchParams.set('q', q)
    url.searchParams.set('language', 'en')
    url.searchParams.set('sortBy', 'publishedAt')
    url.searchParams.set('pageSize', '5')
    url.searchParams.set('from', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    url.searchParams.set('apiKey', apiKey)

    try {
      const res = await fetch(url.toString(), { next: { revalidate: 0 } })
      const data = await res.json()
      if (data.articles) allArticles.push(...data.articles)
    } catch (err) {
      console.error(`NewsAPI fetch failed for query "${q}":`, err)
    }
  }

  // Deduplicate by URL
  const seen = new Set<string>()
  return allArticles.filter(a => {
    if (!a.url || seen.has(a.url)) return false
    seen.add(a.url)
    return true
  })
}

export async function fetchFredIndicators() {
  // FRED API — free, no key required for basic series
  const series = ['FEDFUNDS', 'CPIAUCSL', 'UNRATE', 'GDP']
  const results = []

  for (const id of series) {
    try {
      const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`
      const res = await fetch(url, { next: { revalidate: 3600 } })
      const text = await res.text()
      const lines = text.trim().split('\n')
      const last = lines[lines.length - 1].split(',')
      results.push({ series: id, date: last[0], value: last[1] })
    } catch (err) {
      console.error(`FRED fetch failed for ${id}:`, err)
    }
  }

  return results
}

interface NewsArticle {
  title: string
  description?: string
  url: string
  publishedAt: string
  source?: { name: string }
}
