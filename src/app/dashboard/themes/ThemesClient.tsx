'use client'
// src/app/dashboard/themes/ThemesClient.tsx
// Handles timeframe filter, sort, expand/collapse, asset pipeline

import { useState, useMemo } from 'react'
import Link from 'next/link'
import type { Theme, Regime, SignalMap, TickerWeight } from './page'
import ThemeTickerManager from '@/components/dashboard/ThemeTickerManager'
import styles from './themes.module.css'

// ── Constants ──────────────────────────────────────────────────────────────────

const MOMENTUM_LABEL: Record<string, string> = {
  strong_up:    '↑↑ Strong',
  moderate_up:  '↑ Moderate',
  neutral:      '→ Neutral',
  moderate_down:'↓ Moderate',
  strong_down:  '↓↓ Strong',
}

const MOMENTUM_COLOR: Record<string, string> = {
  strong_up:    'var(--green)',
  moderate_up:  '#7affb0',
  neutral:      'var(--amber)',
  moderate_down:'#ff8a9a',
  strong_down:  'var(--red)',
}

const TF_LABEL: Record<string, string> = {
  '1m': '1 month',
  '3m': '3 months',
  '6m': '6 months',
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function relTime(iso: string | null): string {
  if (!iso) return ''
  const hrs = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000)
  if (hrs < 1)  return 'just now'
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function momentumTagClass(m: string | null): string {
  switch (m) {
    case 'strong_up':
    case 'moderate_up':   return styles.tagBull
    case 'strong_down':
    case 'moderate_down': return styles.tagBear
    default:              return styles.tagNeut
  }
}

function signalClass(signal: string | null): string {
  switch (signal) {
    case 'buy':   return styles.sigBuy
    case 'watch': return styles.sigWatch
    case 'avoid': return styles.sigAvoid
    default:      return styles.sigHold
  }
}

function signalLabel(signal: string | null): string {
  return (signal ?? 'hold').toUpperCase()
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function RegimeBar({ regime }: { regime: Regime | null }) {
  if (!regime) return null
  const bias    = regime.risk_bias
  const biasCls = bias === 'risk-off' ? styles.bearish : bias === 'risk-on' ? '' : styles.neutral

  return (
    <div className={`${styles.regimeCtx} ${biasCls}`}>
      <div className={styles.regimeMain}>
        <div className={styles.regimeLabel}>Current regime</div>
        <div className={styles.regimeVal}>{regime.label}</div>
        <div className={styles.regimeBias}>
          {bias === 'risk-off'
            ? 'Favour defensive, safe-haven, energy. Underweight growth tech.'
            : bias === 'risk-on'
            ? 'Favour growth, technology, cyclicals. Reduce cash.'
            : `Style bias: ${regime.style_bias ?? 'balanced'}`}
        </div>
      </div>

      {(regime.favoured_sectors?.length || regime.avoid_sectors?.length) && (
        <div className={styles.regimeMeta}>
          {regime.favoured_sectors && regime.favoured_sectors.length > 0 && (
            <div>
              <div className={styles.regimeMetaLabel}>Favour</div>
              {regime.favoured_sectors.slice(0, 4).map(s => (
                <span key={s} className={`${styles.sectorTag} ${styles.sectorFavour}`}>{s}</span>
              ))}
            </div>
          )}
          {regime.avoid_sectors && regime.avoid_sectors.length > 0 && (
            <div>
              <div className={styles.regimeMetaLabel}>Avoid</div>
              {regime.avoid_sectors.slice(0, 3).map(s => (
                <span key={s} className={`${styles.sectorTag} ${styles.sectorAvoid}`}>{s}</span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className={styles.regimeConv}>
        <div className={styles.regimeConvNum}>{regime.confidence}%</div>
        <div className={styles.regimeConvBar}>
          <div className={styles.regimeConvFill} style={{ width: `${regime.confidence}%` }} />
        </div>
        <div className={styles.regimeConvLabel}>Confidence</div>
      </div>
    </div>
  )
}

function AssetPipeline({ tickers, signalMap }: { tickers: TickerWeight[]; signalMap: SignalMap }) {
  if (tickers.length === 0) {
    return <p className={styles.empty}>No candidate assets linked to this theme yet.</p>
  }

  return (
    <div className={styles.assetGrid}>
      {tickers.slice(0, 8).map(tw => {
        const sig = signalMap[tw.ticker]
        const wt  = tw.final_weight != null ? Math.round(tw.final_weight) : null
        return (
          <Link key={tw.ticker} href={`/dashboard/tickers/${tw.ticker}`} className={styles.assetPill} style={{ textDecoration: 'none', display: 'block' }} onClick={e => e.stopPropagation()}>
            <div className={styles.assetPillTicker}>{tw.ticker}</div>
            {tw.asset_type && (
              <div className={styles.assetPillType}>{tw.asset_type}</div>
            )}
            {wt != null && (
              <div className={styles.assetPillWeight}>Weight {wt}%</div>
            )}
            {sig && (
              <span className={signalClass(sig.signal)}>{signalLabel(sig.signal)}</span>
            )}
          </Link>
        )
      })}
    </div>
  )
}

function ThemeCard({
  theme, signalMap, expanded, onToggle, isWatchlist,
}: {
  theme:      Theme
  signalMap:  SignalMap
  expanded:   boolean
  onToggle:   () => void
  isWatchlist: boolean
}) {
  const mColor  = MOMENTUM_COLOR[theme.momentum ?? 'neutral'] ?? 'var(--amber)'
  const conv    = theme.conviction ?? 0
  const cardCls = [
    styles.themeCard,
    isWatchlist ? styles.themeCardWatchlist : '',
    expanded && !isWatchlist ? styles.themeCardExpanded : '',
    expanded && isWatchlist  ? styles.themeCardWatchlistExpanded : '',
  ].filter(Boolean).join(' ')

  return (
    <div className={cardCls}>
      <div className={styles.themeCardHeader} onClick={onToggle}>
        <div className={styles.themeCardLeft}>
          <div className={styles.themeTags}>
            {isWatchlist
              ? <span className={`${styles.tag} ${styles.tagWatch}`}>Pinned</span>
              : <span className={`${styles.tag} ${styles.tagTf}`}>{TF_LABEL[theme.timeframe] ?? theme.timeframe}</span>
            }
            {theme.label && theme.label !== 'WATCHLIST' && (
              <span className={`${styles.tag} ${momentumTagClass(theme.momentum)}`}>
                {theme.label}
              </span>
            )}
            {theme.momentum && !isWatchlist && (
              <span className={`${styles.tag} ${momentumTagClass(theme.momentum)}`}>
                {MOMENTUM_LABEL[theme.momentum]}
              </span>
            )}
          </div>
          <div className={styles.themeName}>{theme.name}</div>
          {expanded && theme.brief && (
            <div className={styles.themeBrief}>{theme.brief}</div>
          )}
          {expanded && (theme.anchor_reason || theme.anchored_since) && (
            <div className={styles.themeAnchor}>
              {theme.anchor_reason && `⚓ ${theme.anchor_reason}`}
              {theme.anchored_since && ` · anchored ${relTime(theme.anchored_since)}`}
            </div>
          )}
        </div>

        <div className={styles.themeCardRight}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div>
              <div
                className={styles.convNum}
                style={{ color: isWatchlist ? 'var(--blue)' : mColor }}
              >
                {conv}
              </div>
              <div className={styles.convLabel}>Conviction</div>
            </div>
            <div>
              <div className={styles.convBarBg}>
                <div
                  className={styles.convBarFill}
                  style={{ width: `${conv}%`, background: isWatchlist ? 'var(--blue)' : mColor }}
                />
              </div>
            </div>
          </div>
          {!isWatchlist && theme.momentum && (
            <div className={styles.momentumVal} style={{ color: mColor }}>
              {MOMENTUM_LABEL[theme.momentum]}
            </div>
          )}
        </div>
      </div>

      {expanded && (
        <div className={styles.pipeline} style={isWatchlist ? { background: 'rgba(90,154,245,0.02)' } : undefined}>
          <div className={styles.pipelineHdr}>
            Candidate assets · ranked by theme weight
          </div>
          {isWatchlist ? (
            // Watchlist themes: use ThemeTickerManager for full add/remove/reweight UI
            <ThemeTickerManager
              themeId={theme.id}
              initialTickers={theme.ticker_weights}
            />
          ) : (
            // Dynamic themes: read-only asset pipeline with signal badges
            <>
              <AssetPipeline tickers={theme.ticker_weights} signalMap={signalMap} />
              <div className={styles.pipelineActions}>
                <button className={`${styles.pipelineBtn} ${styles.pipeBtnPrimary}`}>
                  + Add all BUY to watchlist
                </button>
                <Link
                  href="/dashboard/assets"
                  className={`${styles.pipelineBtn} ${styles.pipeBtnSecondary}`}
                >
                  View in screener →
                </Link>
                {theme.anchored_since && (
                  <span className={styles.anchorNote}>
                    anchored {relTime(theme.anchored_since)}
                    {theme.anchor_reason && ` · ${theme.anchor_reason}`}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main client component ──────────────────────────────────────────────────────

interface Props {
  themes:    Theme[]
  regime:    Regime | null
  signalMap: SignalMap
}

export default function ThemesClient({ themes, regime, signalMap }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(
    themes.find(t => t.theme_type === 'dynamic')?.id ?? null
  )
  const [tfFilter, setTfFilter] = useState<string>('all')
  const [sortBy,   setSortBy]   = useState<'conviction' | 'timeframe'>('conviction')

  const dynamicThemes   = useMemo(() =>
    themes
      .filter(t => t.theme_type === 'dynamic')
      .filter(t => tfFilter === 'all' || t.timeframe === tfFilter)
      .sort((a, b) =>
        sortBy === 'conviction'
          ? (b.conviction ?? 0) - (a.conviction ?? 0)
          : a.timeframe.localeCompare(b.timeframe)
      ),
    [themes, tfFilter, sortBy]
  )

  const watchlistThemes = useMemo(() =>
    themes.filter(t => t.theme_type === 'watchlist'),
    [themes]
  )

  const toggle = (id: string) =>
    setExpandedId(prev => prev === id ? null : id)

  const updatedAt = themes[0]
    ? relTime(themes[0].anchored_since ?? themes[0].expires_at)
    : ''

  return (
    <div className={styles.page}>

      {/* Controls */}
      <div className={styles.controls}>
        <div className={styles.controlsLeft}>
          <div className={styles.tfToggle}>
            {['all', '1m', '3m', '6m'].map(tf => (
              <button
                key={tf}
                className={`${styles.tfBtn} ${tfFilter === tf ? styles.tfBtnActive : ''}`}
                onClick={() => setTfFilter(tf)}
              >
                {tf}
              </button>
            ))}
          </div>
          <button
            className={styles.sortBtn}
            onClick={() => setSortBy(s => s === 'conviction' ? 'timeframe' : 'conviction')}
          >
            Sort: {sortBy} ↓
          </button>
        </div>
        <div className={styles.controlsRight}>
          {themes.length} themes{updatedAt ? ` · updated ${updatedAt}` : ''}
        </div>
      </div>

      {/* Regime context */}
      <RegimeBar regime={regime} />

      {/* Dynamic themes */}
      <div>
        <div className={styles.sectionHdr}>
          <span className={styles.sectionTitle}>Market themes</span>
          <span className={styles.sectionCount}>{dynamicThemes.length} active</span>
        </div>
        {dynamicThemes.length === 0 ? (
          <div className={styles.empty}>
            {tfFilter !== 'all'
              ? `No ${tfFilter} themes — try a different timeframe filter`
              : 'No market themes yet — run the themes cron to generate'}
          </div>
        ) : (
          dynamicThemes.map(t => (
            <ThemeCard
              key={t.id}
              theme={t}
              signalMap={signalMap}
              expanded={expandedId === t.id}
              onToggle={() => toggle(t.id)}
              isWatchlist={false}
            />
          ))
        )}
      </div>

      {/* Watchlist themes */}
      {watchlistThemes.length > 0 && (
        <div>
          <div className={styles.sectionHdr}>
            <span className={styles.sectionTitle}>Watchlist themes</span>
            <span className={styles.sectionCount}>{watchlistThemes.length} active</span>
          </div>
          {watchlistThemes.map(t => (
            <ThemeCard
              key={t.id}
              theme={t}
              signalMap={signalMap}
              expanded={expandedId === t.id}
              onToggle={() => toggle(t.id)}
              isWatchlist={true}
            />
          ))}
        </div>
      )}

    </div>
  )
}
