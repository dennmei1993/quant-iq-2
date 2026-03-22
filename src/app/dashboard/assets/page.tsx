'use client'
// src/app/dashboard/assets/page.tsx
import { useEffect, useState } from 'react'
import styles from './assets.module.css'
import panelStyles from '@/components/dashboard/ui.module.css'

interface Asset {
  id: string
  ticker: string
  name: string
  asset_type: string
  sector: string | null
  latest_signal: {
    signal: 'buy' | 'watch' | 'hold' | 'avoid'
    score: number | null
    rationale: string | null
    scored_at: string
  } | null
}

const TYPE_FILTERS = ['all', 'stock', 'etf', 'crypto', 'commodity'] as const
type Filter = typeof TYPE_FILTERS[number]

// Mock spark data until we wire up price history
const MOCK_SPARK: Record<string, number[]> = {
  NVDA: [5,6,7,8,7,9,11], LMT: [7,7,8,8,9,9,10], GLD: [6,7,6,8,8,9,9],
  AMAT: [5,5,6,7,7,8,9],  BTC: [9,7,8,6,7,8,8],  FSLR:[5,5,6,6,7,7,8],
  ICLN: [5,6,6,6,7,7,7],  ETH: [8,6,7,5,6,7,7],  XOM: [9,8,8,7,7,6,6],
  XLE:  [8,8,7,7,6,6,6],  SPY: [6,7,7,7,7,8,8],  QQQ: [6,7,8,7,8,8,9],
}

function Sparkline({ vals, up }: { vals: number[]; up: boolean }) {
  const max = Math.max(...vals)
  const color = up ? '#4eca99' : '#e87070'
  return (
    <span className={styles.spark}>
      {vals.map((v, i) => (
        <span key={i} className={styles.sparkBar}
          style={{ height: `${Math.round(v / max * 16) + 2}px`, background: color }} />
      ))}
    </span>
  )
}

export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')

  useEffect(() => {
    fetch('/api/assets')
      .then(r => r.json())
      .then(d => { setAssets(d.assets ?? []); setLoading(false) })
  }, [])

  const filtered = filter === 'all' ? assets : assets.filter(a => a.asset_type === filter)

  const signalCss: Record<string, string> = {
    buy: styles.sigBuy, watch: styles.sigWatch, hold: styles.sigHold, avoid: styles.sigAvoid,
  }
  const typeCss: Record<string, string> = {
    stock: styles.typeStock, etf: styles.typeEtf, crypto: styles.typeCrypto, commodity: styles.typeCmdty,
  }

  return (
    <div>
      {/* Filter bar */}
      <div className={styles.filterBar}>
        {TYPE_FILTERS.map(f => (
          <button key={f} className={`${styles.filterBtn} ${filter === f ? styles.active : ''}`}
            onClick={() => setFilter(f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <span className={styles.filterNote}>Sorted by signal score · {filtered.length} assets</span>
      </div>

      <div className={panelStyles.panel}>
        {loading && <div className={panelStyles.empty}>Loading assets…</div>}
        {!loading && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Name</th>
                <th>Type</th>
                <th>Sector</th>
                <th>Signal</th>
                <th>Score</th>
                <th>7d</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(a => {
                const sig = a.latest_signal
                const score = sig?.score ?? 0
                const isUp = score >= 0
                const spark = MOCK_SPARK[a.ticker] ?? [5,5,5,5,5,5,5]
                return (
                  <tr key={a.id}>
                    <td><span className={styles.ticker}>{a.ticker}</span></td>
                    <td className={styles.name}>{a.name}</td>
                    <td><span className={`${styles.typeBadge} ${typeCss[a.asset_type] ?? ''}`}>{a.asset_type.toUpperCase()}</span></td>
                    <td className={styles.sector}>{a.sector ?? '—'}</td>
                    <td>
                      {sig ? (
                        <span className={`${styles.signal} ${signalCss[sig.signal] ?? ''}`}>
                          {sig.signal.toUpperCase()}
                        </span>
                      ) : <span className={styles.noSig}>—</span>}
                    </td>
                    <td className={styles.score} style={{ color: isUp ? '#4eca99' : '#e87070' }}>
                      {sig ? `${score >= 0 ? '+' : ''}${score.toFixed(2)}` : '—'}
                    </td>
                    <td><Sparkline vals={spark} up={isUp} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
