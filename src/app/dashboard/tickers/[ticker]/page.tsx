import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/server'
import { createClient } from '@/lib/supabase/server'
import {
  fetchTickerDetails,
  fetchTickerPrice,
  fetchTickerBars,
  formatMarketCap,
  formatVolume,
} from '@/lib/polygon-ticker'
import WatchlistButton from '@/components/dashboard/WatchlistButton'
import ThesisButton    from '@/components/dashboard/ThesisButton'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// ─── Types ────────────────────────────────────────────────────────────────────

type SignalRow = { signal: string | null; score: number | null; rationale: string | null; updated_at: string | null }
type ThemeRow  = { theme_id: string; final_weight: number; themes: { name: string; timeframe: string; conviction: number | null; theme_type: string } }
type EventRow  = { id: string; headline: string; ai_summary: string | null; sentiment_score: number | null; impact_score: number | null; published_at: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function query<T>(q: any): Promise<T | null> {
  const result = await q
  return (result as any).data as T | null
}

function signalColor(s: string | null) {
  return ({ buy: 'var(--signal-bull)', watch: 'var(--signal-neut)', hold: 'rgba(232,226,217,0.4)', avoid: 'var(--signal-bear)' } as Record<string, string>)[s ?? ''] ?? 'rgba(232,226,217,0.4)'
}

function sentimentColor(s: number | null) {
  if (!s) return 'var(--signal-neut)'
  if (s > 0.1) return 'var(--signal-bull)'
  if (s < -0.1) return 'var(--signal-bear)'
  return 'var(--signal-neut)'
}

function tfLabel(tf: string) {
  return ({ '1m': '1M', '3m': '3M', '6m': '6M' } as Record<string, string>)[tf] ?? tf
}

function relTime(iso: string) {
  const hrs = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000)
  if (hrs < 1) return 'just now'
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// Inline SVG sparkline from bar data
function Sparkline({ bars }: { bars: { close: number }[] }) {
  if (bars.length < 2) return null
  const closes = bars.map(b => b.close)
  const min    = Math.min(...closes)
  const max    = Math.max(...closes)
  const range  = max - min || 1
  const w = 200, h = 48, pad = 4
  const pts = closes.map((c, i) => {
    const x = pad + (i / (closes.length - 1)) * (w - 2 * pad)
    const y = pad + (1 - (c - min) / range) * (h - 2 * pad)
    return `${x},${y}`
  }).join(' ')
  const isUp = closes[closes.length - 1] >= closes[0]
  const color = isUp ? '#4eca99' : '#e87070'
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function TickerPage({ params }: { params: { ticker: string } }) {
  const ticker  = params.ticker.toUpperCase()
  const db      = createServiceClient()
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()

  // Parallel fetches
  const [signal, themeRows, events, assetRow, watchlistRow, details, price, bars] = await Promise.all([
    query<SignalRow>(
      db.from('asset_signals').select('signal, score, rationale, updated_at').eq('ticker', ticker).single()
    ),
    query<ThemeRow[]>(
      db.from('theme_tickers')
        .select('theme_id, final_weight, themes!inner(name, timeframe, conviction, theme_type)')
        .eq('ticker', ticker)
        .eq('themes.is_active', true)
        .order('final_weight', { ascending: false })
    ),
    query<EventRow[]>(
      db.from('events')
        .select('id, headline, ai_summary, sentiment_score, impact_score, published_at')
        .contains('tickers', [ticker])
        .eq('ai_processed', true)
        .order('published_at', { ascending: false })
        .limit(5)
    ),
    query<{ ticker: string; name: string; asset_type: string; sector: string | null }>(
      db.from('assets').select('ticker, name, asset_type, sector').eq('ticker', ticker).single()
    ),
    user ? query<{ ticker: string }>(
      db.from('user_watchlist').select('ticker').eq('user_id', user.id).eq('ticker', ticker).single()
    ) : Promise.resolve(null),
    fetchTickerDetails(ticker),
    fetchTickerPrice(ticker),
    fetchTickerBars(ticker, 30),
  ])

  // 404 if completely unknown
  if (!assetRow && !details) return notFound()

  const name        = details?.name ?? assetRow?.name ?? ticker
  const isWatched   = !!watchlistRow
  const themes      = themeRows ?? []
  const recentEvents = events ?? []
  const changeUp    = (price?.change_pct ?? 0) >= 0

  return (
    <div>
      {/* Back link */}
      <Link href="/dashboard/assets" style={{ fontSize: '0.75rem', color: 'rgba(200,169,110,0.5)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.3rem', marginBottom: '1.5rem' }}>
        ← Asset Screener
      </Link>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', marginBottom: '0.3rem' }}>
            <h1 style={{ color: 'var(--cream)', fontFamily: 'monospace', fontSize: '2rem', fontWeight: 700, margin: 0 }}>
              {ticker}
            </h1>
            {signal?.signal && (
              <span style={{
                fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
                color: signalColor(signal.signal),
                background: `${signalColor(signal.signal)}18`,
                padding: '0.2rem 0.55rem', borderRadius: 4,
              }}>
                {signal.signal}
              </span>
            )}
          </div>
          <div style={{ color: 'rgba(232,226,217,0.45)', fontSize: '0.9rem' }}>{name}</div>
          {(details?.sector || assetRow?.sector) && (
            <div style={{ fontSize: '0.72rem', color: 'rgba(232,226,217,0.25)', marginTop: '0.2rem' }}>
              {details?.sector ?? assetRow?.sector} · {details?.exchange ?? assetRow?.asset_type}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <ThesisButton ticker={ticker} />
          {user && <WatchlistButton ticker={ticker} initialWatched={isWatched} />}
        </div>
      </div>

      {/* ── Price row ────────────────────────────────────────────────────── */}
      {price?.close && (
        <div style={{
          background: 'var(--navy2)', border: '1px solid var(--dash-border)',
          borderRadius: 10, padding: '1.2rem 1.5rem', marginBottom: '1.5rem',
          display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '2rem', alignItems: 'center',
        }}>
          <div>
            <div style={{ fontSize: '2.2rem', fontWeight: 700, color: 'var(--cream)', lineHeight: 1, fontFamily: 'monospace' }}>
              ${price.close.toFixed(2)}
            </div>
            <div style={{ fontSize: '0.85rem', color: changeUp ? 'var(--signal-bull)' : 'var(--signal-bear)', marginTop: '0.2rem', fontWeight: 500 }}>
              {changeUp ? '+' : ''}{price.change?.toFixed(2)} ({changeUp ? '+' : ''}{price.change_pct?.toFixed(2)}%)
            </div>
            {price.date && (
              <div style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.2)', marginTop: '0.2rem' }}>Prev close · {price.date}</div>
            )}
          </div>

          {/* Sparkline */}
          {bars.length > 2 && (
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <Sparkline bars={bars} />
              <span style={{ fontSize: '0.62rem', color: 'rgba(232,226,217,0.2)', marginLeft: '0.5rem' }}>30d</span>
            </div>
          )}

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem 1.5rem' }}>
            {[
              ['Open',   `$${price.open?.toFixed(2) ?? '—'}`],
              ['High',   `$${price.high?.toFixed(2) ?? '—'}`],
              ['Low',    `$${price.low?.toFixed(2)  ?? '—'}`],
              ['Volume', formatVolume(price.volume)],
              ['Mkt Cap', formatMarketCap(details?.market_cap ?? null)],
              ['Employees', details?.employees ? details.employees.toLocaleString() : '—'],
            ].map(([label, val]) => (
              <div key={label}>
                <div style={{ fontSize: '0.6rem', color: 'rgba(232,226,217,0.22)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
                <div style={{ fontSize: '0.82rem', color: 'var(--cream)', fontFamily: 'monospace' }}>{val}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        {/* Left column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          {/* Description */}
          {details?.description && (
            <div style={{ background: 'var(--navy2)', border: '1px solid var(--dash-border)', borderRadius: 10, padding: '1.2rem 1.4rem' }}>
              <div style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.25)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.6rem' }}>About</div>
              <p style={{ fontSize: '0.8rem', color: 'rgba(232,226,217,0.55)', lineHeight: 1.7, margin: 0 }}>
                {details.description.slice(0, 500)}{details.description.length > 500 ? '…' : ''}
              </p>
              {details.homepage && (
                <a href={details.homepage} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: '0.72rem', color: 'var(--gold)', opacity: 0.6, display: 'inline-block', marginTop: '0.6rem' }}>
                  {details.homepage.replace(/^https?:\/\//, '')} ↗
                </a>
              )}
            </div>
          )}

          {/* Signal rationale */}
          {signal?.rationale && (
            <div style={{ background: 'var(--navy2)', border: '1px solid var(--dash-border)', borderRadius: 10, padding: '1.2rem 1.4rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                <div style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.25)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Signal Rationale</div>
                {signal.score !== null && (
                  <span style={{ fontSize: '0.72rem', color: signalColor(signal.signal), fontWeight: 600 }}>
                    {signal.score}/100
                  </span>
                )}
              </div>
              <p style={{ fontSize: '0.8rem', color: 'rgba(232,226,217,0.55)', lineHeight: 1.65, margin: 0 }}>
                {signal.rationale}
              </p>
              {signal.updated_at && (
                <div style={{ fontSize: '0.62rem', color: 'rgba(232,226,217,0.18)', marginTop: '0.5rem' }}>
                  Updated {relTime(signal.updated_at)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          {/* Themes */}
          {themes.length > 0 && (
            <div style={{ background: 'var(--navy2)', border: '1px solid var(--dash-border)', borderRadius: 10, padding: '1.2rem 1.4rem' }}>
              <div style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.25)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.8rem' }}>
                Active Themes · {themes.length}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {themes.map(row => (
                  <div key={row.theme_id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '0.55rem 0.75rem',
                    background: 'rgba(255,255,255,0.025)', borderRadius: 6,
                    border: '1px solid rgba(255,255,255,0.04)',
                  }}>
                    <div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--cream)', fontWeight: 500 }}>{row.themes.name}</div>
                      <div style={{ fontSize: '0.62rem', color: 'rgba(232,226,217,0.25)', marginTop: '0.1rem' }}>
                        {row.themes.theme_type === 'watchlist' ? '📌 Watchlist' : tfLabel(row.themes.timeframe)} · {row.themes.conviction ?? 0} conviction
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
          )}

          {/* Recent events */}
          {recentEvents.length > 0 && (
            <div style={{ background: 'var(--navy2)', border: '1px solid var(--dash-border)', borderRadius: 10, padding: '1.2rem 1.4rem' }}>
              <div style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.25)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.8rem' }}>
                Recent Events · {recentEvents.length}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {recentEvents.map(e => (
                  <div key={e.id} style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: sentimentColor(e.sentiment_score), marginTop: '0.3rem', flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '0.78rem', color: 'var(--cream)', lineHeight: 1.4 }}>
                        {e.ai_summary ?? e.headline}
                      </div>
                      <div style={{ fontSize: '0.62rem', color: 'rgba(232,226,217,0.25)', marginTop: '0.15rem' }}>
                        {relTime(e.published_at)} · impact {e.impact_score ?? '?'}/10
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
