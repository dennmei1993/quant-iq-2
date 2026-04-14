// src/app/dashboard/tickers/[ticker]/page.tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { createServiceClient } from '@/lib/supabase/server'
import {
  fetchTickerDetails,
  fetchTickerPrice,
  formatMarketCap,
  formatVolume,
} from '@/lib/polygon-ticker'
import WatchlistButton from '@/components/dashboard/WatchlistButton'
import ThesisButton    from '@/components/dashboard/ThesisButton'
import PortfolioButton from '@/components/dashboard/PortfolioButton'
import OHLCChart                  from '@/components/dashboard/OHLCChart'
import RelativePerformanceChart   from '@/components/dashboard/RelativePerformanceChart'

export const dynamic    = 'force-dynamic'
export const revalidate = 0

// ─── Types ────────────────────────────────────────────────────────────────────

type SignalRow = {
  signal:              string | null
  score:               number | null
  price_usd:           number | null
  change_pct:          number | null
  sparkline:           number[] | null
  fundamental_score:   number | null
  technical_score:     number | null
  f_components:        { valuation: number; profitability: number; analyst: number; theme: number; macro: number } | null
  t_components:        { trend: number; momentum: number; rel_strength: number; volatility: number } | null
  rationale:           string | null
  rationale_signal:    string | null
  rationale_updated_at:string | null
  updated_at:          string | null
}

type ThemeRow = {
  theme_id:    string
  name:        string
  timeframe:   string
  conviction:  number | null
  theme_type:  string
  final_weight:number
}

type EventRow = {
  id:              string
  headline:        string
  ai_summary:      string | null
  sentiment_score: number | null
  impact_score:    number | null
  published_at:    string
}

type AssetRow = {
  ticker:          string
  name:            string
  asset_type:      string
  sector:          string | null
  pe_ratio:        number | null
  pb_ratio:        number | null
  eps:             number | null
  dividend_yield:  number | null
  week_52_high:    number | null
  week_52_low:     number | null
  beta:            number | null
  market_cap:      number | null
  revenue:         number | null
  profit_margin:   number | null
  analyst_target:  number | null
  analyst_rating:  string | null
  financials_updated_at: string | null
}

type OHLCRow = {
  date:   string
  open:   number
  high:   number
  low:    number
  close:  number
  volume: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function query<T>(q: any): Promise<T | null> {
  const result = await q
  return (result as any).data as T | null
}

function signalColor(s: string | null) {
  return ({
    buy:   'var(--signal-bull)',
    watch: 'var(--signal-neut)',
    hold:  'rgba(232,226,217,0.4)',
    avoid: 'var(--signal-bear)',
  } as Record<string, string>)[s ?? ''] ?? 'rgba(232,226,217,0.4)'
}

function sentimentColor(s: number | null) {
  if (!s) return 'var(--signal-neut)'
  if (s > 0.1)  return 'var(--signal-bull)'
  if (s < -0.1) return 'var(--signal-bear)'
  return 'var(--signal-neut)'
}

function tfLabel(tf: string) {
  return ({ '1m': '1M', '3m': '3M', '6m': '6M' } as Record<string, string>)[tf] ?? tf
}

function relTime(iso: string) {
  const hrs = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000)
  if (hrs < 1)  return 'just now'
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ─── AI rationale generator ───────────────────────────────────────────────────

async function generateSignalRationale(
  ticker:    string,
  name:      string,
  signal:    string,
  price:     number | null,
  changePct: number | null,
  events:    EventRow[]
): Promise<string | null> {
  try {
    const eventContext = events.slice(0, 5).map(e =>
      `- ${e.ai_summary ?? e.headline} (impact: ${e.impact_score ?? '?'}/10, sentiment: ${e.sentiment_score?.toFixed(2) ?? '?'})`
    ).join('\n')

    const priceContext = price
      ? `Current price: $${price.toFixed(2)}, change: ${changePct !== null ? (changePct >= 0 ? '+' : '') + changePct.toFixed(2) + '%' : 'N/A'}`
      : 'Price data unavailable'

    const prompt = `You are a professional investment analyst. Write a detailed signal rationale for ${name} (${ticker}).

Signal: ${signal.toUpperCase()}
${priceContext}

Recent news events:
${eventContext || 'No recent events found.'}

Write a full paragraph (4-6 sentences) explaining:
1. Why this ticker currently has a ${signal} signal
2. What the recent price action and news suggest about near-term outlook
3. Key risks or catalysts investors should watch
4. Context on sector or macro conditions affecting this stock

Be specific, factual, and use plain language that a non-professional investor can understand. Do not use bullet points.`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 400,
        messages:   [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(30_000),
    })

    if (!res.ok) return null
    const data = await res.json()
    return data.content?.[0]?.text?.trim() ?? null
  } catch {
    return null
  }
}

// ─── Signal trigger analysis ──────────────────────────────────────────────────

type TriggerInfo = {
  nextSignal:  string
  fGap:        number | null
  tGap:        number | null
  path:        'technical' | 'fundamental' | 'both'
  explanation: string[]
}

function analyseSignalTrigger(
  signal: string | null,
  f:      number | null,
  t:      number | null,
  fComp:  Record<string, number> | null,
  tComp:  Record<string, number> | null,
): TriggerInfo | null {
  if (!signal || f == null || t == null) return null
  if (signal === 'buy') return null

  type Threshold = { fMin: number; tMin: number; label: string }
  const targets: Threshold[] = [
    { fMin: 65, tMin: 60, label: 'buy'   },
    { fMin: 65, tMin: 40, label: 'watch' },
    { fMin: 40, tMin: 60, label: 'watch' },
  ]

  let nearest: { label: string; fGap: number; tGap: number } | null = null
  const signalOrder = ['avoid', 'hold', 'watch', 'buy']

  for (const t_ of targets) {
    if (t_.label === signal) continue
    if (signalOrder.indexOf(t_.label) <= signalOrder.indexOf(signal)) continue
    const fGap     = Math.max(0, t_.fMin - f)
    const tGap     = Math.max(0, t_.tMin - t)
    const totalGap = fGap + tGap
    if (!nearest || totalGap < nearest.fGap + nearest.tGap) {
      nearest = { label: t_.label, fGap, tGap }
    }
  }

  if (!nearest) return null

  const path: TriggerInfo['path'] =
    nearest.fGap > 0 && nearest.tGap > 0 ? 'both'
    : nearest.tGap > 0 ? 'technical'
    : 'fundamental'

  const explanation: string[] = []

  if (nearest.tGap > 0 && tComp) {
    if ((tComp.trend        ?? 50) < 55) explanation.push(`Price trending below MA5/MA20 — needs sustained move above 20-day average`)
    if ((tComp.momentum     ?? 50) < 45) explanation.push(`RSI momentum weak — watch for reversal above 40 RSI`)
    if ((tComp.rel_strength ?? 50) < 45) explanation.push(`Underperforming SPY over 30 days — needs relative strength recovery`)
    if ((tComp.volatility   ?? 50) > 65) explanation.push(`High volatility reducing score — stabilising price action would help`)
  }

  if (nearest.fGap > 0 && fComp) {
    if ((fComp.valuation                  ?? 50) < 45) explanation.push(`Valuation elevated vs sector — a price pullback or earnings beat would improve this`)
    if ((fComp.analyst ?? fComp.consensus ?? 50) < 60) explanation.push(`Analyst consensus weak — watch for upgrades or price target revisions`)
    if ((fComp.theme                      ?? 50) < 50) explanation.push(`Not prominently featured in active themes — new theme tailwinds would boost score`)
    if ((fComp.macro                      ?? 50) < 45) explanation.push(`Macro environment unfavourable for this sector — watch Fed/inflation data`)
    if ((fComp.profitability              ?? 50) < 50) explanation.push(`Profitability score low — next earnings report is a key catalyst`)
  }

  if (explanation.length === 0) {
    explanation.push(`${nearest.fGap > 0 ? `Fundamental needs +${nearest.fGap} pts. ` : ''}${nearest.tGap > 0 ? `Technical needs +${nearest.tGap} pts.` : ''}`.trim())
  }

  return {
    nextSignal: nearest.label,
    fGap:       nearest.fGap > 0 ? nearest.fGap : null,
    tGap:       nearest.tGap > 0 ? nearest.tGap : null,
    path,
    explanation,
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function TickerPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: rawTicker } = await params
  const ticker = rawTicker.toUpperCase()
  const db     = createServiceClient()

  // ── Auth ──────────────────────────────────────────────────────────────────
  let userId: string | null = null
  try {
    const cookieStore = await cookies()
    const authClient  = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { get: (n: string) => cookieStore.get(n)?.value, set: () => {}, remove: () => {} } }
    )
    const { data: { user } } = await authClient.auth.getUser()
    userId = user?.id ?? null
  } catch { /* unauthenticated */ }

  // ── Active themes ─────────────────────────────────────────────────────────
  const activeThemes = await query<{ id: string; name: string; timeframe: string; conviction: number | null; theme_type: string }[]>(
    db.from('themes').select('id, name, timeframe, conviction, theme_type').eq('is_active', true)
  ) ?? []
  const activeThemeIds = activeThemes.map(t => t.id)
  const themeMap       = new Map(activeThemes.map(t => [t.id, t]))

  // ── Parallel data fetches ─────────────────────────────────────────────────
  const [signal, themeTickerRows, events, assetRow, watchlistRow, portfolioRow, details, price] = await Promise.all([

    query<SignalRow>(
      db.from('asset_signals')
        .select('signal, score, price_usd, change_pct, sparkline, fundamental_score, technical_score, f_components, t_components, rationale, rationale_signal, rationale_updated_at, updated_at')
        .eq('ticker', ticker)
        .single()
    ),

    activeThemeIds.length > 0
      ? query<{ theme_id: string; final_weight: number }[]>(
          db.from('theme_tickers')
            .select('theme_id, final_weight')
            .eq('ticker', ticker)
            .in('theme_id', activeThemeIds)
            .order('final_weight', { ascending: false })
        )
      : Promise.resolve([] as { theme_id: string; final_weight: number }[]),

    query<EventRow[]>(
      db.from('events')
        .select('id, headline, ai_summary, sentiment_score, impact_score, published_at')
        .contains('tickers', [ticker])
        .eq('ai_processed', true)
        .order('published_at', { ascending: false })
        .limit(5)
    ),

    query<AssetRow>(
      db.from('assets')
        .select('ticker, name, asset_type, sector, pe_ratio, pb_ratio, eps, dividend_yield, week_52_high, week_52_low, beta, market_cap, revenue, profit_margin, analyst_target, analyst_rating, financials_updated_at')
        .eq('ticker', ticker)
        .single()
    ),

    userId
      ? query<{ ticker: string }>(
          db.from('user_watchlist').select('ticker').eq('user_id', userId).eq('ticker', ticker).single()
        )
      : Promise.resolve(null),

    userId
      ? query<{ id: string }>(
          db.from('holdings').select('id').eq('ticker', ticker).limit(1).single()
        )
      : Promise.resolve(null),

    fetchTickerDetails(ticker),
    fetchTickerPrice(ticker),
  ])

  if (!assetRow && !details) return notFound()

  // ── OHLC price history — separate query to avoid tuple type issues ─────────
  const ohlcRaw = await query<OHLCRow[]>(
    db.from('daily_prices')
      .select('date, open, high, low, close, volume')
      .eq('ticker', ticker)
      .order('date', { ascending: false })  // latest first
      .limit(365)
  )
  const ohlcPrices = (ohlcRaw ?? []).reverse().map(p => ({
    date:   p.date,
    open:   Number(p.open),
    high:   Number(p.high),
    low:    Number(p.low),
    close:  Number(p.close),
    volume: Number(p.volume),
  }))

  // ── Benchmark + sector peer prices for relative performance chart ───────────
  const sector = assetRow?.sector ?? details?.sector ?? null

  const [spyRaw, qqqRaw, sectorPeersRaw] = await Promise.all([
    query<{ date: string; close: number }[]>(
      db.from('daily_prices')
        .select('date, close')
        .eq('ticker', 'SPY')
        .order('date', { ascending: false })
        .limit(365)
    ),
    query<{ date: string; close: number }[]>(
      db.from('daily_prices')
        .select('date, close')
        .eq('ticker', 'QQQ')
        .order('date', { ascending: false })
        .limit(365)
    ),
    // Sector average: get closes for up to 15 peers, average per date
    sector && sector !== 'Unknown'
      ? query<{ date: string; close: number; ticker: string }[]>(
          db.from('daily_prices')
            .select('date, close, ticker')
            .in('ticker',
              (await db.from('assets')
                .select('ticker')
                .eq('sector', sector)
                .eq('asset_type', 'stock')
                .eq('is_active', true)
                .neq('ticker', ticker)
                .limit(15)
              ).data?.map((a: any) => a.ticker) ?? []
            )
            .order('date', { ascending: false })
            .limit(365 * 15)
        )
      : Promise.resolve(null),
  ])

  const spyPrices = (spyRaw ?? []).reverse().map(p => ({ date: p.date, close: Number(p.close) }))
  const qqqPrices = (qqqRaw ?? []).reverse().map(p => ({ date: p.date, close: Number(p.close) }))

  // Average sector peer closes per date
  const sectorPrices: { date: string; close: number }[] = []
  if (sectorPeersRaw?.length) {
    const dateMap = new Map<string, number[]>()
    for (const row of sectorPeersRaw) {
      const closes = dateMap.get(row.date) ?? []
      closes.push(Number(row.close))
      dateMap.set(row.date, closes)
    }
    const sortedDates = [...dateMap.keys()].sort()
    for (const date of sortedDates) {
      const closes = dateMap.get(date)!
      sectorPrices.push({ date, close: +(closes.reduce((a, b) => a + b, 0) / closes.length).toFixed(4) })
    }
  }

  // ── Auto-sync: fetch price if signal missing ──────────────────────────────
  let signalData: SignalRow | null = signal
  if (!signalData?.signal || !signalData?.sparkline?.length) {
    try {
      const base    = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.betteroption.com.au'
      const syncRes = await fetch(`${base}/api/admin/sync-prices?tickers=${ticker}`, {
        method:  'POST',
        headers: { 'x-admin-secret': process.env.ADMIN_SECRET ?? '' },
      })
      if (syncRes.ok) {
        const fresh = await query<SignalRow>(
          db.from('asset_signals')
            .select('signal, score, price_usd, change_pct, sparkline, fundamental_score, technical_score, f_components, t_components, rationale, rationale_signal, rationale_updated_at, updated_at')
            .eq('ticker', ticker)
            .single()
        )
        if (fresh) signalData = fresh
      }
    } catch { /* sync failed silently */ }
  }

  // ── FMP auto-sync ─────────────────────────────────────────────────────────
  const financialsAge   = assetRow?.financials_updated_at
    ? (Date.now() - new Date(assetRow.financials_updated_at).getTime()) / 3_600_000
    : Infinity
  const needsFinancials = assetRow?.asset_type !== 'crypto' &&
    assetRow?.asset_type !== 'commodity' &&
    (!assetRow?.pe_ratio || financialsAge > 168)

  if (needsFinancials) {
    try {
      const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.betteroption.com.au'
      await fetch(`${base}/api/admin/sync-fmp?tickers=${ticker}`, {
        method:  'POST',
        headers: { 'x-admin-secret': process.env.ADMIN_SECRET ?? '' },
      })
      const freshAsset = await query<AssetRow>(
        db.from('assets')
          .select('ticker, name, asset_type, sector, pe_ratio, pb_ratio, eps, dividend_yield, week_52_high, week_52_low, beta, market_cap, revenue, profit_margin, analyst_target, analyst_rating, financials_updated_at')
          .eq('ticker', ticker)
          .single()
      )
      if (freshAsset) Object.assign(assetRow ?? {}, freshAsset)
    } catch { /* FMP sync failed silently */ }
  }

  // ── Rationale ─────────────────────────────────────────────────────────────
  const rationaleAge   = signalData?.rationale_updated_at
    ? (Date.now() - new Date(signalData.rationale_updated_at).getTime()) / 3_600_000
    : Infinity
  const needsRationale = signalData?.signal && (
    !signalData.rationale || signalData.signal !== signalData.rationale_signal || rationaleAge > 168
  )

  if (needsRationale) {
    try {
      const rationale = await generateSignalRationale(
        ticker,
        details?.name ?? assetRow?.name ?? ticker,
        signalData!.signal!,
        signalData!.price_usd ?? null,
        signalData!.change_pct ?? null,
        events ?? [],
      )
      if (rationale && signalData) {
        await (db.from('asset_signals') as any)
          .update({ rationale, rationale_signal: signalData.signal, rationale_updated_at: new Date().toISOString() })
          .eq('ticker', ticker)
        signalData = { ...signalData, rationale, rationale_signal: signalData.signal }
      }
    } catch { /* rationale generation failed silently */ }
  }

  // ── Derived values ────────────────────────────────────────────────────────
  const themes: ThemeRow[] = (themeTickerRows ?? [])
    .map(row => {
      const t = themeMap.get(row.theme_id)
      if (!t) return null
      return { theme_id: row.theme_id, final_weight: row.final_weight, ...t }
    })
    .filter(Boolean) as ThemeRow[]

  const name          = details?.name ?? assetRow?.name ?? ticker
  const isWatched     = !!watchlistRow
  const isInPortfolio = !!portfolioRow
  const recentEvents  = events ?? []
  const changeUp      = (price?.change_pct ?? 0) >= 0

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      <Link href="/dashboard/assets" style={{ fontSize: '0.75rem', color: 'rgba(200,169,110,0.5)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.3rem', marginBottom: '1.5rem' }}>
        ← Asset Screener
      </Link>

      {/* ── Header: ticker + name + signal + action buttons ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', marginBottom: '0.25rem' }}>
            <h1 style={{ color: 'var(--cream)', fontFamily: 'monospace', fontSize: '2rem', fontWeight: 700, margin: 0 }}>
              {ticker}
            </h1>
            {signalData?.signal && (
              <span style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: signalColor(signalData.signal), background: `${signalColor(signalData.signal)}18`, padding: '0.2rem 0.55rem', borderRadius: 4 }}>
                {signalData.signal}
              </span>
            )}
            {price?.close && (
              <span style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--cream)', fontFamily: 'monospace' }}>
                ${price.close.toFixed(2)}
              </span>
            )}
            {price?.change_pct != null && (
              <span style={{ fontSize: '0.85rem', color: changeUp ? 'var(--signal-bull)' : 'var(--signal-bear)', fontWeight: 500 }}>
                {changeUp ? '+' : ''}{price.change_pct.toFixed(2)}%
              </span>
            )}
            {price?.volume != null && (
              <span style={{ fontSize: '0.72rem', color: 'rgba(232,226,217,0.3)', fontFamily: 'monospace' }}>
                Vol {formatVolume(price.volume)}
              </span>
            )}
          </div>
          <div style={{ color: 'rgba(232,226,217,0.45)', fontSize: '0.9rem' }}>{name}</div>
          {(details?.sector || assetRow?.sector) && (
            <div style={{ fontSize: '0.72rem', color: 'rgba(232,226,217,0.25)', marginTop: '0.15rem' }}>
              {details?.sector ?? assetRow?.sector} · {details?.exchange ?? assetRow?.asset_type}
            </div>
          )}

          {/* ── Key financials inline under ticker ── */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1.2rem', marginTop: '0.6rem' }}>
            {[
              ['Mkt Cap',  formatMarketCap((assetRow?.market_cap ?? details?.market_cap) ?? null)],
              ['52W H',    assetRow?.week_52_high  != null ? `$${assetRow.week_52_high.toFixed(2)}`  : null],
              ['52W L',    assetRow?.week_52_low   != null ? `$${assetRow.week_52_low.toFixed(2)}`   : null],
              ['P/E',      assetRow?.pe_ratio      != null ? assetRow.pe_ratio.toFixed(1)             : null],
              ['EPS',      assetRow?.eps           != null ? `$${assetRow.eps.toFixed(2)}`            : null],
              ['Beta',     assetRow?.beta          != null ? assetRow.beta.toFixed(2)                 : null],
              ['Div',      assetRow?.dividend_yield != null ? `${assetRow.dividend_yield.toFixed(2)}%` : null],
              ['Target',   assetRow?.analyst_target != null ? `$${assetRow.analyst_target.toFixed(2)}` : null],
            ].filter(([, v]) => v && v !== '—').map(([label, val]) => (
              <span key={label as string} style={{ fontSize: '0.7rem', color: 'rgba(232,226,217,0.55)', fontFamily: 'monospace' }}>
                <span style={{ color: 'rgba(232,226,217,0.28)', marginRight: 3 }}>{label}</span>{val}
              </span>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <ThesisButton ticker={ticker} />
          {userId && <PortfolioButton ticker={ticker} name={name} initialAdded={isInPortfolio} />}
          {userId && <WatchlistButton ticker={ticker} initialWatched={isWatched} />}
        </div>
      </div>

      {/* ── Relative performance chart — collapsible ── */}
      {(details?.description || assetRow) && (
        <details style={{ marginBottom: '1rem' }}>
          <summary style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.3)', textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', padding: '0.4rem 0', borderBottom: '1px solid rgba(255,255,255,0.06)', listStyle: 'none', display: 'flex', alignItems: 'center', gap: '0.4rem', userSelect: 'none' }}>
            <span style={{ fontSize: '0.55rem', color: 'rgba(232,226,217,0.2)' }}>▶</span> About
          </summary>
          <div style={{ background: 'var(--navy2)', border: '1px solid var(--dash-border)', borderRadius: 10, padding: '1rem 1.2rem', marginTop: '0.5rem' }}>
            {details?.description && (
              <p style={{ fontSize: '0.8rem', color: 'rgba(232,226,217,0.55)', lineHeight: 1.7, margin: '0 0 0.6rem' }}>
                {details.description.slice(0, 500)}{details.description.length > 500 ? '…' : ''}
              </p>
            )}
            {details?.homepage && (
              <a href={details.homepage} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: '0.72rem', color: 'var(--gold)', opacity: 0.6, display: 'inline-block' }}>
                {details.homepage.replace(/^https?:\/\//, '')} ↗
              </a>
            )}
          </div>
        </details>
      )}

      {/* ── About — inline, collapsible ── */}

      {/* ── Chart — inline, collapsible ── */}
      <details style={{ marginBottom: '1rem' }}>
        <summary style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.3)', textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', padding: '0.4rem 0', borderBottom: '1px solid rgba(255,255,255,0.06)', listStyle: 'none', display: 'flex', alignItems: 'center', gap: '0.4rem', userSelect: 'none' }}>
          <span style={{ fontSize: '0.55rem', color: 'rgba(232,226,217,0.2)' }}>▶</span> Price Chart
        </summary>
        <div style={{ background: 'var(--navy2)', border: '1px solid var(--dash-border)', borderRadius: 10, padding: '1rem 1.2rem', marginTop: '0.5rem' }}>
          <OHLCChart prices={ohlcPrices} ticker={ticker} />
        </div>
      </details>

      {(spyPrices.length > 0 || ohlcPrices.length > 0) && (
        <details style={{ marginBottom: '1rem' }}>
          <summary style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.3)', textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', padding: '0.4rem 0', borderBottom: '1px solid rgba(255,255,255,0.06)', listStyle: 'none', display: 'flex', alignItems: 'center', gap: '0.4rem', userSelect: 'none' }}>
            <span style={{ fontSize: '0.55rem', color: 'rgba(232,226,217,0.2)' }}>▶</span> Relative Performance
          </summary>
          <div style={{ background: 'var(--navy2)', border: '1px solid var(--dash-border)', borderRadius: 10, overflow: 'hidden', marginTop: '0.5rem' }}>
            <RelativePerformanceChart
              ticker={ticker}
              tickerPrices={ohlcPrices.map(p => ({ date: p.date, close: p.close }))}
              spyPrices={spyPrices}
              qqqPrices={qqqPrices}
              sectorPrices={sectorPrices}
              sector={sector}
            />
          </div>
        </details>
      )}

            {/* ── Signal analysis — collapsible ── */}
      {signalData?.signal && (
        <details style={{ marginBottom: '1rem' }}>
          <summary style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.3)', textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', padding: '0.4rem 0', borderBottom: '1px solid rgba(255,255,255,0.06)', listStyle: 'none', display: 'flex', alignItems: 'center', gap: '0.4rem', userSelect: 'none' }}>
            <span style={{ fontSize: '0.55rem', color: 'rgba(232,226,217,0.2)' }}>▶</span> Signal Analysis
          </summary>
          <div style={{ background: 'var(--navy2)', border: '1px solid var(--dash-border)', borderRadius: 10, padding: '1.2rem 1.4rem', marginTop: '0.5rem' }}>

              {(signalData.fundamental_score != null || signalData.technical_score != null) && (
                <div style={{ marginBottom: '0.9rem' }}>
                  <div style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.25)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.6rem' }}>Signal Scores</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {[
                      { label: 'Fundamental', score: signalData.fundamental_score, color: '#7ab4e8' },
                      { label: 'Technical',   score: signalData.technical_score,   color: '#4eca99' },
                    ].map(({ label, score, color }) => score != null && (
                      <div key={label}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                          <span style={{ fontSize: '0.68rem', color: 'rgba(232,226,217,0.4)' }}>{label}</span>
                          <span style={{ fontSize: '0.68rem', fontWeight: 600, color, fontFamily: 'monospace' }}>{score}/100</span>
                        </div>
                        <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
                          <div style={{ width: `${score}%`, height: '100%', background: color, borderRadius: 2, opacity: 0.8, transition: 'width 0.3s' }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  {signalData.f_components && (
                    <div style={{ marginTop: '0.6rem', display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                      {Object.entries(signalData.f_components).map(([k, v]) => {
                        const fLabels: Record<string, string> = { valuation: 'Valuation', profitability: 'Profitability', analyst: 'Consensus', consensus: 'Consensus', theme: 'Theme', macro: 'Macro' }
                        return (
                          <span key={k} style={{ fontSize: '0.6rem', padding: '0.15rem 0.4rem', borderRadius: 3, background: 'rgba(122,180,232,0.08)', color: 'rgba(122,180,232,0.6)', border: '1px solid rgba(122,180,232,0.15)' }}>
                            {fLabels[k] ?? k}: {Math.round(v as number)}
                          </span>
                        )
                      })}
                    </div>
                  )}
                  {signalData.t_components && (
                    <div style={{ marginTop: '0.3rem', display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                      {Object.entries(signalData.t_components).map(([k, v]) => {
                        const tLabels: Record<string, string> = { trend: 'Trend', momentum: 'Momentum', rel_strength: 'Rel Strength', volatility: 'Volatility' }
                        return (
                          <span key={k} style={{ fontSize: '0.6rem', padding: '0.15rem 0.4rem', borderRadius: 3, background: 'rgba(78,202,153,0.08)', color: 'rgba(78,202,153,0.6)', border: '1px solid rgba(78,202,153,0.15)' }}>
                            {tLabels[k] ?? k.replace('_', ' ')}: {Math.round(v as number)}
                          </span>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {(() => {
                const trigger = analyseSignalTrigger(
                  signalData.signal,
                  signalData.fundamental_score ?? null,
                  signalData.technical_score   ?? null,
                  signalData.f_components      as Record<string, number> | null,
                  signalData.t_components      as Record<string, number> | null,
                )
                if (!trigger) return null
                const signalColors: Record<string, string> = { buy: '#4eca99', watch: '#e0c97a', hold: 'rgba(232,226,217,0.4)', avoid: '#e87070' }
                const nextColor = signalColors[trigger.nextSignal] ?? 'var(--gold)'
                return (
                  <div style={{ marginBottom: '0.9rem', padding: '0.7rem 0.85rem', background: `${nextColor}08`, borderRadius: 7, border: `1px solid ${nextColor}22` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: '0.62rem', color: 'rgba(232,226,217,0.3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Path to</span>
                      <span style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0.1rem 0.45rem', borderRadius: 3, color: nextColor, background: `${nextColor}18`, border: `1px solid ${nextColor}33` }}>
                        {trigger.nextSignal}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: trigger.explanation.length > 0 ? '0.6rem' : 0 }}>
                      {trigger.fGap != null && (
                        <div style={{ fontSize: '0.68rem', color: 'rgba(122,180,232,0.7)', background: 'rgba(122,180,232,0.08)', padding: '0.2rem 0.5rem', borderRadius: 4, border: '1px solid rgba(122,180,232,0.15)' }}>
                          Fundamental +{trigger.fGap} needed
                        </div>
                      )}
                      {trigger.tGap != null && (
                        <div style={{ fontSize: '0.68rem', color: 'rgba(78,202,153,0.7)', background: 'rgba(78,202,153,0.08)', padding: '0.2rem 0.5rem', borderRadius: 4, border: '1px solid rgba(78,202,153,0.15)' }}>
                          Technical +{trigger.tGap} needed
                        </div>
                      )}
                      {trigger.fGap == null && trigger.tGap == null && (
                        <div style={{ fontSize: '0.68rem', color: 'rgba(232,226,217,0.3)' }}>Signal upgrade pending next price sync</div>
                      )}
                    </div>
                    {trigger.explanation.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        {trigger.explanation.map((e, i) => (
                          <div key={i} style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}>
                            <span style={{ color: 'rgba(232,226,217,0.2)', fontSize: '0.65rem', marginTop: '0.05rem', flexShrink: 0 }}>›</span>
                            <span style={{ fontSize: '0.72rem', color: 'rgba(232,226,217,0.45)', lineHeight: 1.5 }}>{e}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })()}

              {signalData.rationale && (
                <>
                  <div style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.25)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.5rem' }}>Signal Rationale</div>
                  <p style={{ fontSize: '0.8rem', color: 'rgba(232,226,217,0.55)', lineHeight: 1.65, margin: 0 }}>
                    {signalData.rationale}
                  </p>
                  {signalData.rationale_updated_at && (
                    <div style={{ fontSize: '0.62rem', color: 'rgba(232,226,217,0.18)', marginTop: '0.5rem' }}>
                      Updated {relTime(signalData.rationale_updated_at)}
                    </div>
                  )}
                </>
              )}
          </div>
        </details>
      )}

      {/* ── Themes — collapsible ── */}
      {themes.length > 0 && (
        <details style={{ marginBottom: '1rem' }}>
          <summary style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.3)', textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', padding: '0.4rem 0', borderBottom: '1px solid rgba(255,255,255,0.06)', listStyle: 'none', display: 'flex', alignItems: 'center', gap: '0.4rem', userSelect: 'none' }}>
            <span style={{ fontSize: '0.55rem', color: 'rgba(232,226,217,0.2)' }}>▶</span> Active Themes · {themes.length}
          </summary>
          <div style={{ background: 'var(--navy2)', border: '1px solid var(--dash-border)', borderRadius: 10, padding: '1.2rem 1.4rem', marginTop: '0.5rem' }}>
              <div style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.25)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.8rem' }}>
                Active Themes · {themes.length}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {themes.map(row => (
                  <div key={row.theme_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.55rem 0.75rem', background: 'rgba(255,255,255,0.025)', borderRadius: 6, border: '1px solid rgba(255,255,255,0.04)' }}>
                    <div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--cream)', fontWeight: 500 }}>{row.name}</div>
                      <div style={{ fontSize: '0.62rem', color: 'rgba(232,226,217,0.25)', marginTop: '0.1rem' }}>
                        {row.theme_type === 'watchlist' ? '📌 Watchlist' : tfLabel(row.timeframe)} · {row.conviction ?? 0} conviction
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: row.final_weight >= 0.7 ? 'var(--signal-bull)' : row.final_weight >= 0.4 ? 'var(--signal-neut)' : 'rgba(232,226,217,0.35)' }}>
                        {(row.final_weight * 100).toFixed(0)}%
                      </div>
                      <div style={{ fontSize: '0.58rem', color: 'rgba(232,226,217,0.2)' }}>weight</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
        </details>
      )}

      {/* ── Events — collapsible ── */}
      {recentEvents.length > 0 && (
        <details style={{ marginBottom: '1rem' }}>
          <summary style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.3)', textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer', padding: '0.4rem 0', borderBottom: '1px solid rgba(255,255,255,0.06)', listStyle: 'none', display: 'flex', alignItems: 'center', gap: '0.4rem', userSelect: 'none' }}>
            <span style={{ fontSize: '0.55rem', color: 'rgba(232,226,217,0.2)' }}>▶</span> Recent Events · {recentEvents.length}
          </summary>
          <div style={{ background: 'var(--navy2)', border: '1px solid var(--dash-border)', borderRadius: 10, padding: '1.2rem 1.4rem', marginTop: '0.5rem' }}>
              <div style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.25)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.8rem' }}>
                Recent Events · {recentEvents.length}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {recentEvents.map(e => (
                  <div key={e.id} style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: sentimentColor(e.sentiment_score), marginTop: '0.3rem', flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '0.78rem', color: 'var(--cream)', lineHeight: 1.4 }}>{e.ai_summary ?? e.headline}</div>
                      <div style={{ fontSize: '0.62rem', color: 'rgba(232,226,217,0.25)', marginTop: '0.15rem' }}>
                        {relTime(e.published_at)} · impact {e.impact_score ?? '?'}/10
                      </div>
                    </div>
                  </div>
                ))}
              </div>
          </div>
        </details>
      )}
    </div>
  )
}
