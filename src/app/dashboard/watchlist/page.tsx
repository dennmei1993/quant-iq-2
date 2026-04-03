// src/app/dashboard/watchlist/page.tsx
import Link from 'next/link'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import RemoveWatchlistButton from '@/components/dashboard/RemoveWatchlistButton'

export const dynamic  = 'force-dynamic'
export const revalidate = 0

// ─── Types ────────────────────────────────────────────────────────────────────

type WatchlistRow = { id: string; ticker: string; added_at: string }
type SignalRow    = { ticker: string; signal: string | null; score: number | null; price_usd: number | null; change_pct: number | null; rationale: string | null }
type ThemeTicker = { ticker: string; theme_id: string; final_weight: number }
type ThemeRow    = { id: string; name: string; timeframe: string; theme_type: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function query<T>(q: any): Promise<T | null> {
  const result = await q
  return (result as any).data as T | null
}

function signalColor(s: string | null) {
  return ({
    buy:   'var(--signal-bull)',
    watch: 'var(--signal-neut)',
    hold:  'rgba(232,226,217,0.35)',
    avoid: 'var(--signal-bear)',
  } as Record<string, string>)[s ?? ''] ?? 'rgba(232,226,217,0.35)'
}

function changeColor(pct: number | null) {
  if (pct == null) return 'rgba(232,226,217,0.35)'
  return pct >= 0 ? 'var(--signal-bull)' : 'var(--signal-bear)'
}

function relTime(iso: string) {
  const hrs  = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000)
  if (hrs < 1)  return 'just now'
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function WatchlistPage() {
  const db = createServiceClient()

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
  } catch {}

  if (!userId) redirect('/auth/login')

  // ── Fetch watchlist ───────────────────────────────────────────────────────
  const watchlist = await query<WatchlistRow[]>(
    db.from('user_watchlist')
      .select('id, ticker, added_at')
      .eq('user_id', userId)
      .order('added_at', { ascending: false })
  ) ?? []

  if (watchlist.length === 0) {
    return (
      <div>
        <h1 style={{ color: 'var(--cream)', fontFamily: 'serif', fontSize: '1.8rem', marginBottom: '0.4rem' }}>
          Watchlist
        </h1>
        <p style={{ color: 'rgba(232,226,217,0.35)', fontSize: '0.82rem', marginBottom: '2rem' }}>
          Track tickers you're watching — click any ticker page to add
        </p>
        <div style={{
          background: 'var(--navy2)', border: '1px solid var(--dash-border)',
          borderRadius: 10, padding: '3rem', textAlign: 'center',
        }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.8rem', opacity: 0.3 }}>☆</div>
          <div style={{ color: 'rgba(232,226,217,0.3)', fontSize: '0.88rem' }}>Your watchlist is empty</div>
          <div style={{ color: 'rgba(232,226,217,0.18)', fontSize: '0.75rem', marginTop: '0.4rem' }}>
            Browse{' '}
            <Link href="/dashboard/assets" style={{ color: 'var(--gold)', opacity: 0.6, textDecoration: 'none' }}>
              Asset Screener
            </Link>{' '}or{' '}
            <Link href="/dashboard/themes" style={{ color: 'var(--gold)', opacity: 0.6, textDecoration: 'none' }}>
              Themes
            </Link>{' '}and click a ticker to add it
          </div>
        </div>
      </div>
    )
  }

  const tickers = watchlist.map(w => w.ticker)

  // ── Parallel data fetches ─────────────────────────────────────────────────
  const [signals, activeThemes, themeTickerRows] = await Promise.all([
    query<SignalRow[]>(
      db.from('asset_signals')
        .select('ticker, signal, score, price_usd, change_pct, rationale')
        .in('ticker', tickers)
    ),
    query<ThemeRow[]>(
      db.from('themes')
        .select('id, name, timeframe, theme_type')
        .eq('is_active', true)
    ),
    query<ThemeTicker[]>(
      db.from('theme_tickers')
        .select('ticker, theme_id, final_weight')
        .in('ticker', tickers)
        .order('final_weight', { ascending: false })
    ),
  ])

  // ── Build lookup maps ─────────────────────────────────────────────────────
  const signalMap = new Map((signals ?? []).map(s => [s.ticker, s]))
  const themeMap  = new Map((activeThemes ?? []).map(t => [t.id, t]))
  const activeIds = new Set((activeThemes ?? []).map(t => t.id))

  // ── Auto-sync tickers missing price data (fire and forget) ────────────────
  const needsSync = tickers.filter(t => {
    const s = signalMap.get(t)
    return !s?.price_usd || !s?.signal
  })
  if (needsSync.length > 0) {
    const base    = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.betteroption.com.au'
    const syncUrl = `${base}/api/admin/sync-prices?tickers=${needsSync.join(',')}`
    fetch(syncUrl, {
      method:  'POST',
      headers: { 'x-admin-secret': process.env.ADMIN_SECRET ?? '' },
    }).catch(() => {})
  }

  // ── Group themes by ticker ────────────────────────────────────────────────
  type ThemeEntry = { id: string; name: string; timeframe: string; theme_type: string; final_weight: number }
  const themesByTicker = new Map<string, ThemeEntry[]>()
  for (const row of themeTickerRows ?? []) {
    if (!activeIds.has(row.theme_id)) continue
    const theme = themeMap.get(row.theme_id)
    if (!theme) continue
    if (!themesByTicker.has(row.ticker)) themesByTicker.set(row.ticker, [])
    themesByTicker.get(row.ticker)!.push({
      id:           theme.id,
      name:         theme.name,
      timeframe:    theme.timeframe,
      theme_type:   theme.theme_type,
      final_weight: row.final_weight,
    })
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ color: 'var(--cream)', fontFamily: 'serif', fontSize: '1.8rem', marginBottom: '0.3rem' }}>
            Watchlist
          </h1>
          <p style={{ color: 'rgba(232,226,217,0.35)', fontSize: '0.82rem', margin: 0 }}>
            {watchlist.length} ticker{watchlist.length !== 1 ? 's' : ''} tracked
          </p>
        </div>
        <Link href="/dashboard/assets" style={{
          fontSize: '0.75rem', color: 'rgba(200,169,110,0.5)',
          textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
        }}>
          + Add tickers via Screener
        </Link>
      </div>

      {/* Table */}
      <div style={{ background: 'var(--navy2)', border: '1px solid var(--dash-border)', borderRadius: 10, overflow: 'hidden' }}>

        {/* Header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '100px 90px 80px 60px 1fr 180px 44px',
          gap: '0.5rem', padding: '0.6rem 1.2rem',
          background: 'rgba(255,255,255,0.02)',
          borderBottom: '1px solid var(--dash-border)',
        }}>
          {['Ticker', 'Price', 'Change', 'Signal', 'Rationale', 'Active Themes', ''].map(h => (
            <div key={h} style={{ fontSize: '0.6rem', color: 'rgba(232,226,217,0.22)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              {h}
            </div>
          ))}
        </div>

        {/* Rows */}
        {watchlist.map((row, i) => {
          const sig    = signalMap.get(row.ticker)
          const themes = themesByTicker.get(row.ticker) ?? []
          const isLast = i === watchlist.length - 1

          return (
            <div key={row.id} style={{
              display: 'grid',
              gridTemplateColumns: '100px 90px 80px 60px 1fr 180px 44px',
              gap: '0.5rem', padding: '0.85rem 1.2rem',
              alignItems: 'center',
              borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,0.04)',
            }}>

              {/* Ticker */}
              <Link href={`/dashboard/tickers/${row.ticker}`} style={{ textDecoration: 'none' }}>
                <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--gold)', fontFamily: 'monospace' }}>
                  {row.ticker}
                </div>
                <div style={{ fontSize: '0.6rem', color: 'rgba(232,226,217,0.2)', marginTop: '0.1rem' }}>
                  added {relTime(row.added_at)}
                </div>
              </Link>

              {/* Price */}
              <div style={{ fontSize: '0.85rem', color: 'var(--cream)', fontFamily: 'monospace' }}>
                {sig?.price_usd != null ? `$${Number(sig.price_usd).toFixed(2)}` : '—'}
              </div>

              {/* Change% */}
              <div style={{ fontSize: '0.82rem', fontWeight: 500, color: changeColor(sig?.change_pct ?? null) }}>
                {sig?.change_pct != null
                  ? `${sig.change_pct >= 0 ? '+' : ''}${Number(sig.change_pct).toFixed(2)}%`
                  : '—'}
              </div>

              {/* Signal + score */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                {sig?.signal && (
                  <span style={{
                    fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase',
                    color: signalColor(sig.signal), background: `${signalColor(sig.signal)}18`,
                    padding: '0.1rem 0.35rem', borderRadius: 3, width: 'fit-content',
                  }}>
                    {sig.signal}
                  </span>
                )}
                {sig?.score != null && (
                  <div style={{ fontSize: '0.68rem', color: 'rgba(232,226,217,0.3)', fontFamily: 'monospace' }}>
                    {sig.score}/100
                  </div>
                )}
                {!sig?.signal && (
                  <span style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.18)' }}>—</span>
                )}
              </div>

              {/* Rationale */}
              <div style={{
                fontSize: '0.72rem', color: 'rgba(232,226,217,0.4)', lineHeight: 1.4,
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
              } as React.CSSProperties}>
                {sig?.rationale ?? '—'}
              </div>

              {/* Active themes */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                {themes.length === 0 ? (
                  <span style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.18)' }}>—</span>
                ) : (
                  <>
                    {themes.slice(0, 3).map(t => (
                      <span key={t.id} style={{
                        fontSize: '0.6rem', fontWeight: 500,
                        background: t.theme_type === 'watchlist' ? 'rgba(122,180,232,0.1)' : 'rgba(200,169,110,0.08)',
                        color:      t.theme_type === 'watchlist' ? '#7ab4e8' : 'var(--gold)',
                        padding: '0.15rem 0.4rem', borderRadius: 3, whiteSpace: 'nowrap',
                      }}>
                        {t.name.length > 18 ? t.name.slice(0, 18) + '…' : t.name}
                      </span>
                    ))}
                    {themes.length > 3 && (
                      <span style={{ fontSize: '0.6rem', color: 'rgba(232,226,217,0.2)' }}>
                        +{themes.length - 3}
                      </span>
                    )}
                  </>
                )}
              </div>

              {/* Remove */}
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <RemoveWatchlistButton ticker={row.ticker} />
              </div>

            </div>
          )
        })}
      </div>
    </div>
  )
}
