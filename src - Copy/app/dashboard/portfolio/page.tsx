'use client'
// src/app/dashboard/portfolio/page.tsx
import { useEffect, useState } from 'react'
import styles from './portfolio.module.css'
import panelStyles from '@/components/dashboard/ui.module.css'

interface Holding {
  id: string
  ticker: string
  name: string | null
  asset_type: string | null
  quantity: number | null
  avg_cost: number | null
}

const IMPACT_MOCK: Record<string, { label: string; css: string }> = {
  NVDA:  { label: '↑ Boosted — H300 chip news',   css: 'pos' },
  SPY:   { label: '⚡ Mild pressure — rate hold',  css: 'med' },
  XOM:   { label: '⚠ Review — OPEC+ signal',       css: 'high' },
  BTC:   { label: '⚡ Rate sensitivity',            css: 'med' },
  GLD:   { label: '↑ Benefiting — inflation hedge', css: 'pos' },
  LMT:   { label: '↑ DoD budget tailwind',         css: 'pos' },
  QQQ:   { label: '⚡ Mixed — tech vs rates',       css: 'med' },
  TLT:   { label: '↑ Rate hold positive',          css: 'pos' },
}

export default function PortfolioPage() {
  const [holdings, setHoldings] = useState<Holding[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [newTicker, setNewTicker] = useState('')
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState('stock')
  const [newQty, setNewQty] = useState('')
  const [newCost, setNewCost] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [portfolioId, setPortfolioId] = useState<string | null>(null)

  useEffect(() => { loadPortfolio() }, [])

  async function loadPortfolio() {
    setLoading(true)
    const res = await fetch('/api/portfolio')
    const data = await res.json()
    setHoldings(data.holdings ?? [])
    setPortfolioId(data.portfolio?.id ?? null)
    setLoading(false)
  }

  async function addHolding(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const res = await fetch('/api/portfolio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticker: newTicker.toUpperCase(),
        name: newName || undefined,
        asset_type: newType,
        quantity: newQty ? parseFloat(newQty) : undefined,
        avg_cost: newCost ? parseFloat(newCost) : undefined,
      }),
    })
    if (res.ok) {
      setNewTicker(''); setNewName(''); setNewQty(''); setNewCost('')
      setAdding(false)
      loadPortfolio()
    } else {
      const d = await res.json()
      setError(d.error ?? 'Failed to add holding')
    }
  }

  async function removeHolding(id: string) {
    await fetch(`/api/portfolio?holding_id=${id}`, { method: 'DELETE' })
    loadPortfolio()
  }

  async function generateMemo() {
    if (!portfolioId) return
    const res = await fetch('/api/advisory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ portfolio_id: portfolioId }),
    })
    const data = await res.json()
    if (data.memo) alert(data.memo.memo_text)
  }

  return (
    <div>
      {/* KPI strip */}
      <div className={styles.kpiRow}>
        <div className={panelStyles.panel}>
          <div className={panelStyles.panelTitle}>Holdings</div>
          <div className={styles.kpiVal}>{holdings.length}</div>
          <div className={styles.kpiSub}>Tracked positions</div>
        </div>
        <div className={panelStyles.panel}>
          <div className={panelStyles.panelTitle}>Event Exposure</div>
          <div className={styles.kpiVal}>68<span className={styles.kpiOf}>/100</span></div>
          <div className={styles.kpiSub}>Moderate risk score</div>
        </div>
        <div className={panelStyles.panel} style={{ cursor: 'pointer' }} onClick={generateMemo}>
          <div className={panelStyles.panelTitle}>AI Advisory Memo</div>
          <div className={styles.kpiVal} style={{ fontSize: '1rem', marginTop: '0.4rem' }}>Generate →</div>
          <div className={styles.kpiSub}>Powered by Claude AI</div>
        </div>
      </div>

      {/* Holdings table */}
      <div className={panelStyles.panel}>
        <div className={panelStyles.panelTitle}>
          Holdings · Event Impact
          <button className={styles.addBtn} onClick={() => setAdding(!adding)}>
            {adding ? '✕ Cancel' : '+ Add holding'}
          </button>
        </div>

        {adding && (
          <form onSubmit={addHolding} className={styles.addForm}>
            <input className={styles.addInput} placeholder="Ticker (e.g. NVDA)" value={newTicker} onChange={e => setNewTicker(e.target.value)} required />
            <input className={styles.addInput} placeholder="Name (optional)" value={newName} onChange={e => setNewName(e.target.value)} />
            <select className={styles.addInput} value={newType} onChange={e => setNewType(e.target.value)}>
              <option value="stock">Stock</option>
              <option value="etf">ETF</option>
              <option value="crypto">Crypto</option>
              <option value="commodity">Commodity</option>
            </select>
            <input className={styles.addInput} type="number" step="any" placeholder="Qty (optional)" value={newQty} onChange={e => setNewQty(e.target.value)} />
            <input className={styles.addInput} type="number" step="any" placeholder="Avg cost $ (optional)" value={newCost} onChange={e => setNewCost(e.target.value)} />
            <button type="submit" className={styles.submitBtn}>Add</button>
            {error && <span className={styles.addError}>{error}</span>}
          </form>
        )}

        {loading && <div className={panelStyles.empty}>Loading portfolio…</div>}
        {!loading && holdings.length === 0 && (
          <div className={panelStyles.empty}>No holdings yet — add your first position above.</div>
        )}

        {holdings.map(h => {
          const impact = IMPACT_MOCK[h.ticker] ?? { label: '— No current signal', css: 'low' }
          return (
            <div key={h.id} className={styles.holding}>
              <div className={styles.holdingTicker}>{h.ticker}</div>
              <div className={styles.holdingName}>{h.name || h.ticker}</div>
              {h.quantity && <div className={styles.holdingQty}>{h.quantity} units</div>}
              {h.avg_cost && <div className={styles.holdingCost}>${h.avg_cost.toFixed(2)}</div>}
              <div className={`${styles.holdingImpact} ${styles[`impact_${impact.css}`]}`}>{impact.label}</div>
              <button className={styles.removeBtn} onClick={() => removeHolding(h.id)}>✕</button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
