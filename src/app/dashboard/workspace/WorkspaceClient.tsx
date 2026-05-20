'use client'
// src/app/dashboard/workspace/WorkspaceClient.tsx
// Options & Research Workspace — 3-panel layout
// Left: Holdings list with checkboxes
// Center: Selected ticker workspace (chain, strategies, DCA)
// Right: AI Advisor

import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Holding {
  id:              string
  ticker:          string
  quantity:        number
  avg_cost:        number
  unrealised_gain: number
  realised_gain:   number
  signal?: { price_usd: number | null; change_pct: number | null; signal: string | null } | null
}
interface Portfolio { id: string; name: string; total_capital: number; cash_pct: number }
interface WatchlistItem { id: string; ticker: string; name: string | null }
interface ChatMessage { role: 'user' | 'assistant'; content: string }
interface StagedTrade { ticker: string; type: string; description: string; premium?: string; strike?: string; expiry?: string; legs?: string }
interface DCAOrder {
  id:        string
  ticker:    string
  num:       number
  date:      string
  amount:    number
  estPrice:  number
  shares:    string
  condition: 'immediate' | 'macd_cross' | 'price_below' | 'price_above'
  conditionValue?: number
  macdPeriod?: '1h' | '4h' | '1d'
  status:    'pending' | 'triggered' | 'cancelled'
  createdAt: string
}

// ── Option chain ──────────────────────────────────────────────────────────────

function genChainRow(strike: number, spot: number, iv: number, dte: number) {
  const t = dte / 365, σ = iv / 100
  const d1 = (Math.log(spot / strike) + (0.05 + σ * σ / 2) * t) / (σ * Math.sqrt(t))
  const cD = Math.max(0.01, Math.min(0.99, 0.5 + d1 * 0.3))
  const cIV = (iv * (1 + Math.abs(spot - strike) / spot * 0.4)).toFixed(1)
  const pIV = (iv * (1 + Math.abs(spot - strike) / spot * 0.5)).toFixed(1)
  const tV = spot * σ * Math.sqrt(t) * 0.4
  const cP = Math.max(0.05, tV * cD + Math.max(0, spot - strike) * 0.98)
  const pP = Math.max(0.05, tV * (1 - cD) + Math.max(0, strike - spot) * 0.98)
  return {
    strike, callDelta: cD.toFixed(2), putDelta: (cD - 1).toFixed(2),
    callIV: cIV, putIV: pIV,
    callBid: (cP * 0.97).toFixed(2), callAsk: cP.toFixed(2),
    putBid: (pP * 0.97).toFixed(2), putAsk: pP.toFixed(2),
    callVol: Math.floor(Math.random() * 900 + 100),
    putVol:  Math.floor(Math.random() * 700 + 80),
    isATM: Math.abs(strike - spot) < spot * 0.015,
    isCallITM: strike < spot,
  }
}

function buildChain(spot: number, iv: number, dte: number) {
  const step = spot < 50 ? 1 : spot < 200 ? 2.5 : spot < 500 ? 5 : 10
  const base = Math.round(spot / step) * step
  return Array.from({ length: 17 }, (_, i) => genChainRow(base + (i - 8) * step, spot, iv, dte))
}

const EXPIRIES = [
  { label: 'Jun 20, 2025', dte: 37 }, { label: 'Jul 18, 2025', dte: 65 },
  { label: 'Aug 15, 2025', dte: 93 }, { label: 'Sep 19, 2025', dte: 128 },
  { label: 'Jan 16, 2026', dte: 246 },
]

// ── Strategies ────────────────────────────────────────────────────────────────

function buildStrategies(h: Holding, price: number, iv: number) {
  const pnlPct = h.avg_cost > 0 ? ((price - h.avg_cost) / h.avg_cost * 100) : 0
  const strats = []
  const step = price < 50 ? 1 : price < 200 ? 2.5 : price < 500 ? 5 : 10

  if (h.quantity >= 100) {
    const strike = Math.round(price * 1.05 / step) * step
    const prem = (price * (iv / 100) * Math.sqrt(37 / 365) * 0.4 * 0.28).toFixed(2)
    strats.push({ name: 'Covered Call', type: 'Income', color: '#22c55e', desc: `Sell the $${strike} call (37 DTE) for ~$${prem}/share ($${(parseFloat(prem) * 100).toFixed(0)}/contract). Caps upside at $${strike}.`, risk: 'Capped upside', reward: `$${(parseFloat(prem) * 100).toFixed(0)}/contract`, prob: '~70% OTM', expiry: 'Jun 20', legs: `Sell 1× ${h.ticker} $${strike} Call Jun 20` })
  }

  // PMCC — Poor Man's Covered Call: long deep ITM LEAP + short near-term OTM call
  // Works as a low-cost alternative to owning 100 shares
  const pmccLongStrike  = Math.round(price * 0.70 / step) * step  // deep ITM ~70% of price
  const pmccShortStrike = Math.round(price * 1.05 / step) * step  // OTM ~5% above price
  const pmccLongCost    = (price * (iv / 100) * Math.sqrt(365 / 365) * 0.4 * 0.85).toFixed(2) // ~365 DTE LEAP cost
  const pmccShortPrem   = (price * (iv / 100) * Math.sqrt(37 / 365) * 0.4 * 0.28).toFixed(2)  // ~37 DTE short call
  const pmccNetDebit    = (parseFloat(pmccLongCost) - parseFloat(pmccShortPrem)).toFixed(2)
  const pmccMaxProfit   = ((pmccShortStrike - pmccLongStrike - parseFloat(pmccNetDebit)) * 100).toFixed(0)
  strats.push({
    name: 'LEAPS / PMCC',
    type: 'Income / Leverage',
    color: '#8b5cf6',
    desc: `Buy $${pmccLongStrike} LEAP call (365 DTE) ~$${pmccLongCost}/share, sell $${pmccShortStrike} call (37 DTE) ~$${pmccShortPrem}. Net debit ~$${pmccNetDebit}/share. Roll short call monthly for income.`,
    risk: `$${(parseFloat(pmccNetDebit) * 100).toFixed(0)} net debit`,
    reward: `~$${pmccShortPrem}/share/month`,
    prob: '~70% short OTM',
    expiry: 'Jun 20 (short)',
    legs: `Buy 1× ${h.ticker} $${pmccLongStrike} Call LEAP / Sell 1× ${h.ticker} $${pmccShortStrike} Call Jun 20`,
  })

  const cspS = Math.round(price * 0.93 / step) * step
  const cspP = (price * (iv / 100) * Math.sqrt(65 / 365) * 0.4 * 0.32).toFixed(2)
  strats.push({ name: 'Cash-Secured Put', type: 'Accumulate', color: '#3b82f6', desc: `Sell $${cspS} put (65 DTE) for ~$${cspP}. Effective cost if assigned: $${(cspS - parseFloat(cspP)).toFixed(2)}.`, risk: `Must buy at $${cspS}`, reward: `$${(parseFloat(cspP) * 100).toFixed(0)}/contract`, prob: '~68% expire worthless', expiry: 'Jul 18', legs: `Sell 1× ${h.ticker} $${cspS} Put Jul 18` })
  if (pnlPct > 15) {
    const putS = Math.round(h.avg_cost * 1.02 / step) * step
    const putC = (price * (iv / 100) * Math.sqrt(93 / 365) * 0.4 * 0.22).toFixed(2)
    strats.push({ name: 'Protective Put', type: 'Hedge', color: '#f59e0b', desc: `Buy $${putS} put (93 DTE) ~$${putC}/share. Locks in gains, protects down to cost basis.`, risk: `$${(parseFloat(putC) * 100).toFixed(0)} premium`, reward: 'Full downside protection', prob: 'Pure hedge', expiry: 'Aug 15', legs: `Buy 1× ${h.ticker} $${putS} Put Aug 15` })
  }
  const bcsL = Math.round(price * 1.01 / step) * step
  const bcsS = Math.round(price * 1.08 / step) * step
  const bcsD = (price * (iv / 100) * Math.sqrt(65 / 365) * 0.4 * 0.18).toFixed(2)
  const bcsMax = ((bcsS - bcsL - parseFloat(bcsD)) * 100).toFixed(0)
  strats.push({ name: 'Bull Call Spread', type: 'Directional', color: '#14b8a6', desc: `Buy $${bcsL}/$${bcsS} call spread ~$${bcsD} debit. Max profit $${bcsMax} above $${bcsS}.`, risk: `$${(parseFloat(bcsD) * 100).toFixed(0)} max loss`, reward: `$${bcsMax} max profit`, prob: '~38% full profit', expiry: 'Jul 18', legs: `Buy $${bcsL} Call / Sell $${bcsS} Call Jul 18` })
  return strats
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined) { const v = n ?? 0; return v >= 1000 ? `$${(v / 1000).toFixed(1)}K` : `$${v.toFixed(2)}` }
function fmtN(n: number | null | undefined) { return (n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 }) }
// IV Rank mock — will be replaced with real data from broker bridge /options/iv_rank endpoint
// These are approximate historical IV rank values; real values from Moomoo OpenD differ
const ivRankMap: Record<string, number> = {
  TSLA:62, META:35, GOOG:28, PLTR:68, AMD:45, NVDA:48, GLD:18, JEPQ:22,
  QQQ:20, SPY:16, SLV:35, FCX:42, COST:24, CRWD:48, IRM:32,
  GEV:55, SMR:72, RXRX:65, OKLO:70, RDW:68, FNGU:75, AGQ:60, IONQ:71,
}
function getIV(t: string) { return ivRankMap[t] ?? Math.floor(Math.random() * 30 + 15) }

const quickChips: Record<string, string[]> = {
  TSLA: ['Best covered call?', 'TSLA hedge idea', 'CSP to buy dip?'],
  GOOG: ['Accumulate GOOG?', 'Covered call strikes', 'DCA $10k?'],
  META: ['META options play', 'Best CC strike?', 'Reduce or hold?'],
  GLD:  ['Gold hedge thesis', 'GLD covered call?', 'Macro view'],
  DEFAULT: ['Review this position', 'Best income strategy', 'Risk analysis'],
}

// ── Builder Search Panel (inline, no modal) ───────────────────────────────────

function BuilderSearchPanel({ ticker, spot, expiries, onResults, searching, setSearching }: {
  ticker:       string
  spot:         number
  expiries:     string[]
  onResults:    (rows: any[]) => void
  searching:    boolean
  setSearching: (v: boolean) => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const futureExpiries = expiries.filter(e => e.slice(0, 10) > today)

  const [expiryFrom,  setExpiryFrom]  = useState(futureExpiries[0]?.slice(0, 10) ?? '')
  const [expiryTo,    setExpiryTo]    = useState(futureExpiries[Math.min(2, futureExpiries.length - 1)]?.slice(0, 10) ?? '')
  const [optionType,  setOptionType]  = useState<'ALL'|'CALL'|'PUT'>('ALL')
  const [strikeMin,   setStrikeMin]   = useState(Math.round(spot * 0.90).toString())
  const [strikeMax,   setStrikeMax]   = useState(Math.round(spot * 1.10).toString())
  const [deltaMin,    setDeltaMin]    = useState('')
  const [deltaMax,    setDeltaMax]    = useState('')
  const [ivMin,       setIvMin]       = useState('')
  const [ivMax,       setIvMax]       = useState('')
  const [minOI,       setMinOI]       = useState('')
  const [error,       setError]       = useState('')

  const inSt: React.CSSProperties = { padding: '3px 6px', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text)', fontSize: 11, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const }

  async function search() {
    if (!expiryFrom) { setError('Select start expiry'); return }
    setSearching(true); setError('')
    try {
      const targetExpiries = futureExpiries.filter(e => {
        const d = e.slice(0, 10)
        return d >= expiryFrom && (!expiryTo || d <= expiryTo)
      })
      if (!targetExpiries.length) { setError('No expiries in range'); setSearching(false); return }

      const allRows: any[] = []
      for (const expiry of targetExpiries.slice(0, 4)) {
        const res = await fetch(`/api/broker/options/chain?symbol=US.${ticker}&expiry=${expiry.slice(0,10)}&strike_count=0`)
        if (!res.ok) continue
        const d = await res.json()
        for (const row of (d.rows ?? [])) {
          if (strikeMin && row.strike < parseFloat(strikeMin)) continue
          if (strikeMax && row.strike > parseFloat(strikeMax)) continue
          const process = (type: 'CALL'|'PUT') => {
            const prefix = type === 'CALL' ? 'call' : 'put'
            const delta = Math.abs(parseFloat(String(row[`${prefix}_delta`] ?? 0)))
            const iv    = parseFloat(String(row[`${prefix}_iv`] ?? 0))
            const oi    = parseInt(String(row[`${prefix}_oi`] ?? 0))
            const bid   = parseFloat(String(row[`${prefix}_bid`] ?? 0))
            const ask   = parseFloat(String(row[`${prefix}_ask`] ?? 0))
            if (deltaMin && delta < parseFloat(deltaMin)) return
            if (deltaMax && delta > parseFloat(deltaMax)) return
            if (ivMin    && iv    < parseFloat(ivMin))    return
            if (ivMax    && iv    > parseFloat(ivMax))    return
            if (minOI    && oi    < parseInt(minOI))      return
            if (bid === 0 && ask === 0)                    return
            allRows.push({ ...row, type, expiry: expiry.slice(0,10),
              delta: type === 'PUT' ? -delta : delta, iv, bid, ask,
              vol: row[`${prefix}_volume`] ?? 0, oi, code: row[`${prefix}_code`] ?? '' })
          }
          if (optionType !== 'PUT')  process('CALL')
          if (optionType !== 'CALL') process('PUT')
        }
      }
      allRows.sort((a, b) => a.expiry.localeCompare(b.expiry) || a.strike - b.strike)
      if (!allRows.length) { setError('No contracts matched'); setSearching(false); return }
      onResults(allRows)
    } catch (e: any) { setError(e.message) }
    finally { setSearching(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {/* Row 1: Expiry + Type */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 8, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Expiry from</div>
          <select value={expiryFrom} onChange={e => setExpiryFrom(e.target.value)} style={{ ...inSt, width: 130 }}>
            {futureExpiries.map(exp => {
              const d = Math.round((new Date(exp.slice(0,10)).getTime() - Date.now()) / 86400000)
              return <option key={exp} value={exp.slice(0,10)}>{exp.slice(0,10)} ({d}d)</option>
            })}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 8, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>To</div>
          <select value={expiryTo} onChange={e => setExpiryTo(e.target.value)} style={{ ...inSt, width: 130 }}>
            <option value="">Any</option>
            {futureExpiries.map(exp => {
              const d = Math.round((new Date(exp.slice(0,10)).getTime() - Date.now()) / 86400000)
              return <option key={exp} value={exp.slice(0,10)}>{exp.slice(0,10)} ({d}d)</option>
            })}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 8, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Type</div>
          <div style={{ display: 'flex', gap: 2 }}>
            {(['ALL','CALL','PUT'] as const).map(t => (
              <button key={t} onClick={() => setOptionType(t)} style={{ padding: '3px 8px', borderRadius: 'var(--r-md)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 10, fontWeight: optionType === t ? 600 : 400, background: optionType === t ? 'rgba(37,99,235,0.1)' : 'none', border: `1px solid ${optionType === t ? 'rgba(37,99,235,0.4)' : 'var(--border)'}`, color: optionType === t ? 'var(--color-info)' : 'var(--text-4)' }}>
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Row 2: Strike + Delta + IV + OI */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        {[
          { label: 'Strike min', val: strikeMin, set: setStrikeMin, w: 70, ph: String(Math.round(spot*0.9)) },
          { label: 'Strike max', val: strikeMax, set: setStrikeMax, w: 70, ph: String(Math.round(spot*1.1)) },
          { label: 'Delta min', val: deltaMin, set: setDeltaMin, w: 60, ph: '0.20' },
          { label: 'Delta max', val: deltaMax, set: setDeltaMax, w: 60, ph: '0.50' },
          { label: 'IV% min',   val: ivMin,    set: setIvMin,    w: 55, ph: '20' },
          { label: 'IV% max',   val: ivMax,    set: setIvMax,    w: 55, ph: '60' },
          { label: 'Min OI',    val: minOI,    set: setMinOI,    w: 60, ph: '100' },
        ].map(f => (
          <div key={f.label}>
            <div style={{ fontSize: 8, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{f.label}</div>
            <input value={f.val} onChange={e => f.set(e.target.value)} type="number" placeholder={f.ph} style={{ ...inSt, width: f.w }} />
          </div>
        ))}
      </div>

      {/* Row 3: Presets + Search button */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 8, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Presets:</span>
        {[
          { label: '30Δ CC',    fn: () => { setOptionType('CALL'); setDeltaMin('0.25'); setDeltaMax('0.35') } },
          { label: '30Δ CSP',   fn: () => { setOptionType('PUT');  setDeltaMin('0.25'); setDeltaMax('0.35') } },
          { label: 'ATM ±5%',   fn: () => { setStrikeMin(Math.round(spot*0.95).toString()); setStrikeMax(Math.round(spot*1.05).toString()) } },
          { label: 'OTM',       fn: () => { setDeltaMin('0'); setDeltaMax('0.45') } },
          { label: 'Liquid OI', fn: () => setMinOI('500') },
        ].map(p => (
          <button key={p.label} onClick={p.fn} style={{ fontSize: 9, padding: '2px 7px', borderRadius: 20, border: '1px solid var(--border)', background: 'none', color: 'var(--text-4)', cursor: 'pointer', fontFamily: 'inherit' }}>
            {p.label}
          </button>
        ))}
        <button onClick={search} disabled={searching}
          style={{ marginLeft: 'auto', padding: '4px 14px', fontWeight: 600, fontFamily: 'inherit', fontSize: 11, borderRadius: 'var(--r-md)', cursor: searching ? 'not-allowed' : 'pointer', opacity: searching ? 0.5 : 1, background: 'rgba(37,99,235,0.1)', border: '1px solid rgba(37,99,235,0.35)', color: 'var(--color-info)' }}>
          {searching ? 'Searching…' : '🔍 Search'}
        </button>
      </div>
      {error && <div style={{ fontSize: 10, color: 'var(--signal-bear)' }}>{error}</div>}
    </div>
  )
}


// ── DCA Stage Modal ──────────────────────────────────────────────────────────

function DCAStageModal({ row, idx, ticker, currentPrice, onClose, onStaged }: {
  row:          any
  idx:          number
  ticker:       string
  currentPrice: number
  onClose:      () => void
  onStaged:     (order: DCAOrder) => void
}) {
  const [condition,      setCondition]      = useState<'immediate' | 'macd_cross' | 'price_below' | 'price_above'>('immediate')
  const [conditionValue, setConditionValue] = useState(Math.round(currentPrice * 0.97).toString())
  const [macdPeriod,     setMacdPeriod]     = useState<'1h' | '4h' | '1d'>('1h')
  const [macdType,       setMacdType]       = useState<'bullish' | 'bearish'>('bullish')
  const [notBefore,      setNotBefore]      = useState('')  // default N/A
  const [orderType,      setOrderType]      = useState<'MARKET' | 'LIMIT'>('MARKET')
  const [limitPrice,     setLimitPrice]     = useState(Math.round(currentPrice * 0.97).toString())
  const [qty,            setQty]            = useState(String(Math.max(1, Math.floor(row.amount / currentPrice))))
  const [expireDate,     setExpireDate]     = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 30)
    return d.toISOString().slice(0, 10)
  })
  const [allow24h,       setAllow24h]       = useState(false)
  const [saving,         setSaving]         = useState(false)
  const [error,          setError]          = useState('')

  const inSt: React.CSSProperties = { padding: '5px 8px', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text)', fontSize: 'var(--fs-sm)', fontFamily: 'inherit', width: '100%', outline: 'none', boxSizing: 'border-box' }
  const lbSt: React.CSSProperties = { fontSize: 9, fontWeight: 500, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.07em', display: 'block', marginBottom: 3 }

  const conditionLabels = {
    immediate:   '⚡ Immediate — next market open',
    macd_cross:  '📈 MACD crossover signal',
    price_below: '📉 Price drops below target',
    price_above: '📈 Price rises above target',
  }

  async function stage() {
    if ((condition === 'price_below' || condition === 'price_above') && !conditionValue) {
      setError('Enter a price target'); return
    }
    if (condition === 'macd_cross') {
      // Register as conditional order via API
    }
    setSaving(true); setError('')
    try {
      const payload: any = {
        ticker,
        side:            'BUY',
        qty:             Math.max(1, parseInt(qty) || 1),
        order_type:      orderType,
        limit_price:     orderType === 'LIMIT' ? parseFloat(limitPrice) : null,
        not_before_time: notBefore,
        expires_at:      expireDate ? new Date(expireDate).toISOString() : new Date(Date.now() + 30 * 86400000).toISOString(),
        allow_24h:       allow24h,
        notes:           `DCA #${row.num} — ${conditionLabels[condition]}`,
      }

      if (condition === 'price_below') payload.price_below = parseFloat(conditionValue)
      if (condition === 'price_above') payload.price_above = parseFloat(conditionValue)
      if (condition === 'macd_cross') {
        payload.notes = `DCA #${row.num} — MACD ${macdType} cross on ${macdPeriod}`
        // price_below acts as an additional gate even with MACD
        if (conditionValue) payload.price_below = parseFloat(conditionValue)
      }

      const res  = await fetch('/api/orders/conditional', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body:   JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to create order'); return }

      const order: DCAOrder = {
        id:             data.order?.id ?? String(Date.now()),
        ticker,
        num:            row.num,
        date:           row.date,
        amount:         row.amount,
        estPrice:       row.estPrice,
        shares:         row.shares,
        condition,
        conditionValue: conditionValue ? parseFloat(conditionValue) : undefined,
        macdPeriod:     condition === 'macd_cross' ? macdPeriod : undefined,
        status:         'pending',
        createdAt:      new Date().toISOString(),
      }
      onStaged(order)
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.5)' }} />
      <div onClick={e => e.stopPropagation()} style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 401, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '1.2rem', width: 440, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', maxHeight: '90vh', overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Stage DCA Order</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 600 }}>{ticker} · DCA #{row.num}</div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', marginTop: 1 }}>
              ${fmtN(row.amount)} · ~{row.shares} shares · scheduled {row.date}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: '1.2rem' }}>×</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Condition type */}
          <div>
            <label style={lbSt}>Entry condition</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {([
                ['immediate',   '⚡ Immediate',     'Execute at market open'],
                ['price_below', '📉 Price below',   'Buy when price dips'],
                ['price_above', '📈 Price above',   'Buy on breakout'],
                ['macd_cross',  '📊 MACD cross',    'Buy on MACD signal'],
              ] as const).map(([val, label, desc]) => (
                <button key={val} onClick={() => setCondition(val as any)}
                  style={{ padding: '7px 9px', borderRadius: 'var(--r-md)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'var(--fs-xs)', textAlign: 'left', background: condition === val ? 'rgba(37,99,235,0.08)' : 'none', border: `1px solid ${condition === val ? 'rgba(37,99,235,0.35)' : 'var(--border)'}`, color: condition === val ? 'var(--color-info)' : 'var(--text-4)' }}>
                  <div style={{ fontWeight: 600, marginBottom: 1 }}>{label}</div>
                  <div style={{ fontSize: 8, opacity: 0.8 }}>{desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Price condition */}
          {(condition === 'price_below' || condition === 'price_above') && (
            <div>
              <label style={lbSt}>Target price ($) — current ${currentPrice.toFixed(2)}</label>
              <input value={conditionValue} onChange={e => setConditionValue(e.target.value)}
                type="number" step="0.01" style={inSt} />
              <div style={{ fontSize: 9, color: 'var(--text-4)', marginTop: 3 }}>
                {condition === 'price_below'
                  ? `${((parseFloat(conditionValue) - currentPrice) / currentPrice * 100).toFixed(1)}% from current`
                  : `+${((parseFloat(conditionValue) - currentPrice) / currentPrice * 100).toFixed(1)}% from current`}
              </div>
            </div>
          )}

          {/* MACD condition */}
          {condition === 'macd_cross' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ padding: '8px 10px', background: 'rgba(37,99,235,0.04)', border: '1px solid rgba(37,99,235,0.15)', borderRadius: 'var(--r-md)', fontSize: 'var(--fs-xs)', color: 'var(--text-3)', lineHeight: 1.6 }}>
                MACD (12/26/9) is calculated from intraday prices fetched every 5 minutes via Moomoo bridge. A crossover signal triggers the buy order via the conditional order monitor.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label style={lbSt}>Timeframe</label>
                  <select value={macdPeriod} onChange={e => setMacdPeriod(e.target.value as any)} style={inSt}>
                    <option value="1h">1 Hour</option>
                    <option value="4h">4 Hour</option>
                    <option value="1d">Daily</option>
                  </select>
                </div>
                <div>
                  <label style={lbSt}>Signal type</label>
                  <select value={macdType} onChange={e => setMacdType(e.target.value as any)} style={inSt}>
                    <option value="bullish">Bullish — MACD above signal line</option>
                    <option value="bearish">Bearish — MACD below signal line</option>
                  </select>
                </div>
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-4)', padding: '6px 8px', background: 'var(--bg-subtle)', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
                Triggers when MACD line crosses {macdType === 'bullish' ? 'above' : 'below'} signal line on {macdPeriod} candles. Requires Moomoo bridge to be online.
              </div>
              <div>
                <label style={lbSt}>Also require price below ($) — optional safety gate</label>
                <input value={conditionValue} onChange={e => setConditionValue(e.target.value)}
                  type="number" step="0.01" placeholder="e.g. 290.00 — leave blank to skip" style={inSt} />
              </div>
            </div>
          )}

          {/* Order type + qty + limit + timing */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={lbSt}>Shares (qty)</label>
              <input value={qty} onChange={e => setQty(e.target.value)} type="number" min="1" style={inSt} />
              <div style={{ fontSize: 9, color: 'var(--text-4)', marginTop: 3 }}>
                ≈ ${(parseFloat(qty || '0') * currentPrice).toFixed(0)} value
              </div>
            </div>
            <div>
              <label style={lbSt}>Order type</label>
              <select value={orderType} onChange={e => setOrderType(e.target.value as any)} style={inSt}>
                <option value="MARKET">Market</option>
                <option value="LIMIT">Limit</option>
              </select>
            </div>
            {orderType === 'LIMIT' && (
              <div>
                <label style={lbSt}>Limit price ($)</label>
                <input value={limitPrice} onChange={e => setLimitPrice(e.target.value)} type="number" step="0.01" style={inSt} />
              </div>
            )}
            <div>
              <label style={lbSt}>Not before (ET)</label>
              <select value={notBefore} onChange={e => setNotBefore(e.target.value)} style={inSt}>
                <option value="">N/A — any time (testing)</option>
                <option value="09:30">09:30 market open</option>
                <option value="10:00">10:00</option>
                <option value="10:30">10:30</option>
                <option value="11:00">11:00</option>
                <option value="14:00">14:00</option>
              </select>
            </div>
            <div>
              <label style={lbSt}>Expire date</label>
              <input value={expireDate} onChange={e => setExpireDate(e.target.value)} type="date" style={inSt} />
            </div>
          </div>

          {/* 24H trading toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: allow24h ? 'rgba(37,99,235,0.04)' : 'var(--bg-subtle)', border: `1px solid ${allow24h ? 'rgba(37,99,235,0.2)' : 'var(--border)'}`, borderRadius: 'var(--r-md)' }}>
            <div>
              <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 500, color: 'var(--text)', marginBottom: 1 }}>🕐 Allow 24H trading</div>
              <div style={{ fontSize: 9, color: 'var(--text-4)', lineHeight: 1.5 }}>
                Trigger outside market hours (pre/after market)<br/>
                <span style={{ color: 'var(--text-3)' }}>Time gate still applies to US ET</span>
              </div>
            </div>
            <button onClick={() => setAllow24h((v: boolean) => !v)}
              style={{ flexShrink: 0, marginLeft: 12, width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer', background: allow24h ? 'var(--color-info)' : 'var(--border)', position: 'relative', transition: 'background 0.2s' }}>
              <span style={{ position: 'absolute', top: 1, left: allow24h ? 19 : 1, width: 20, height: 20, borderRadius: '50%', background: 'white', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
            </button>
          </div>

          {/* Summary */}
          <div style={{ padding: '8px 10px', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', fontSize: 'var(--fs-xs)', color: 'var(--text-3)', lineHeight: 1.7 }}>
            <strong style={{ color: 'var(--text)' }}>Summary: </strong>
            BUY {qty} {ticker} {orderType === 'LIMIT' ? `@ $${limitPrice}` : 'at market'}
            {condition === 'immediate' && ' at next market open'}
            {condition === 'price_below' && ` when price drops below $${conditionValue}`}
            {condition === 'price_above' && ` when price rises above $${conditionValue}`}
            {condition === 'macd_cross' && ` on MACD ${macdType} crossover (${macdPeriod})`}
            {` · not before ${notBefore} ET · expires ${expireDate}`}
          </div>

          {error && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--signal-bear)', padding: '6px 8px', background: 'rgba(185,28,28,0.05)', border: '1px solid rgba(185,28,28,0.15)', borderRadius: 'var(--r-md)' }}>{error}</div>}

          <button onClick={stage} disabled={saving}
            style={{ padding: '7px', fontWeight: 600, fontFamily: 'inherit', fontSize: 'var(--fs-sm)', borderRadius: 'var(--r-md)', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.5 : 1, background: 'rgba(21,128,61,0.1)', border: '1px solid rgba(21,128,61,0.35)', color: 'var(--signal-bull)' }}>
            {saving ? 'Staging…' : 'Stage DCA order →'}
          </button>
        </div>
      </div>
    </>
  )
}


// ── DCA Manager Modal ─────────────────────────────────────────────────────────

function DCAManagerModal({ orders, onClose, onCancel }: {
  orders:   DCAOrder[]
  onClose:  () => void
  onCancel: (id: string) => void
}) {
  const conditionLabel: Record<string, string> = {
    immediate:   '⚡ Immediate',
    price_below: '📉 Price below',
    price_above: '📈 Price above',
    macd_cross:  '📊 MACD cross',
  }
  const statusColor: Record<string, string> = {
    pending:   'var(--signal-neut)',
    triggered: 'var(--signal-bull)',
    cancelled: 'var(--text-4)',
  }

  const pending   = orders.filter(o => o.status === 'pending')
  const completed = orders.filter(o => o.status !== 'pending')

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.5)' }} />
      <div onClick={e => e.stopPropagation()} style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 401, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '1.2rem', width: 520, maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Staged DCA Orders</div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{pending.length} pending · {completed.length} completed</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: '1.2rem' }}>×</button>
        </div>

        {/* Pending orders */}
        {pending.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 9, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Pending</div>
            {pending.map(o => (
              <div key={o.id} style={{ display: 'grid', gridTemplateColumns: '40px 70px 1fr 1fr auto', gap: 8, padding: '8px 10px', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', marginBottom: 4, alignItems: 'center', background: 'var(--bg-subtle)' }}>
                <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>#{o.num}</div>
                <div style={{ fontSize: 10, color: 'var(--text-4)' }}>{o.date}</div>
                <div>
                  <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)' }}>{o.ticker} · ${fmtN(o.amount)}</div>
                  <div style={{ fontSize: 9, color: 'var(--text-4)', marginTop: 1 }}>~{o.shares} shares</div>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: 'var(--color-info)', marginBottom: 1 }}>{conditionLabel[o.condition]}</div>
                  {o.conditionValue && <div style={{ fontSize: 9, color: 'var(--text-4)', fontFamily: 'var(--font-mono)' }}>${o.conditionValue.toFixed(2)}</div>}
                  {o.macdPeriod && <div style={{ fontSize: 9, color: 'var(--text-4)' }}>{o.macdPeriod} candles</div>}
                </div>
                <button onClick={() => onCancel(o.id)}
                  style={{ padding: '3px 8px', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--signal-bear)', fontSize: 9, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                  Cancel
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Completed orders */}
        {completed.length > 0 && (
          <div>
            <div style={{ fontSize: 9, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>History</div>
            {completed.map(o => (
              <div key={o.id} style={{ display: 'grid', gridTemplateColumns: '40px 70px 1fr 1fr 60px', gap: 8, padding: '6px 10px', borderRadius: 'var(--r-md)', border: '1px solid var(--border-subtle)', marginBottom: 3, alignItems: 'center', opacity: 0.6 }}>
                <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)' }}>#{o.num}</div>
                <div style={{ fontSize: 10, color: 'var(--text-4)' }}>{o.date}</div>
                <div style={{ fontSize: 10 }}>{o.ticker} · ${fmtN(o.amount)}</div>
                <div style={{ fontSize: 9, color: 'var(--text-4)' }}>{conditionLabel[o.condition]}</div>
                <div style={{ fontSize: 9, fontWeight: 600, color: statusColor[o.status], textTransform: 'uppercase' }}>{o.status}</div>
              </div>
            ))}
          </div>
        )}

        {orders.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-4)', fontSize: 'var(--fs-sm)', padding: '20px 0' }}>No staged orders yet</div>
        )}

        <div style={{ marginTop: 12, fontSize: 9, color: 'var(--text-4)', lineHeight: 1.6, padding: '8px 10px', background: 'var(--bg-subtle)', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
          <strong style={{ color: 'var(--text-3)' }}>How it works:</strong> Staged orders are saved as conditional orders and monitored every minute during market hours (9:30–16:00 ET). MACD conditions require the Moomoo bridge to be online for intraday price data.
        </div>
      </div>
    </>
  )
}

// ── LEAPS Stage Modal (LEAPS alone or PMCC with short call) ──────────────────

function PMCCStageModal({ ticker, price, iv, ivRank, expiries, onClose, onStaged }: {
  ticker:   string
  price:    number
  iv:       number
  ivRank:   number | null
  expiries: string[]
  onClose:  () => void
  onStaged: () => void
}) {
  const step = price < 50 ? 1 : price < 200 ? 2.5 : price < 500 ? 5 : 10

  // ── LEAPS leg ──────────────────────────────────────────────────────────────
  const [leg1DteMin,     setLeg1DteMin]     = useState('180')
  const [leg1DteMax,     setLeg1DteMax]     = useState('365')
  const [leg1DeltaMin,   setLeg1DeltaMin]   = useState('0.75')
  const [leg1DeltaMax,   setLeg1DeltaMax]   = useState('0.90')
  const [leg1IvMax,      setLeg1IvMax]      = useState('20')
  const [leg1ExpireDate, setLeg1ExpireDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 90); return d.toISOString().slice(0, 10) })

  // ── Short call toggle + leg ────────────────────────────────────────────────
  const [sellCall,       setSellCall]       = useState(false)
  const [leg2DteMin,     setLeg2DteMin]     = useState('21')
  const [leg2DteMax,     setLeg2DteMax]     = useState('45')
  const [leg2DeltaMin,   setLeg2DeltaMin]   = useState('0.25')
  const [leg2DeltaMax,   setLeg2DeltaMax]   = useState('0.35')
  const [leg2IvMin,      setLeg2IvMin]      = useState('18')
  const [leg2PremMin,    setLeg2PremMin]    = useState('0.50')
  const [leg2OiMin,      setLeg2OiMin]      = useState('100')
  const [leg2ExpireDate, setLeg2ExpireDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 60); return d.toISOString().slice(0, 10) })

  // ── Timing ─────────────────────────────────────────────────────────────────
  const [notBefore, setNotBefore] = useState('')
  const [allow24h,  setAllow24h]  = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState('')
  const [success,   setSuccess]   = useState('')

  const inSt: React.CSSProperties = { padding: '4px 7px', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text)', fontSize: 11, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const, width: '100%' }
  const lbSt: React.CSSProperties = { fontSize: 8, fontWeight: 500, color: 'var(--text-4)', textTransform: 'uppercase' as const, letterSpacing: '0.06em', display: 'block', marginBottom: 2 }

  const strategyType = sellCall ? 'pmcc' : 'leaps'
  const estLeapCost   = (price * (iv / 100) * Math.sqrt(270 / 365) * 0.4 * 0.85).toFixed(2)
  const estShortPrem  = (price * (iv / 100) * Math.sqrt(33  / 365) * 0.4 * 0.30).toFixed(2)

  async function stage() {
    setSaving(true); setError('')
    try {
      const leg1Criteria = {
        dte_min: parseInt(leg1DteMin), dte_max: parseInt(leg1DteMax),
        delta_min: parseFloat(leg1DeltaMin), delta_max: parseFloat(leg1DeltaMax),
        select: 'best_delta',
      }

      const leg1Res = await fetch('/api/orders/conditional', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker, asset_type: 'option', side: 'BUY', qty: 1, order_type: 'LIMIT',
          iv_rank_below:   parseFloat(leg1IvMax),
          not_before_time: notBefore || null,
          expires_at:      new Date(leg1ExpireDate).toISOString(),
          allow_24h:       allow24h,
          is_active:       true,
          leg_num:         1,
          notes:           `PMCC LEG1 CRITERIA:${JSON.stringify(leg1Criteria)} | ${ticker} LEAP δ${leg1DeltaMin}-${leg1DeltaMax} ${leg1DteMin}-${leg1DteMax}DTE | Enter IVR≤${leg1IvMax}`,
        }),
      })
      const leg1Data = await leg1Res.json()
      if (!leg1Res.ok) throw new Error(leg1Data.error ?? 'Leg 1 failed')

      let leg2Data: any = {}
      if (sellCall) {
        const leg2Criteria = {
          dte_min: parseInt(leg2DteMin), dte_max: parseInt(leg2DteMax),
          delta_min: parseFloat(leg2DeltaMin), delta_max: parseFloat(leg2DeltaMax),
          oi_min: parseInt(leg2OiMin), select: 'best_premium',
        }
        const leg2Res = await fetch('/api/orders/conditional', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ticker, asset_type: 'option', side: 'SELL', qty: 1, order_type: 'LIMIT',
            iv_rank_above:   parseFloat(leg2IvMin),
            premium_above:   parseFloat(leg2PremMin),
            not_before_time: notBefore || null,
            expires_at:      new Date(leg2ExpireDate).toISOString(),
            allow_24h:       allow24h,
            is_active:       false,
            leg_num:         2,
            notes:           `PMCC LEG2 CRITERIA:${JSON.stringify(leg2Criteria)} | ${ticker} ShortCall δ${leg2DeltaMin}-${leg2DeltaMax} ${leg2DteMin}-${leg2DteMax}DTE | Min bid $${leg2PremMin} IVR≥${leg2IvMin}`,
          }),
        })
        leg2Data = await leg2Res.json()
        if (!leg2Res.ok) throw new Error(leg2Data.error ?? 'Leg 2 failed')
      }

      const stratRes = await fetch('/api/strategies/option', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: strategyType, ticker,
          leg1_order_id:     leg1Data.order?.id,
          leg1_delta_target: (parseFloat(leg1DeltaMin) + parseFloat(leg1DeltaMax)) / 2,
          leg1_iv_max:       parseFloat(leg1IvMax),
          ...(sellCall && {
            leg2_order_id:     leg2Data.order?.id,
            leg2_delta_target: (parseFloat(leg2DeltaMin) + parseFloat(leg2DeltaMax)) / 2,
            leg2_iv_min:       parseFloat(leg2IvMin),
            leg2_premium_min:  parseFloat(leg2PremMin),
          }),
          notes: sellCall
            ? `LEAP: δ${leg1DeltaMin}-${leg1DeltaMax} ${leg1DteMin}-${leg1DteMax}DTE IVR≤${leg1IvMax} | Short: δ${leg2DeltaMin}-${leg2DeltaMax} ${leg2DteMin}-${leg2DteMax}DTE bid≥$${leg2PremMin}`
            : `LEAPS: δ${leg1DeltaMin}-${leg1DeltaMax} ${leg1DteMin}-${leg1DteMax}DTE IVR≤${leg1IvMax}`,
        }),
      })
      const stratData = await stratRes.json()

      if (stratData.strategy?.id) {
        const patches: Promise<any>[] = [
          fetch(`/api/orders/conditional?id=${leg1Data.order?.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ strategy_id: stratData.strategy.id }) }),
        ]
        if (sellCall && leg2Data.order?.id) {
          patches.push(fetch(`/api/orders/conditional?id=${leg2Data.order?.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ strategy_id: stratData.strategy.id }) }))
        }
        await Promise.all(patches)
      }

      setSuccess(sellCall
        ? `PMCC staged ✓ — Leg 1 fires when IVR ≤ ${leg1IvMax}. Leg 2 activates after LEAP fills when IVR ≥ ${leg2IvMin} and bid ≥ $${leg2PremMin}.`
        : `LEAPS staged ✓ — LEAP buy fires when IVR ≤ ${leg1IvMax}. Add a short call later to convert to PMCC.`
      )
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.5)' }} />
      <div onClick={e => e.stopPropagation()} style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 401, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '1.2rem', width: 500, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 9, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Stage Strategy — Criteria Only</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 600 }}>
              {sellCall ? 'PMCC' : 'LEAPS'} · {ticker}
            </div>
            <div style={{ fontSize: 9, color: 'var(--text-4)', marginTop: 2 }}>
              ${price.toFixed(2)} · IV {iv.toFixed(1)}%{ivRank !== null ? ` · IVR ${ivRank}` : ''}
              {ivRank !== null && ivRank <= 20
                ? <span style={{ marginLeft: 6, color: 'var(--signal-bull)', fontWeight: 600 }}>✓ Good time to buy LEAP</span>
                : ivRank !== null
                ? <span style={{ marginLeft: 6, color: 'var(--signal-neut)' }}>Waiting for IVR ≤ {leg1IvMax}</span>
                : null}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: '1.2rem' }}>×</button>
        </div>

        {/* How it works */}
        <div style={{ padding: '7px 10px', background: 'rgba(37,99,235,0.04)', border: '1px solid rgba(37,99,235,0.15)', borderRadius: 'var(--r-md)', fontSize: 9, color: 'var(--text-3)', lineHeight: 1.6, marginBottom: 12 }}>
          <strong style={{ color: 'var(--color-info)' }}>How it works:</strong> Define criteria ranges only. When conditions are met, the cron searches the live chain, picks the best contract by delta + liquidity, and places the order automatically.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* LEG 1 — LEAPS */}
          <div style={{ padding: '10px 12px', background: 'rgba(21,128,61,0.03)', border: '1px solid rgba(21,128,61,0.2)', borderRadius: 'var(--r-lg)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--signal-bull)', background: 'rgba(21,128,61,0.1)', padding: '1px 7px', borderRadius: 10 }}>BUY LEAP</span>
              <span style={{ fontSize: 9, color: 'var(--text-4)' }}>Cron selects closest-delta contract</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6, marginBottom: 6 }}>
              <div><label style={lbSt}>Min DTE</label><input value={leg1DteMin} onChange={e => setLeg1DteMin(e.target.value)} type="number" min="90" max="730" style={inSt} /></div>
              <div><label style={lbSt}>Max DTE</label><input value={leg1DteMax} onChange={e => setLeg1DteMax(e.target.value)} type="number" min="90" max="730" style={inSt} /></div>
              <div><label style={lbSt}>Min delta</label><input value={leg1DeltaMin} onChange={e => setLeg1DeltaMin(e.target.value)} type="number" step="0.05" min="0.5" max="1" style={inSt} /></div>
              <div><label style={lbSt}>Max delta</label><input value={leg1DeltaMax} onChange={e => setLeg1DeltaMax(e.target.value)} type="number" step="0.05" min="0.5" max="1" style={inSt} /></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
              <div>
                <label style={lbSt}>Max IV Rank to enter</label>
                <input value={leg1IvMax} onChange={e => setLeg1IvMax(e.target.value)} type="number" step="1" min="5" max="50" style={inSt} />
                <div style={{ fontSize: 8, color: 'var(--text-4)', marginTop: 2 }}>Buy when IVR ≤ this</div>
              </div>
              <div>
                <label style={lbSt}>Limit price</label>
                <div style={{ padding: '4px 7px', background: 'rgba(37,99,235,0.05)', border: '1px solid rgba(37,99,235,0.2)', borderRadius: 'var(--r-md)', fontSize: 10, color: 'var(--color-info)' }}>Mid (bid+ask)/2</div>
                <div style={{ fontSize: 8, color: 'var(--text-4)', marginTop: 2 }}>Cron sets limit at midpoint</div>
              </div>
              <div><label style={lbSt}>Order expires</label><input value={leg1ExpireDate} onChange={e => setLeg1ExpireDate(e.target.value)} type="date" style={inSt} /></div>
            </div>
            <div style={{ marginTop: 6, fontSize: 9, color: 'var(--text-4)', background: 'rgba(21,128,61,0.05)', padding: '4px 8px', borderRadius: 'var(--r-md)' }}>
              Est. LEAP cost at current IV: <strong style={{ color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>${estLeapCost}/share (~${(parseFloat(estLeapCost) * 100).toFixed(0)}/contract)</strong>
            </div>
          </div>

          {/* SELL CALL toggle */}
          <div
            onClick={() => setSellCall(v => !v)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: sellCall ? 'rgba(185,28,28,0.04)' : 'var(--bg-subtle)', border: `1px solid ${sellCall ? 'rgba(185,28,28,0.25)' : 'var(--border)'}`, borderRadius: 'var(--r-lg)', cursor: 'pointer', userSelect: 'none' as const }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: sellCall ? 'var(--signal-bear)' : 'var(--text)' }}>
                {sellCall ? '✓' : '○'} Add short call — convert to PMCC
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-4)', marginTop: 1 }}>
                {sellCall ? 'Sell OTM call monthly for income. LEG 2 activates only after LEAP fills.' : 'Leave unchecked for a standalone LEAPS position.'}
              </div>
            </div>
            <div style={{ width: 36, height: 20, borderRadius: 10, background: sellCall ? 'var(--signal-bear)' : 'var(--border)', position: 'relative', transition: 'background 0.2s', flexShrink: 0, marginLeft: 12 }}>
              <span style={{ position: 'absolute', top: 1, left: sellCall ? 17 : 1, width: 18, height: 18, borderRadius: '50%', background: 'white', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
            </div>
          </div>

          {/* LEG 2 — Short Call (only when sellCall = true) */}
          {sellCall && (
            <div style={{ padding: '10px 12px', background: 'rgba(185,28,28,0.03)', border: '1px solid rgba(185,28,28,0.2)', borderRadius: 'var(--r-lg)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--signal-bear)', background: 'rgba(185,28,28,0.1)', padding: '1px 7px', borderRadius: 10 }}>SELL SHORT CALL</span>
                <span style={{ fontSize: 9, color: 'var(--text-4)' }}>Cron selects highest premium within delta range</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6, marginBottom: 6 }}>
                <div><label style={lbSt}>Min DTE</label><input value={leg2DteMin} onChange={e => setLeg2DteMin(e.target.value)} type="number" min="7" max="60" style={inSt} /></div>
                <div><label style={lbSt}>Max DTE</label><input value={leg2DteMax} onChange={e => setLeg2DteMax(e.target.value)} type="number" min="7" max="60" style={inSt} /></div>
                <div><label style={lbSt}>Min delta</label><input value={leg2DeltaMin} onChange={e => setLeg2DeltaMin(e.target.value)} type="number" step="0.05" min="0.1" max="0.5" style={inSt} /></div>
                <div><label style={lbSt}>Max delta</label><input value={leg2DeltaMax} onChange={e => setLeg2DeltaMax(e.target.value)} type="number" step="0.05" min="0.1" max="0.5" style={inSt} /></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6 }}>
                <div>
                  <label style={lbSt}>Min IV Rank</label>
                  <input value={leg2IvMin} onChange={e => setLeg2IvMin(e.target.value)} type="number" step="1" min="5" max="80" style={inSt} />
                  <div style={{ fontSize: 8, color: 'var(--text-4)', marginTop: 2 }}>Sell when IVR ≥ this</div>
                </div>
                <div>
                  <label style={lbSt}>Min bid ($/share)</label>
                  <input value={leg2PremMin} onChange={e => setLeg2PremMin(e.target.value)} type="number" step="0.05" min="0.10" style={inSt} />
                  <div style={{ fontSize: 8, color: 'var(--text-4)', marginTop: 2 }}>Min premium to collect</div>
                </div>
                <div>
                  <label style={lbSt}>Min open interest</label>
                  <input value={leg2OiMin} onChange={e => setLeg2OiMin(e.target.value)} type="number" step="50" min="0" style={inSt} />
                  <div style={{ fontSize: 8, color: 'var(--text-4)', marginTop: 2 }}>Liquidity filter</div>
                </div>
                <div><label style={lbSt}>Order expires</label><input value={leg2ExpireDate} onChange={e => setLeg2ExpireDate(e.target.value)} type="date" style={inSt} /></div>
              </div>
              <div style={{ marginTop: 6, fontSize: 9, color: 'var(--text-4)', background: 'rgba(185,28,28,0.05)', padding: '4px 8px', borderRadius: 'var(--r-md)' }}>
                Est. monthly premium at current IV: <strong style={{ color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>${estShortPrem}/share (~${(parseFloat(estShortPrem) * 100).toFixed(0)}/contract)</strong>
              </div>
            </div>
          )}

          {/* Timing */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={lbSt}>Not before (ET) — {sellCall ? 'both legs' : 'LEAP'}</label>
              <select value={notBefore} onChange={e => setNotBefore(e.target.value)} style={inSt}>
                <option value="">N/A — any time (testing)</option>
                <option value="09:30">09:30 market open</option>
                <option value="10:00">10:00 (30 min in)</option>
                <option value="10:30">10:30 (1 hr in)</option>
                <option value="11:00">11:00</option>
                <option value="14:00">14:00</option>
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: allow24h ? 'rgba(37,99,235,0.04)' : 'var(--bg-subtle)', border: `1px solid ${allow24h ? 'rgba(37,99,235,0.2)' : 'var(--border)'}`, borderRadius: 'var(--r-md)' }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--text)' }}>🕐 24H trading</div>
                <div style={{ fontSize: 8, color: 'var(--text-4)' }}>Allow pre/after market · time gate still applies</div>
              </div>
              <button onClick={() => setAllow24h((v: boolean) => !v)}
                style={{ width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer', background: allow24h ? 'var(--color-info)' : 'var(--border)', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
                <span style={{ position: 'absolute', top: 1, left: allow24h ? 17 : 1, width: 18, height: 18, borderRadius: '50%', background: 'white', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
              </button>
            </div>
          </div>

          {/* Summary */}
          <div style={{ padding: '8px 10px', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', fontSize: 9, lineHeight: 1.8, color: 'var(--text-3)' }}>
            <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Execution summary</div>
            <div><span style={{ color: 'var(--signal-bull)' }}>▶ LEAP</span> — cron buys best call (δ {leg1DeltaMin}–{leg1DeltaMax}, {leg1DteMin}–{leg1DteMax} DTE) when <strong style={{ fontFamily: 'var(--font-mono)' }}>IVR ≤ {leg1IvMax}</strong>{notBefore ? ` after ${notBefore} ET` : ''}</div>
            {sellCall && <div style={{ marginTop: 2 }}><span style={{ color: 'var(--signal-bear)' }}>▶ Short call</span> — activates only after LEAP fills. Sells best call (δ {leg2DeltaMin}–{leg2DeltaMax}, {leg2DteMin}–{leg2DteMax} DTE) when <strong style={{ fontFamily: 'var(--font-mono)' }}>IVR ≥ {leg2IvMin}</strong> and <strong style={{ fontFamily: 'var(--font-mono)' }}>bid ≥ ${leg2PremMin}</strong></div>}
          </div>

          {error   && <div style={{ fontSize: 10, color: 'var(--signal-bear)', padding: '6px 8px', background: 'rgba(185,28,28,0.05)', border: '1px solid rgba(185,28,28,0.15)', borderRadius: 'var(--r-md)' }}>{error}</div>}
          {success && <div style={{ fontSize: 10, color: 'var(--signal-bull)', padding: '6px 8px', background: 'rgba(21,128,61,0.05)', border: '1px solid rgba(21,128,61,0.15)', borderRadius: 'var(--r-md)', lineHeight: 1.7, whiteSpace: 'pre-line' }}>{success}</div>}

          {success
            ? <button onClick={onStaged} style={{ padding: '7px', fontWeight: 600, fontFamily: 'inherit', fontSize: 11, borderRadius: 'var(--r-md)', cursor: 'pointer', background: 'rgba(21,128,61,0.1)', border: '1px solid rgba(21,128,61,0.35)', color: 'var(--signal-bull)' }}>Done ✓</button>
            : <button onClick={stage} disabled={saving}
                style={{ padding: '7px', fontWeight: 600, fontFamily: 'inherit', fontSize: 11, borderRadius: 'var(--r-md)', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.5 : 1, background: sellCall ? 'rgba(139,92,246,0.1)' : 'rgba(21,128,61,0.08)', border: `1px solid ${sellCall ? 'rgba(139,92,246,0.35)' : 'rgba(21,128,61,0.3)'}`, color: sellCall ? '#8b5cf6' : 'var(--signal-bull)' }}>
                {saving ? 'Staging…' : sellCall ? 'Stage PMCC — 2 conditional orders →' : 'Stage LEAPS — 1 conditional order →'}
              </button>
          }
        </div>
      </div>
    </>
  )
}

function OptionSearchModal({ ticker, spot, expiries, onClose, onResults, searching, setSearching }: {
  ticker:      string
  spot:        number
  expiries:    string[]
  onClose:     () => void
  onResults:   (rows: any[]) => void
  searching:   boolean
  setSearching: (v: boolean) => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const futureExpiries = expiries.filter(e => e.slice(0, 10) > today)

  const [expiryFrom,  setExpiryFrom]  = useState(futureExpiries[0]?.slice(0, 10) ?? '')
  const [expiryTo,    setExpiryTo]    = useState(futureExpiries[Math.min(3, futureExpiries.length - 1)]?.slice(0, 10) ?? '')
  const [optionType,  setOptionType]  = useState<'ALL'|'CALL'|'PUT'>('ALL')
  const [strikeMin,   setStrikeMin]   = useState(Math.round(spot * 0.85).toString())
  const [strikeMax,   setStrikeMax]   = useState(Math.round(spot * 1.15).toString())
  const [deltaMin,    setDeltaMin]    = useState('')
  const [deltaMax,    setDeltaMax]    = useState('')
  const [ivMin,       setIvMin]       = useState('')
  const [ivMax,       setIvMax]       = useState('')
  const [minOI,       setMinOI]       = useState('')
  const [error,       setError]       = useState('')

  const inSt: React.CSSProperties = {
    padding: '4px 7px', background: 'var(--bg-subtle)', border: '1px solid var(--border)',
    borderRadius: 'var(--r-md)', color: 'var(--text)', fontSize: 'var(--fs-sm)',
    fontFamily: 'inherit', width: '100%', outline: 'none', boxSizing: 'border-box',
  }
  const lbSt: React.CSSProperties = {
    fontSize: 9, fontWeight: 500, color: 'var(--text-4)',
    textTransform: 'uppercase', letterSpacing: '0.07em', display: 'block', marginBottom: 3,
  }

  async function search() {
    if (!expiryFrom) { setError('Select at least a start expiry'); return }
    setSearching(true); setError('')
    try {
      // Find expiries in range
      const targetExpiries = futureExpiries.filter(e => {
        const d = e.slice(0, 10)
        return d >= expiryFrom && (!expiryTo || d <= expiryTo)
      })
      if (!targetExpiries.length) { setError('No expiries in selected range'); setSearching(false); return }

      // Fetch chain for each expiry in range
      const allRows: any[] = []
      for (const expiry of targetExpiries.slice(0, 4)) { // limit to 4 expiries
        const res = await fetch(`/api/broker/options/chain?symbol=US.${ticker}&expiry=${expiry.slice(0, 10)}&strike_count=0`)
        if (!res.ok) continue
        const d = await res.json()
        for (const row of (d.rows ?? [])) {
          // Strike filter
          if (strikeMin && row.strike < parseFloat(strikeMin)) continue
          if (strikeMax && row.strike > parseFloat(strikeMax)) continue

          // Process call side
          if (optionType !== 'PUT') {
            const delta = parseFloat(String(row.call_delta ?? 0))
            const iv    = parseFloat(String(row.call_iv ?? 0))
            const oi    = parseInt(String(row.call_oi ?? 0))
            if (deltaMin && delta < parseFloat(deltaMin)) {} else
            if (deltaMax && delta > parseFloat(deltaMax)) {} else
            if (ivMin    && iv    < parseFloat(ivMin))    {} else
            if (ivMax    && iv    > parseFloat(ivMax))    {} else
            if (minOI    && oi    < parseInt(minOI))      {} else
            if (row.call_bid > 0 || row.call_ask > 0) {
              allRows.push({ ...row, type: 'CALL', expiry: expiry.slice(0, 10),
                delta, iv, bid: row.call_bid, ask: row.call_ask,
                vol: row.call_volume, oi, code: row.call_code })
            }
          }

          // Process put side
          if (optionType !== 'CALL') {
            const delta = Math.abs(parseFloat(String(row.put_delta ?? 0)))
            const iv    = parseFloat(String(row.put_iv ?? 0))
            const oi    = parseInt(String(row.put_oi ?? 0))
            if (deltaMin && delta < parseFloat(deltaMin)) {} else
            if (deltaMax && delta > parseFloat(deltaMax)) {} else
            if (ivMin    && iv    < parseFloat(ivMin))    {} else
            if (ivMax    && iv    > parseFloat(ivMax))    {} else
            if (minOI    && oi    < parseInt(minOI))      {} else
            if (row.put_bid > 0 || row.put_ask > 0) {
              allRows.push({ ...row, type: 'PUT', expiry: expiry.slice(0, 10),
                delta: -delta, iv, bid: row.put_bid, ask: row.put_ask,
                vol: row.put_volume, oi, code: row.put_code })
            }
          }
        }
      }

      // Sort by expiry then strike
      allRows.sort((a, b) => a.expiry.localeCompare(b.expiry) || a.strike - b.strike)

      if (!allRows.length) { setError('No contracts matched your criteria'); setSearching(false); return }
      onResults(allRows)
    } catch (e: any) { setError(e.message) }
    finally { setSearching(false) }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.5)' }} />
      <div onClick={e => e.stopPropagation()} style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 401, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '1.2rem', width: 440, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', maxHeight: '90vh', overflowY: 'auto' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Option Search</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 600 }}>{ticker} · ${spot.toFixed(2)}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: '1.2rem' }}>×</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* Expiry range */}
          <div>
            <label style={lbSt}>Expiry range</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 6, alignItems: 'center' }}>
              <select value={expiryFrom} onChange={e => setExpiryFrom(e.target.value)} style={inSt}>
                {futureExpiries.map(exp => {
                  const d = Math.round((new Date(exp.slice(0,10)).getTime() - Date.now()) / 86400000)
                  return <option key={exp} value={exp.slice(0,10)}>{exp.slice(0,10)} ({d}d)</option>
                })}
              </select>
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)' }}>to</span>
              <select value={expiryTo} onChange={e => setExpiryTo(e.target.value)} style={inSt}>
                <option value="">Any</option>
                {futureExpiries.map(exp => {
                  const d = Math.round((new Date(exp.slice(0,10)).getTime() - Date.now()) / 86400000)
                  return <option key={exp} value={exp.slice(0,10)}>{exp.slice(0,10)} ({d}d)</option>
                })}
              </select>
            </div>
          </div>

          {/* Call / Put */}
          <div>
            <label style={lbSt}>Option type</label>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['ALL','CALL','PUT'] as const).map(t => (
                <button key={t} onClick={() => setOptionType(t)}
                  style={{ flex: 1, padding: '5px', borderRadius: 'var(--r-md)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'var(--fs-sm)', fontWeight: optionType === t ? 600 : 400, background: optionType === t ? 'rgba(37,99,235,0.1)' : 'none', border: `1px solid ${optionType === t ? 'rgba(37,99,235,0.4)' : 'var(--border)'}`, color: optionType === t ? 'var(--color-info)' : 'var(--text-4)' }}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Strike range */}
          <div>
            <label style={lbSt}>Strike range ($)</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 6, alignItems: 'center' }}>
              <input value={strikeMin} onChange={e => setStrikeMin(e.target.value)} type="number" placeholder="Min" style={inSt} />
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)' }}>–</span>
              <input value={strikeMax} onChange={e => setStrikeMax(e.target.value)} type="number" placeholder="Max" style={inSt} />
            </div>
          </div>

          {/* Delta range */}
          <div>
            <label style={lbSt}>Delta range (absolute, e.g. 0.2 – 0.5)</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 6, alignItems: 'center' }}>
              <input value={deltaMin} onChange={e => setDeltaMin(e.target.value)} type="number" step="0.01" min="0" max="1" placeholder="Min (e.g. 0.20)" style={inSt} />
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)' }}>–</span>
              <input value={deltaMax} onChange={e => setDeltaMax(e.target.value)} type="number" step="0.01" min="0" max="1" placeholder="Max (e.g. 0.50)" style={inSt} />
            </div>
          </div>

          {/* IV range */}
          <div>
            <label style={lbSt}>IV range (%)</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 6, alignItems: 'center' }}>
              <input value={ivMin} onChange={e => setIvMin(e.target.value)} type="number" placeholder="Min (e.g. 20)" style={inSt} />
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)' }}>–</span>
              <input value={ivMax} onChange={e => setIvMax(e.target.value)} type="number" placeholder="Max (e.g. 60)" style={inSt} />
            </div>
          </div>

          {/* Min open interest */}
          <div>
            <label style={lbSt}>Min open interest</label>
            <input value={minOI} onChange={e => setMinOI(e.target.value)} type="number" placeholder="e.g. 100" style={inSt} />
          </div>

          {/* Quick presets */}
          <div>
            <label style={lbSt}>Quick presets</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {[
                { label: '30Δ Calls (CC)', fn: () => { setOptionType('CALL'); setDeltaMin('0.25'); setDeltaMax('0.35') } },
                { label: '30Δ Puts (CSP)', fn: () => { setOptionType('PUT');  setDeltaMin('0.25'); setDeltaMax('0.35') } },
                { label: 'ATM ±5%',        fn: () => { setStrikeMin(Math.round(spot*0.95).toString()); setStrikeMax(Math.round(spot*1.05).toString()) } },
                { label: 'OTM only',       fn: () => { setDeltaMin('0'); setDeltaMax('0.45') } },
                { label: 'High OI (500+)', fn: () => setMinOI('500') },
              ].map(p => (
                <button key={p.label} onClick={p.fn}
                  style={{ fontSize: 9, padding: '2px 8px', borderRadius: 20, border: '1px solid var(--border)', background: 'none', color: 'var(--text-4)', cursor: 'pointer', fontFamily: 'inherit' }}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {error && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--signal-bear)', padding: '6px 8px', background: 'rgba(185,28,28,0.05)', border: '1px solid rgba(185,28,28,0.15)', borderRadius: 'var(--r-md)' }}>{error}</div>}

          <button onClick={search} disabled={searching}
            style={{ padding: '7px', fontWeight: 600, fontFamily: 'inherit', fontSize: 'var(--fs-sm)', borderRadius: 'var(--r-md)', cursor: searching ? 'not-allowed' : 'pointer', opacity: searching ? 0.5 : 1, background: 'rgba(37,99,235,0.1)', border: '1px solid rgba(37,99,235,0.35)', color: 'var(--color-info)' }}>
            {searching ? 'Searching…' : 'Search options'}
          </button>
        </div>
      </div>
    </>
  )
}


// ── Conditional Order Modal ──────────────────────────────────────────────────

// Create a conditional order that executes when market conditions are met


interface Props {
  ticker:       string
  currentPrice: number
  suggestion?:  any   // AI-generated suggestion to pre-fill
  onClose:      () => void
  onCreated:    () => void
}

function ConditionalOrderModal({ ticker, currentPrice, suggestion, onClose, onCreated }: Props) {
  const [mode,          setMode]          = useState<'immediate'|'conditional'>(suggestion?.mode ?? 'conditional')
  const [side,          setSide]          = useState<'BUY'|'SELL'>(suggestion?.side ?? 'BUY')
  const [qty,           setQty]           = useState('1')
  const [orderType,     setOrderType]     = useState<'LIMIT'|'MARKET'>(suggestion?.order_type ?? 'LIMIT')
  const [limitPrice,    setLimitPrice]    = useState(suggestion?.limit_price ? String(suggestion.limit_price) : '')
  const [priceAbove,    setPriceAbove]    = useState(suggestion?.price_above  ? String(suggestion.price_above)  : '')
  const [priceBelow,    setPriceBelow]    = useState(suggestion?.price_below  ? String(suggestion.price_below)  : '')
  const [notBeforeTime, setNotBeforeTime] = useState(suggestion?.not_before_time ?? '10:00')
  const [expiresIn,     setExpiresIn]     = useState('1d')
  const [notes,         setNotes]         = useState(suggestion?.rationale ?? '')
  const [allow24h,      setAllow24h]      = useState(suggestion?.allow_24h ?? false)
  const [saving,        setSaving]        = useState(false)
  const [error,         setError]         = useState('')

  const expiresAt = (() => {
    const d = new Date()
    if (expiresIn === '1d') d.setDate(d.getDate() + 1)
    else if (expiresIn === '3d') d.setDate(d.getDate() + 3)
    else if (expiresIn === '1w') d.setDate(d.getDate() + 7)
    else if (expiresIn === '1m') d.setMonth(d.getMonth() + 1)
    else return null
    return d.toISOString()
  })()

  async function create() {
    if (!qty || parseInt(qty) < 1) { setError('Enter valid quantity'); return }
    if (orderType === 'LIMIT' && !limitPrice) { setError('Enter limit price'); return }
    if (mode === 'conditional' && !priceAbove && !priceBelow) { setError('Set at least one price condition'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/orders/conditional', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker,
          side,
          qty:             parseInt(qty),
          order_type:      orderType,
          limit_price:     limitPrice ? parseFloat(limitPrice) : null,
          price_above:     mode === 'conditional' && priceAbove ? parseFloat(priceAbove) : null,
          price_below:     mode === 'conditional' && priceBelow ? parseFloat(priceBelow) : null,
          not_before_time: notBeforeTime,
          expires_at:      expiresAt,
          allow_24h:       allow24h,
          notes:           notes || (mode === 'immediate' ? 'Immediate — execute at market open' : null),
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to create'); return }
      onCreated(); onClose()
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  const inSt: React.CSSProperties = {
    padding: '5px 8px', background: 'var(--bg-subtle)', border: '1px solid var(--border)',
    borderRadius: 'var(--r-md)', color: 'var(--text)', fontSize: 'var(--fs-sm)',
    fontFamily: 'inherit', width: '100%', outline: 'none', boxSizing: 'border-box',
  }
  const lbSt: React.CSSProperties = {
    fontSize: 9, fontWeight: 500, color: 'var(--text-4)', textTransform: 'uppercase',
    letterSpacing: '0.07em', display: 'block', marginBottom: 3,
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.5)' }} />
      <div onClick={e => e.stopPropagation()} style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 401, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '1.2rem', width: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', maxHeight: '90vh', overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
              Conditional Order
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 600 }}>{ticker}</div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', marginTop: 1 }}>
              Current price: ${currentPrice.toFixed(2)} · Monitors every minute during market hours
            </div>
            {suggestion && (
              <div style={{ marginTop: 6, padding: '4px 8px', background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.2)', borderRadius: 'var(--r-md)', fontSize: 9, color: 'var(--color-info)' }}>
                ✦ AI suggested — review and adjust before creating
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: '1.2rem' }}>×</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Mode selector */}
          <div style={{ display: 'flex', gap: 4 }}>
            {([['immediate', '⚡ Immediate', 'Execute at next market open'], ['conditional', '⏱ Conditional', 'Execute when price condition is met']] as const).map(([m, label, desc]) => (
              <button key={m} onClick={() => setMode(m as any)} style={{ flex: 1, padding: '7px 8px', borderRadius: 'var(--r-md)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'var(--fs-xs)', textAlign: 'left', background: mode === m ? 'rgba(37,99,235,0.08)' : 'none', border: `1px solid ${mode === m ? 'rgba(37,99,235,0.35)' : 'var(--border)'}`, color: mode === m ? 'var(--color-info)' : 'var(--text-4)' }}>
                <div style={{ fontWeight: 600, marginBottom: 1 }}>{label}</div>
                <div style={{ fontSize: 8, opacity: 0.8 }}>{desc}</div>
              </button>
            ))}
          </div>

          {/* Immediate info */}
          {mode === 'immediate' && (
            <div style={{ padding: '7px 10px', background: 'rgba(37,99,235,0.04)', border: '1px solid rgba(37,99,235,0.15)', borderRadius: 'var(--r-md)', fontSize: 'var(--fs-xs)', color: 'var(--text-3)', lineHeight: 1.6 }}>
              Order will execute at <strong>next market open (9:30am ET)</strong> or at the specified time. No price condition required.
            </div>
          )}

          {/* Side */}
          <div style={{ display: 'flex', gap: 4 }}>
            {(['BUY','SELL'] as const).map(s => (
              <button key={s} onClick={() => setSide(s)} style={{ flex: 1, padding: '5px', borderRadius: 'var(--r-md)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 'var(--fs-sm)', background: side === s ? (s === 'BUY' ? 'rgba(21,128,61,0.1)' : 'rgba(185,28,28,0.1)') : 'none', border: `1px solid ${side === s ? (s === 'BUY' ? 'rgba(21,128,61,0.4)' : 'rgba(185,28,28,0.4)') : 'var(--border)'}`, color: side === s ? (s === 'BUY' ? 'var(--signal-bull)' : 'var(--signal-bear)') : 'var(--text-4)' }}>
                {s}
              </button>
            ))}
          </div>

          {/* Qty + Order type */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={lbSt}>Quantity</label>
              <input value={qty} onChange={e => setQty(e.target.value)} type="number" min="1" style={inSt} />
            </div>
            <div>
              <label style={lbSt}>Order type</label>
              <select value={orderType} onChange={e => setOrderType(e.target.value as any)} style={inSt}>
                <option value="LIMIT">Limit</option>
                <option value="MARKET">Market</option>
              </select>
            </div>
          </div>

          {/* Limit price */}
          {orderType === 'LIMIT' && (
            <div>
              <label style={lbSt}>Limit price ($)</label>
              <input value={limitPrice} onChange={e => setLimitPrice(e.target.value)} type="number" step="0.01" placeholder={currentPrice.toFixed(2)} style={inSt} />
            </div>
          )}

          {/* Divider */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 500, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              Execute when ALL conditions are met
            </div>

            {/* Price conditions — conditional mode only */}
            {mode === 'conditional' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                <div>
                  <label style={lbSt}>Price rises above ($)</label>
                  <input value={priceAbove} onChange={e => setPriceAbove(e.target.value)} type="number" step="0.01" placeholder="Optional" style={inSt} />
                </div>
                <div>
                  <label style={lbSt}>Price drops below ($)</label>
                  <input value={priceBelow} onChange={e => setPriceBelow(e.target.value)} type="number" step="0.01" placeholder="Optional" style={inSt} />
                </div>
              </div>
            )}

          {/* Time gate + 24H override */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={lbSt}>Not before (ET time)</label>
              <select value={notBeforeTime} onChange={e => setNotBeforeTime(e.target.value)} style={inSt}>
                <option value="09:30">09:30 (market open)</option>
                <option value="10:00">10:00 (30 min after open)</option>
                <option value="10:30">10:30 (1 hr after open)</option>
                <option value="11:00">11:00</option>
                <option value="12:00">12:00 (noon)</option>
                <option value="14:00">14:00</option>
                <option value="15:00">15:00 (1 hr before close)</option>
                <option value="">N/A — any time (testing)</option>
                <option value="15:30">15:30 (30 min before close)</option>
              </select>
            </div>
            <div>
              <label style={lbSt}>Expires in</label>
              <select value={expiresIn} onChange={e => setExpiresIn(e.target.value)} style={inSt}>
                <option value="1d">1 day</option>
                <option value="3d">3 days</option>
                <option value="1w">1 week</option>
                <option value="1m">1 month</option>
                <option value="never">Never</option>
              </select>
            </div>
          </div>

          {/* 24H override */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: allow24h ? 'rgba(37,99,235,0.04)' : 'var(--bg-subtle)', border: `1px solid ${allow24h ? 'rgba(37,99,235,0.2)' : 'var(--border)'}`, borderRadius: 'var(--r-md)' }}>
            <div>
              <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 500, color: 'var(--text)', marginBottom: 1 }}>🕐 Allow 24H trading</div>
              <div style={{ fontSize: 9, color: 'var(--text-4)', lineHeight: 1.5 }}>
                Trigger outside market hours (pre/after market)<br/>
                <span style={{ color: 'var(--text-3)' }}>Time gate above still applies to US ET</span>
              </div>
            </div>
            <button onClick={() => setAllow24h((v: boolean) => !v)}
              style={{ flexShrink: 0, marginLeft: 12, width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer', background: allow24h ? 'var(--color-info)' : 'var(--border)', position: 'relative', transition: 'background 0.2s' }}>
              <span style={{ position: 'absolute', top: 1, left: allow24h ? 19 : 1, width: 20, height: 20, borderRadius: '50%', background: 'white', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
            </button>
          </div>
          </div>

          {/* Summary */}
          <div style={{ padding: '8px 10px', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', fontSize: 'var(--fs-xs)', color: 'var(--text-3)', lineHeight: 1.7 }}>
            <strong style={{ color: 'var(--text)' }}>Summary: </strong>
            {side} {qty} {ticker} {orderType === 'LIMIT' ? `@ $${limitPrice || '?'}` : 'at market'}
            {mode === 'immediate'
              ? ` · execute at ${notBeforeTime} ET on next trading day`
              : `${priceBelow ? ` when price drops below $${priceBelow}` : ''}${priceAbove ? ` when price rises above $${priceAbove}` : ''} · not before ${notBeforeTime} ET`}
            {expiresIn !== 'never' ? ` · expires in ${expiresIn}` : ''}
          </div>

          {/* Notes */}
          <div>
            <label style={lbSt}>Notes (optional)</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Buy the dip after earnings" style={inSt} />
          </div>

          {error && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--signal-bear)', padding: '6px 8px', background: 'rgba(185,28,28,0.05)', border: '1px solid rgba(185,28,28,0.15)', borderRadius: 'var(--r-md)' }}>{error}</div>}

          <button onClick={create} disabled={saving}
            style={{ padding: '7px', fontWeight: 600, fontFamily: 'inherit', fontSize: 'var(--fs-sm)', borderRadius: 'var(--r-md)', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.5 : 1, background: side === 'BUY' ? 'rgba(21,128,61,0.1)' : 'rgba(185,28,28,0.1)', border: `1px solid ${side === 'BUY' ? 'rgba(21,128,61,0.35)' : 'rgba(185,28,28,0.35)'}`, color: side === 'BUY' ? 'var(--signal-bull)' : 'var(--signal-bear)' }}>
            {saving ? 'Creating…' : mode === 'immediate' ? `Schedule ${side} at ${notBeforeTime} ET` : `Create conditional ${side} order`}
          </button>
        </div>
      </div>
    </>
  )
}

// ── Option Order Modal ────────────────────────────────────────────────────────

function OptionOrderModal({ order, onClose, onPlaced }: {
  order:    { code: string; strike: number; type: 'call'|'put'; bid: number; ask: number; expiry: string; ticker: string }
  onClose:  () => void
  onPlaced: () => void
}) {
  const [side,     setSide]     = useState<'BUY'|'SELL'>('BUY')
  const [qty,      setQty]      = useState('1')
  const [price,    setPrice]    = useState(order.ask > 0 ? order.ask.toFixed(2) : '')
  const [placing,  setPlacing]  = useState(false)
  const [error,    setError]    = useState('')
  const [result,   setResult]   = useState<any>(null)

  const estTotal   = qty && price ? parseFloat(qty) * parseFloat(price) * 100 : null
  const isCall     = order.type === 'call'
  const typeColor  = isCall ? 'var(--signal-bull)' : 'var(--signal-bear)'

  async function place() {
    if (!qty || !price) { setError('Enter quantity and price'); return }
    setPlacing(true); setError('')
    try {
      const res = await fetch('/api/broker/options/order', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: order.code, side, qty: parseInt(qty), order_type: 'LIMIT', limit_price: parseFloat(price) }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.detail ?? data.error ?? 'Order failed'); return }
      setResult(data)
    } catch (e: any) { setError(e.message) }
    finally { setPlacing(false) }
  }

  const inSt: React.CSSProperties = { padding: '5px 8px', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text)', fontSize: 'var(--fs-sm)', fontFamily: 'inherit', width: '100%', outline: 'none', boxSizing: 'border-box' }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.5)' }} />
      <div onClick={e => e.stopPropagation()} style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 401, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '1.2rem', width: 380, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Options Order · Moomoo</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 600 }}>{order.ticker}</span>
              <span style={{ fontSize: 'var(--fs-sm)', color: typeColor, fontWeight: 500 }}>${order.strike} {order.type.toUpperCase()}</span>
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)' }}>{order.expiry.slice(0,10)}</span>
            </div>
            <div style={{ fontSize: 9, color: 'var(--text-4)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>{order.code}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: '1.2rem' }}>×</button>
        </div>

        {result ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ padding: '12px', background: 'rgba(21,128,61,0.05)', border: '1px solid rgba(21,128,61,0.2)', borderRadius: 'var(--r-lg)' }}>
              <div style={{ color: 'var(--signal-bull)', fontWeight: 600, marginBottom: 8 }}>✓ Option order placed</div>
              {[['Order ID', result.order_id], ['Side', result.side], ['Contracts', result.qty], ['Premium', `$${result.price}/share`], ['Total', `$${(result.qty * result.price * 100).toFixed(2)}`], ['Account', result.trd_env]].map(([l,v]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-xs)', padding: '2px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  <span style={{ color: 'var(--text-4)' }}>{l}</span>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{v}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setResult(null)} style={{ flex: 1, padding: '6px', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-3)', fontSize: 'var(--fs-sm)', cursor: 'pointer', fontFamily: 'inherit' }}>Place another</button>
              <button onClick={() => { onPlaced(); onClose() }} style={{ flex: 1, padding: '6px', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text)', fontSize: 'var(--fs-sm)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>Done</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Bid/Ask reference */}
            <div style={{ display: 'flex', gap: 10, padding: '8px 10px', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', fontSize: 'var(--fs-xs)' }}>
              <div><span style={{ color: 'var(--text-4)' }}>Bid </span><span style={{ fontFamily: 'var(--font-mono)', color: 'var(--signal-bull)' }}>${order.bid.toFixed(2)}</span></div>
              <div><span style={{ color: 'var(--text-4)' }}>Ask </span><span style={{ fontFamily: 'var(--font-mono)', color: 'var(--signal-bear)' }}>${order.ask.toFixed(2)}</span></div>
              {order.bid === 0 && <div style={{ color: 'var(--signal-neut)', marginLeft: 'auto' }}>⚠ Market closed</div>}
            </div>

            {/* BUY/SELL */}
            <div style={{ display: 'flex', gap: 4 }}>
              {(['BUY','SELL'] as const).map(s => (
                <button key={s} onClick={() => setSide(s)} style={{ flex: 1, padding: '5px', borderRadius: 'var(--r-md)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 'var(--fs-sm)', background: side === s ? (s === 'BUY' ? 'rgba(21,128,61,0.1)' : 'rgba(185,28,28,0.1)') : 'none', border: `1px solid ${side === s ? (s === 'BUY' ? 'rgba(21,128,61,0.4)' : 'rgba(185,28,28,0.4)') : 'var(--border)'}`, color: side === s ? (s === 'BUY' ? 'var(--signal-bull)' : 'var(--signal-bear)') : 'var(--text-4)' }}>{s}</button>
              ))}
            </div>

            {/* Qty + Price */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <div style={{ fontSize: 9, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>Contracts</div>
                <input value={qty} onChange={e => setQty(e.target.value)} type="number" min="1" placeholder="1" style={inSt} />
                <div style={{ fontSize: 9, color: 'var(--text-4)', marginTop: 2 }}>1 contract = 100 shares</div>
              </div>
              <div>
                <div style={{ fontSize: 9, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>Limit price ($/share)</div>
                <input value={price} onChange={e => setPrice(e.target.value)} type="number" step="0.01" placeholder="0.00" style={inSt} />
                <div style={{ fontSize: 9, color: 'var(--text-4)', marginTop: 2 }}>Premium per share</div>
              </div>
            </div>

            {/* Estimated total */}
            {estTotal !== null && (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 10px', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', fontSize: 'var(--fs-xs)' }}>
                <span style={{ color: 'var(--text-4)' }}>Estimated {side === 'BUY' ? 'debit' : 'credit'}</span>
                <strong style={{ fontFamily: 'var(--font-mono)' }}>${estTotal.toFixed(2)}</strong>
              </div>
            )}

            {error && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--signal-bear)', padding: '6px 8px', background: 'rgba(185,28,28,0.05)', border: '1px solid rgba(185,28,28,0.15)', borderRadius: 'var(--r-md)' }}>{error}</div>}

            <button onClick={place} disabled={placing || !qty || !price}
              style={{ padding: '7px', fontWeight: 600, fontFamily: 'inherit', fontSize: 'var(--fs-sm)', borderRadius: 'var(--r-md)', cursor: placing || !qty || !price ? 'not-allowed' : 'pointer', opacity: placing || !qty || !price ? 0.5 : 1, background: side === 'BUY' ? 'rgba(21,128,61,0.1)' : 'rgba(185,28,28,0.1)', border: `1px solid ${side === 'BUY' ? 'rgba(21,128,61,0.35)' : 'rgba(185,28,28,0.35)'}`, color: side === 'BUY' ? 'var(--signal-bull)' : 'var(--signal-bear)' }}>
              {placing ? 'Placing…' : `Place ${side} order · ${order.type.toUpperCase()}`}
            </button>
          </div>
        )}
      </div>
    </>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WorkspaceClient() {
  const params        = useSearchParams()
  const portfolioId   = params.get('portfolio_id')

  const [portfolio,   setPortfolio]   = useState<Portfolio | null>(null)
  const [watchlist,   setWatchlist]   = useState<WatchlistItem[]>([])
  const [holdings,    setHoldings]    = useState<Holding[]>([])
  const [selected,    setSelected]    = useState<Holding | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [centerTab,   setCenterTab]   = useState<'overview' | 'chain' | 'builder' | 'dca'>('overview')
  const [expiryIdx,   setExpiryIdx]   = useState(0)
  const [staged,      setStaged]      = useState<StagedTrade | null>(null)
  const [selStrat,    setSelStrat]    = useState<number | null>(null)
  const [dcaCap,      setDcaCap]      = useState('20000')
  const [dcaN,        setDcaN]        = useState('6')
  const [dcaSched,    setDcaSched]    = useState<any[]>([])
  const [stagedDCA,   setStagedDCA]   = useState<Set<number>>(new Set())
  const [dcaOrders,   setDcaOrders]   = useState<DCAOrder[]>([])
  const [showDCAStage, setShowDCAStage] = useState<{ row: any; idx: number } | null>(null)
  const [showDCAManager, setShowDCAManager] = useState(false)
  const [messages,    setMessages]    = useState<ChatMessage[]>([])
  const [chatInput,   setChatInput]   = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [apiKey,      setApiKey]      = useState('')
  const [signals,     setSignals]     = useState<Record<string, { price_usd: number | null; change_pct: number | null; iv_rank?: number | null }>>({})
  const [realChain,   setRealChain]   = useState<any[] | null>(null)
  const [chainLoading,setChainLoading] = useState(false)
  const [showSearch,  setShowSearch]   = useState(false)
  const [searchResults,setSearchResults] = useState<any[] | null>(null)
  const [searching,   setSearching]    = useState(false)
  const [realExpiries,setRealExpiries] = useState<string[]>([])
  const [brokerOnline,setBrokerOnline] = useState(false)
  const [moomooFunds, setMoomooFunds]  = useState<any>(null)
  const [volData,     setVolData]      = useState<any>(null)
  const [chainError,  setChainError]   = useState('')
  const [showConditional, setShowConditional] = useState(false)
  const [showPMCC,        setShowPMCC]        = useState(false)
  const [showAI,          setShowAI]          = useState(false)
  const [optionOrder, setOptionOrder]  = useState<{
    code: string; strike: number; type: 'call' | 'put'
    bid: number; ask: number; expiry: string; ticker: string
  } | null>(null)
  const chatRef = useRef<HTMLDivElement>(null)
  const taRef   = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    async function load() {
      try {
        const url = portfolioId ? `/api/portfolio?portfolio_id=${portfolioId}` : '/api/portfolio'
        const [res, wlRes] = await Promise.all([
          fetch(url),
          portfolioId ? fetch(`/api/portfolio/watchlist?portfolio_id=${portfolioId}`) : Promise.resolve(null),
        ])
        if (!res.ok) return
        const d = await res.json()

        // Save watchlist data before it's consumed
        let watchlistData: any[] = []
        if (wlRes?.ok) {
          const wlData = await wlRes.json()
          watchlistData = wlData.watchlist ?? []
          setWatchlist(watchlistData)
        }
        // Load API key + fetch watchlist signals in parallel
        const keyRes = await fetch('/api/user/settings')
        if (keyRes.ok) {
          const kd = await keyRes.json()
          if (kd.profile?.anthropic_api_key) setApiKey(kd.profile.anthropic_api_key)
        }
        // Fetch live buying power from broker bridge
        try {
          const fundsRes = await fetch('/api/broker/account/funds')
          if (fundsRes.ok) {
            const fd = await fundsRes.json()
            setMoomooFunds(fd)
          }
        } catch {}

        // Build signal map from holdings + fetch any watchlist tickers not in holdings
        const raw = (d.holdings ?? []).map((h: any) => ({
          ...h,
          quantity:        parseFloat(h.quantity)        || 0,
          avg_cost:        parseFloat(h.avg_cost)        || 0,
          unrealised_gain: parseFloat(h.unrealised_gain) || 0,
          realised_gain:   parseFloat(h.realised_gain)   || 0,
        })).filter((h: Holding) => h.quantity > 0 && h.ticker !== 'CASH')
        setHoldings(raw)
        if (d.portfolio) setPortfolio({ id: d.portfolio.id, name: d.portfolio.name, total_capital: parseFloat(d.portfolio.total_capital) || 0, cash_pct: parseFloat(d.portfolio.cash_pct) || 0 })
        if (raw.length > 0) setSelected(raw[0])

        // Build signal map: holdings already have signals, fetch extras for watchlist
        const holdingSignalMap: Record<string, any> = {}
        raw.forEach((hh: any) => { if (hh.signal) holdingSignalMap[hh.ticker] = hh.signal })
        setSignals(holdingSignalMap)

        // Fetch prices for watchlist tickers not already in holdings
        const extraTickers = watchlistData
          .map((w: any) => w.ticker)
          .filter((t: string) => !holdingSignalMap[t])
        if (extraTickers.length > 0) {
          try {
            const sigRes = await fetch(`/api/signals?tickers=${extraTickers.join(',')}`)
            if (sigRes.ok) {
              const sigData = await sigRes.json()
              const extra: Record<string, any> = {}
              ;(sigData.signals ?? []).forEach((s: any) => { extra[s.ticker] = s })
              setSignals(prev => ({ ...prev, ...extra }))
            }
          } catch {}
        }
      } catch {}
      finally { setLoading(false) }
    }
    load()
  }, [portfolioId])

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [messages, chatLoading])

  // h must be declared before effects that depend on it
  const h = selected

  // Fetch volatility data when selected holding changes
  useEffect(() => {
    const ticker = selected?.ticker
    if (!ticker || ticker === 'CASH') return
    setVolData(null)
    fetch(`/api/signals/volatility?ticker=${ticker}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && !d.error) setVolData(d) })
      .catch(() => {})
  }, [selected?.ticker])

  // Fetch real option expiries when selected holding changes
  useEffect(() => {
    const ticker = selected?.ticker
    if (!ticker) return
    setRealExpiries([]); setRealChain(null); setBrokerOnline(false)
    fetch(`/api/broker/options/expiries?symbol=US.${ticker}`)
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(d => {
        if (d?.expiries?.length) {
          setRealExpiries(d.expiries)
          setBrokerOnline(true)
          setChainError('')
          console.log('[chain] expiries loaded:', d.expiries.slice(0,5))
          // Auto-select first expiry with DTE > 0 (skip today's expiry)
          const today = new Date().toISOString().slice(0,10)
          const firstValid = d.expiries.findIndex((e: string) => e.slice(0,10) > today)
          setExpiryIdx(firstValid >= 0 ? firstValid : 0)
        } else {
          setBrokerOnline(false)
          setChainError('No expiries returned from bridge')
        }
      })
      .catch(e => { setBrokerOnline(false); setChainError(`Expiry fetch failed: ${e}`) })
  }, [selected?.ticker])

  // Fetch real option chain when expiry index or expiries list changes
  useEffect(() => {
    const ticker = selected?.ticker
    if (!ticker || realExpiries.length === 0) return
    const expiry = realExpiries[Math.min(expiryIdx, realExpiries.length - 1)]
    if (!expiry) return
    setChainLoading(true); setRealChain(null)
    console.log('[chain] fetching:', `/api/broker/options/chain?symbol=US.${ticker}&expiry=${expiry.slice(0,10)}`)
    fetch(`/api/broker/options/chain?symbol=US.${ticker}&expiry=${expiry.slice(0,10)}&strike_count=0`)
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(d => {
        console.log('[chain] rows:', d?.rows?.length, 'sample:', d?.rows?.[0])
        setRealChain(d?.rows?.length > 0 ? d.rows : null)
        if (!d?.rows?.length) setChainError('Chain returned no rows')
      })
      .catch(e => { console.error('[chain] error:', e); setRealChain(null); setChainError(`Chain fetch failed: ${e}`) })
      .finally(() => setChainLoading(false))
  }, [selected?.ticker, expiryIdx, realExpiries])

  // Portfolio financials
  const totalInvested   = holdings.reduce((s, hh) => s + (hh.signal?.price_usd ?? hh.avg_cost) * hh.quantity, 0)
  const totalCostBasis  = holdings.reduce((s, hh) => s + hh.avg_cost * hh.quantity, 0)
  const totalUnrealised = holdings.reduce((s, hh) => {
    const p = hh.signal?.price_usd ?? hh.avg_cost
    return s + (p - hh.avg_cost) * hh.quantity
  }, 0)
  const totalRealised   = holdings.reduce((s, hh) => s + (hh.realised_gain || 0), 0)
  const portfolioCapital = portfolio?.total_capital || totalInvested
  const cashAvail       = Math.max(0, portfolioCapital - totalInvested)
  const deployedPct     = portfolioCapital > 0 ? (totalInvested / portfolioCapital * 100) : 0

  // Derived — use signals map for price (covers watchlist items with no holdings signal)
  const sigData  = h ? (h.signal ?? signals[h.ticker] ?? null) : null
  const price    = (sigData as any)?.price_usd ?? (h?.avg_cost && h.avg_cost > 0 ? h.avg_cost : 0)
  const chain    = realChain ?? (h ? buildChain(price, 20, 30) : [])
  const usingRealChain = realChain !== null

  // Compute live IV from real chain ATM strike (average of call + put IV)
  const liveIV = (() => {
    if (!realChain || realChain.length === 0) return null
    const atm = realChain.reduce((best: any, row: any) =>
      Math.abs(row.strike - price) < Math.abs(best.strike - price) ? row : best
    , realChain[0])
    const callIV = atm?.call_iv ?? 0
    const putIV  = atm?.put_iv  ?? 0
    const avg    = callIV > 0 && putIV > 0 ? (callIV + putIV) / 2 : callIV || putIV
    return avg > 0 ? Math.round(avg) : null
  })()

  // IV: prefer live chain ATM IV → volData → signal → mock
  const iv       = liveIV ?? volData?.iv ?? (h ? ((sigData as any)?.iv_rank ?? (sigData as any)?.score ?? getIV(h.ticker)) : 20)
  const ivRank   = volData?.iv_rank ?? null
  const ivPerc   = volData?.iv_percentile ?? null
  const hv30     = volData?.hv_30d ?? null
  const pnlAmt   = h ? (price - h.avg_cost) * h.quantity : 0
  const pnlPct   = h && h.avg_cost > 0 ? (price - h.avg_cost) / h.avg_cost * 100 : 0
  const mktVal   = h ? price * h.quantity : 0
  const strats   = h ? buildStrategies(h, price, iv) : []
  const chips    = h ? (quickChips[h.ticker] ?? quickChips.DEFAULT) : quickChips.DEFAULT

  // AI-suggested conditional order state
  const [aiSuggestedOrder, setAiSuggestedOrder] = useState<any>(null)

  function genDCA() {
    const cap = parseFloat(dcaCap) || 20000, n = parseInt(dcaN) || 6
    let d = new Date(); d.setDate(d.getDate() + 7)
    const rows = Array.from({ length: n }, (_, i) => {
      const pVar = price * (1 + (Math.random() * 0.08 - 0.04))
      const amt = cap / n
      const row = { num: i+1, date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), amount: amt, estPrice: pVar, shares: (amt / pVar).toFixed(3) }
      d = new Date(d.getTime() + 14 * 86400000)
      return row
    })
    setDcaSched(rows); setStagedDCA(new Set())
  }

  async function sendChat(overrideText?: string) {
    const text = (overrideText ?? chatInput).trim()
    if (!text || chatLoading) return
    // API key is handled server-side via /api/ai/chat
    setChatInput('')
    if (taRef.current) taRef.current.style.height = 'auto'
    const userMsg: ChatMessage = { role: 'user', content: text }
    const newHistory = [...messages, userMsg]
    setMessages(newHistory)
    setChatLoading(true)
    const summary = holdings.map(hh => `${hh.ticker}: ${Math.round(hh.quantity)} shares @ $${hh.avg_cost.toFixed(2)}`).join(', ')
    const sys = `You are an AI investment advisor in Quant IQ. Portfolio: ${portfolio?.name ?? 'unknown'}. Holdings: ${summary}. ${h ? `Currently analysing: ${h.ticker} (${Math.round(h.quantity)} shares @ $${h.avg_cost > 0 ? h.avg_cost.toFixed(2) : 'watchlist'}, current $${price.toFixed(2)}, IV Rank ${iv}).` : ''} Be direct, specific, max 250 words. Options: covered calls, CSPs, long options only.`
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1024, system: sys, messages: newHistory.slice(-16) }),
      })
      const data = await res.json()
      if (data.error) setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${data.error}` }])
      else setMessages(prev => [...prev, { role: 'assistant', content: data.content?.[0]?.text ?? 'No response.' }])
    } catch (e: any) { setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${e.message}` }]) }
    setChatLoading(false)
  }

  function fmtAI(text: string) {
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code style="background:rgba(37,99,235,0.1);color:#93c5fd;padding:1px 4px;border-radius:3px;font-size:11px">$1</code>')
      .replace(/^[•\-]\s(.+)$/gm, '<div style="padding-left:10px;margin:2px 0;color:var(--text-3)">· $1</div>')
      .replace(/\n\n/g, '<br/><br/>').replace(/\n/g, '<br/>')
  }

  const inBase: React.CSSProperties = { padding: '5px 8px', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text)', fontSize: 'var(--fs-sm)', outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-4)', fontSize: 'var(--fs-sm)' }}>Loading workspace…</div>
  )

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Page header + Portfolio financials ── */}
      <div style={{ borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        {/* Title row */}
        <div className="page-header" style={{ padding: '8px 16px' }}>
          <div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 1 }}>Workspace</div>
            <div className="page-title">{portfolio?.name ?? 'Portfolio'}</div>
          </div>
          {staged && (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)' }}>Staged: <strong style={{ color: 'var(--text)' }}>{staged.ticker} {staged.type}</strong></span>
              <button onClick={() => setStaged(null)} style={{ padding: '3px 8px', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-4)', fontSize: 'var(--fs-xs)', cursor: 'pointer', fontFamily: 'inherit' }}>Clear</button>
              <button onClick={() => { alert(`Sending to Moomoo:\n${staged.ticker} ${staged.type}\n${staged.legs ?? staged.description}`); setStaged(null) }}
                style={{ padding: '3px 10px', background: 'rgba(21,128,61,0.1)', border: '1px solid rgba(21,128,61,0.3)', borderRadius: 'var(--r-md)', color: 'var(--signal-bull)', fontSize: 'var(--fs-xs)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
                Send to Moomoo →
              </button>
            </div>
          )}
        </div>

        {/* Financials bar */}
        <div style={{ display: 'flex', gap: 0, borderTop: '1px solid var(--border)', overflowX: 'auto' }}>
          {[
            ...(moomooFunds?.currencies ?? [])
              .filter((c: any) => c.assets > 0 && ['USD','AUD'].includes(c.currency))
              .map((c: any) => ({
                l: `${c.currency} Assets`, v: `${c.currency} ${c.assets.toLocaleString('en-US',{maximumFractionDigits:0})}`, s: null,
              })),
            ...(moomooFunds?.currencies ?? [])
              .filter((c: any) => c.cash > 0 && ['USD','AUD'].includes(c.currency))
              .map((c: any) => ({
                l: `${c.currency} Cash`, v: `${c.currency} ${c.cash.toLocaleString('en-US',{maximumFractionDigits:0})}`, s: 'Available', vc: 'var(--color-info)',
              })),
            ...(!moomooFunds ? [
              { l: 'Total capital',  v: fmt(portfolioCapital), s: null },
              { l: 'Cash available', v: fmt(cashAvail), s: `${(100-deployedPct).toFixed(1)}% idle`, vc: 'var(--color-info)' },
            ] : []),
            { l: 'Current value',  v: fmt(totalInvested),                                                s: `${holdings.length} positions` },
            { l: 'Unrealised P&L', v: `${totalUnrealised >= 0 ? '+' : ''}${fmt(Math.abs(totalUnrealised))}`, s: `${totalUnrealised >= 0 ? '+' : ''}${portfolioCapital > 0 ? (totalUnrealised / portfolioCapital * 100).toFixed(2) : '0.00'}%`, vc: totalUnrealised >= 0 ? 'var(--signal-bull)' : 'var(--signal-bear)' },
            { l: 'Realised P&L',   v: `${totalRealised >= 0 ? '+' : ''}${fmt(Math.abs(totalRealised))}`,     s: 'Closed', vc: totalRealised >= 0 ? 'var(--signal-bull)' : 'var(--signal-bear)' },
          ].map((m, i) => (
            <div key={m.l} style={{ flex: '1 1 0', padding: '7px 14px', borderRight: '1px solid var(--border)', minWidth: 110 }}>
              <div style={{ fontSize: 8, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>{m.l}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 400, color: (m as any).vc ?? 'var(--text)' }}>{m.v}</div>
              {m.s && <div style={{ fontSize: 9, color: 'var(--text-4)', marginTop: 2 }}>{m.s}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* 3-panel body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0, alignItems: 'stretch' }}>

        {/* ── Panel 1: Watchlist + Holdings ── */}
        <div style={{ width: 220, minWidth: 220, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>

          <div style={{ flex: 1, overflowY: 'auto' }}>

            {/* ── Watchlist section ── */}
            {watchlist.length > 0 && (
              <div>
                <div style={{ padding: '6px 10px 4px', fontSize: 8, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg)' }}>
                  <span style={{ fontSize: 9 }}>🔖</span> Watchlist ({watchlist.length})
                </div>
                {/* Watchlist col headers */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 55px', gap: 4, padding: '4px 10px', borderBottom: '1px solid var(--border-subtle)' }}>
                  {['Ticker', 'Signal'].map(c => (
                    <div key={c} style={{ fontSize: 7, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: c === 'Signal' ? 'right' : 'left' }}>{c}</div>
                  ))}
                </div>
                {watchlist.map(w => {
                  const isSelected = selected?.ticker === w.ticker && !(holdings.find(hh => hh.ticker === w.ticker))
                  return (
                    <div key={w.id}
                      onClick={() => {
                        const existing = holdings.find(hh => hh.ticker === w.ticker)
                        if (existing) { setSelected(existing); setCenterTab('overview'); setSelStrat(null) }
                        else { setSelected({ id: w.id, ticker: w.ticker, quantity: 0, avg_cost: 0, unrealised_gain: 0, realised_gain: 0, signal: null }); setCenterTab('chain'); setSelStrat(null) }
                      }}
                      style={{ display: 'grid', gridTemplateColumns: '1fr 55px', gap: 4, padding: '5px 10px', cursor: 'pointer', alignItems: 'center', borderLeft: `2px solid ${isSelected ? 'rgba(245,158,11,0.6)' : 'transparent'}`, background: isSelected ? 'rgba(245,158,11,0.04)' : 'transparent', transition: 'all 0.1s' }}>
                      <div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text)' }}>{w.ticker}</div>
                        {w.name && <div style={{ fontSize: 9, color: 'var(--text-4)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</div>}
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        {holdings.find(hh => hh.ticker === w.ticker)
                          ? <span style={{ fontSize: 8, background: 'rgba(37,99,235,0.1)', color: 'var(--color-info)', padding: '1px 4px', borderRadius: 2 }}>held</span>
                          : <span style={{ fontSize: 8, color: 'var(--text-4)' }}>watch</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* ── Holdings section ── */}
            <div>
              <div style={{ padding: '6px 10px 4px', fontSize: 8, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg)', position: 'sticky', top: watchlist.length > 0 ? 'auto' : 0 }}>
                <span style={{ fontSize: 9 }}>📊</span> Holdings ({holdings.length})
              </div>
              {/* Holdings col headers */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 46px 58px', gap: 4, padding: '4px 10px', borderBottom: '1px solid var(--border-subtle)' }}>
                {['Ticker', 'Vol', 'Avg Cost'].map(c => (
                  <div key={c} style={{ fontSize: 7, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: c === 'Vol' || c === 'Avg Cost' ? 'right' : 'left' }}>{c}</div>
                ))}
              </div>
              {holdings.map(hh => {
                const p = hh.signal?.price_usd ?? hh.avg_cost
                const isPos = p >= hh.avg_cost
                const isSelected = selected?.id === hh.id
                  return (
                  <div key={hh.id}
                    onClick={() => { setSelected(hh); setCenterTab('overview'); setSelStrat(null) }}
                    style={{ display: 'grid', gridTemplateColumns: '1fr 46px 58px', gap: 4, padding: '5px 10px', cursor: 'pointer', alignItems: 'center', borderLeft: `2px solid ${isSelected ? 'var(--color-info)' : 'transparent'}`, background: isSelected ? 'rgba(37,99,235,0.05)' : 'transparent', transition: 'all 0.1s' }}>

                    <div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text)' }}>{hh.ticker}</div>
                      <div style={{ fontSize: 9, color: isPos ? 'var(--signal-bull)' : 'var(--signal-bear)', marginTop: 1 }}>
                        {hh.avg_cost > 0 ? `${isPos ? '+' : ''}${((p - hh.avg_cost) / hh.avg_cost * 100).toFixed(1)}%` : '—'}
                      </div>
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', textAlign: 'right' }}>
                      {Math.round(hh.quantity).toLocaleString()}
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', textAlign: 'right' }}>
                      ${hh.avg_cost.toFixed(2)}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>


        </div>

        {/* ── Panel 2: Workspace (center) ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0, minHeight: 0 }}>
          {!h ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-4)', fontSize: 'var(--fs-sm)', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 32 }}>←</div>
              <div>Select a holding to analyse</div>
            </div>
          ) : (
            <>
              {/* Holding hero */}
              <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 20, flexShrink: 0, background: 'var(--bg)' }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 300, letterSpacing: '-0.5px' }}>{h.ticker}</div>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', marginTop: 1 }}>
                    {Math.round(h.quantity)} shares{h.avg_cost > 0 ? ` · Avg $${h.avg_cost.toFixed(2)}` : ' · Watchlist'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 18, marginLeft: 'auto', flexWrap: 'wrap' }}>
                  {[
                    { l: 'Price',      v: price > 0 ? `$${price.toFixed(2)}` : '—',            c: 'var(--text)' },
                    { l: 'Mkt value',  v: fmt(mktVal),                                          c: 'var(--text)' },
                    { l: 'P&L',        v: `${pnlAmt >= 0 ? '+' : ''}${fmt(Math.abs(pnlAmt))} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%)`, c: pnlAmt >= 0 ? 'var(--signal-bull)' : 'var(--signal-bear)' },
                    { l: ivRank !== null ? 'IV Rank' : 'IV (ATM)', v: ivRank !== null ? `${ivRank} (IV ${iv.toFixed(0)}%)` : `${iv.toFixed(1)}%`, c: (ivRank ?? iv) > 45 ? 'var(--signal-bear)' : (ivRank ?? iv) < 20 ? 'var(--signal-bull)' : 'var(--signal-neut)' },
                  ].map(m => (
                    <div key={m.l} style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 9, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{m.l}</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', color: m.c, marginTop: 2 }}>{m.v}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tabs */}
              <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 16px', flexShrink: 0, alignItems: 'center' }}>
                {(['overview', 'chain', 'builder', 'dca'] as const).map(t => (
                  <button key={t} onClick={() => setCenterTab(t)} style={{ padding: '7px 11px', fontSize: 'var(--fs-sm)', cursor: 'pointer', border: 'none', borderBottom: `2px solid ${centerTab === t ? 'var(--color-info)' : 'transparent'}`, color: centerTab === t ? 'var(--text)' : 'var(--text-4)', fontWeight: centerTab === t ? 500 : 400, background: 'none', fontFamily: 'inherit', transition: 'all 0.15s' }}>
                    {t === 'overview' ? 'Overview' : t === 'chain' ? 'Option Chain' : t === 'builder' ? 'Trade Builder' : 'DCA'}
                  </button>
                ))}
                <div style={{ flex: 1 }} />
                {h && (
                  <button onClick={() => setShowConditional(true)}
                    style={{ padding: '3px 10px', fontSize: 'var(--fs-xs)', fontFamily: 'inherit', cursor: 'pointer', borderRadius: 'var(--r-md)', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', color: 'var(--signal-neut)', whiteSpace: 'nowrap', fontWeight: 500 }}>
                    ⏱ Conditional
                  </button>
                )}
              </div>

              {/* Tab content */}
              <div style={{ flex: 1, overflowY: 'auto' }}>

                {/* Overview */}
                {centerTab === 'overview' && (
                  <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                      {[
                        { l: 'Position value', v: fmt(mktVal), s: `${Math.round(h.quantity)} shares @ $${price.toFixed(2)}` },
                        { l: 'Cost basis', v: h.avg_cost > 0 ? fmt(h.quantity * h.avg_cost) : '—', s: h.avg_cost > 0 ? `Avg $${h.avg_cost.toFixed(2)}` : 'Watchlist only' },
                        { l: 'Unrealised P&L', v: `${pnlAmt >= 0 ? '+' : ''}${fmt(Math.abs(pnlAmt))}`, s: `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%`, vc: pnlAmt >= 0 ? 'var(--signal-bull)' : 'var(--signal-bear)' },
                        { l: 'IV Rank', v: String(iv), s: iv > 45 ? 'Elevated — sell vol' : iv < 20 ? 'Low — buy options' : 'Moderate' },
                        { l: 'Realised P&L', v: `${h.realised_gain >= 0 ? '+' : ''}${fmt(Math.abs(h.realised_gain))}`, s: 'Closed positions', vc: h.realised_gain >= 0 ? 'var(--signal-bull)' : 'var(--signal-bear)' },
                        { l: 'IV vs HV',      v: hv30 ? (iv > hv30 ? 'IV > HV' : 'IV < HV') : '—', s: hv30 ? (iv > hv30 ? 'Options rich → sell' : 'Options cheap → buy') : 'Awaiting HV data' },
                      ].map(m => (
                        <div key={m.l} style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '9px 11px' }}>
                          <div style={{ fontSize: 9, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{m.l}</div>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 300, color: (m as any).vc ?? 'var(--text)' }}>{m.v}</div>
                          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', marginTop: 2 }}>{m.s}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {[['Option Chain →', 'chain'], ['Strategies →', 'strategies'], ['DCA Plan →', 'dca']].map(([label, tab]) => (
                        <button key={tab} onClick={() => setCenterTab(tab as any)}
                          style={{ flex: 1, padding: '5px 0', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-3)', fontSize: 'var(--fs-sm)', cursor: 'pointer', fontFamily: 'inherit' }}>
                          {label}
                        </button>
                      ))}
                    </div>
                    <div style={{ padding: '9px 11px', background: (ivRank ?? iv) > 40 ? 'rgba(185,28,28,0.04)' : 'rgba(21,128,61,0.04)', border: `1px solid ${(ivRank ?? iv) > 40 ? 'rgba(185,28,28,0.12)' : 'rgba(21,128,61,0.12)'}`, borderRadius: 'var(--r-lg)', fontSize: 'var(--fs-sm)', lineHeight: 1.6, color: 'var(--text-3)' }}>
                      <strong style={{ color: 'var(--text)' }}>
                        IV {iv.toFixed(1)}%{ivRank !== null ? ` · IVR ${ivRank}` : ''}{ivPerc !== null ? ` · IVP ${ivPerc}%` : ''}{hv30 ? ` · HV ${hv30.toFixed(1)}%` : ''} —{' '}
                      </strong>
                      {ivRank !== null
                        ? ivRank > 50
                          ? `IV Rank ${ivRank} is elevated. Premium selling strategies (covered calls, CSPs) will collect above-average income.${hv30 && iv > hv30 ? ' IV > HV confirms options are overpriced.' : ''}`
                          : ivRank < 20
                            ? `IV Rank ${ivRank} is low. Options are cheap relative to history. Good time to buy protective puts or long calls.${hv30 && iv < hv30 ? ' IV < HV confirms options are underpriced.' : ''}`
                            : `IV Rank ${ivRank} is moderate. Standard strategies apply.${hv30 ? ` IV ${iv < hv30 ? '<' : '>'} HV suggests options are ${iv < hv30 ? 'cheap — lean buy' : 'rich — lean sell'}.` : ''}`
                        : iv > 40
                          ? `IV at ${iv.toFixed(1)}% is elevated. Consider selling premium. IV Rank will be available after 20 days of data collection.`
                          : `IV at ${iv.toFixed(1)}% is moderate. IV Rank building up — check back as history accumulates.`}
                    </div>
                  </div>
                )}

                {/* Option Chain */}
                {centerTab === 'chain' && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 16px', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 2 }}>
                      <select value={expiryIdx} onChange={e => setExpiryIdx(Number(e.target.value))}
                        style={{ ...inBase, width: 'auto', height: 27, padding: '0 8px', fontFamily: 'var(--font-mono)' }}>
                        {realExpiries.length > 0
                          ? realExpiries.map((exp, i) => {
                              const d = Math.round((new Date(exp.slice(0,10)).getTime() - Date.now()) / 86400000)
                              return <option key={i} value={i}>{exp.slice(0,10)} ({d}d)</option>
                            })
                          : <option value={0}>{chainLoading ? 'Loading…' : 'No expiries'}</option>
                        }
                      </select>
                      <button onClick={() => setShowSearch(true)}
                        style={{ marginLeft: 'auto', padding: '3px 10px', fontSize: 'var(--fs-xs)', fontFamily: 'inherit', cursor: 'pointer', borderRadius: 'var(--r-md)', background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.25)', color: 'var(--color-info)', fontWeight: 500 }}>
                        🔍 Search
                      </button>
                      {searchResults && (
                        <button onClick={() => setSearchResults(null)}
                          style={{ padding: '3px 8px', fontSize: 'var(--fs-xs)', fontFamily: 'inherit', cursor: 'pointer', borderRadius: 'var(--r-md)', background: 'none', border: '1px solid var(--border)', color: 'var(--text-4)' }}>
                          Clear search
                        </button>
                      )}
                      <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', fontFamily: 'var(--font-mono)' }}>
                        {h.ticker} · ${price.toFixed(2)} · IV {iv}%
                      </span>
                    </div>
                    <div style={{ padding: '0 16px 16px' }}>
                      {/* Column headers */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 64px 1fr', marginTop: 6 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: usingRealChain ? 'repeat(6,1fr)' : 'repeat(5,1fr)', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                          {(usingRealChain ? ['Delta','IV%','Bid','Ask','Vol','OI'] : ['Delta','IV%','Bid','Ask','Vol']).map(c => <div key={c} style={{ fontSize: 8, color: 'var(--text-4)', textAlign: 'right', padding: '0 3px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{c}</div>)}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid var(--border)', fontSize: 8, color: 'var(--text-4)', textTransform: 'uppercase' }}>STRIKE</div>
                        <div style={{ display: 'grid', gridTemplateColumns: usingRealChain ? 'repeat(6,1fr)' : 'repeat(5,1fr)', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                          {(usingRealChain ? ['OI','Vol','Bid','Ask','IV%','Delta'] : ['Vol','Bid','Ask','IV%','Delta']).map(c => <div key={c} style={{ fontSize: 8, color: 'var(--text-4)', textAlign: 'right', padding: '0 3px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{c}</div>)}
                        </div>
                      </div>
                      {searchResults && (
                        <div style={{ padding: '4px 0 6px', fontSize: 9, color: 'var(--text-4)', display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span style={{ background: 'rgba(37,99,235,0.08)', color: 'var(--color-info)', border: '1px solid rgba(37,99,235,0.2)', padding: '1px 6px', borderRadius: 3 }}>
                            {searchResults.length} results
                          </span>
                          <span>Showing search results across {[...new Set(searchResults.map(r => r.expiry))].length} expiries</span>
                        </div>
                      )}

                      {/* Search results — flat row with expiry + type column */}
                      {searchResults && (
                        <div style={{ marginTop: 4 }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '60px 45px 55px 55px 55px 55px 55px 55px 55px', fontSize: 8, color: 'var(--text-4)', textTransform: 'uppercase', padding: '3px 0', borderBottom: '1px solid var(--border)', gap: 2 }}>
                            {['Expiry','Type','Strike','Delta','IV%','Bid','Ask','Vol','OI'].map(c => <div key={c} style={{ textAlign: 'right' }}>{c}</div>)}
                          </div>
                          {searchResults.map((row, i) => (
                            <div key={i} onClick={() => {
                              if (row.code) setOptionOrder({ code: row.code, strike: row.strike, type: row.type === 'CALL' ? 'call' : 'put', bid: row.bid ?? 0, ask: row.ask ?? 0, expiry: row.expiry, ticker: h.ticker })
                            }} style={{ display: 'grid', gridTemplateColumns: '60px 45px 55px 55px 55px 55px 55px 55px 55px', fontSize: 10, fontFamily: 'var(--font-mono)', padding: '4px 0', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer', gap: 2, background: row.type === 'CALL' ? 'rgba(21,128,61,0.02)' : 'rgba(185,28,28,0.02)' }}>
                              <div style={{ textAlign: 'right', color: 'var(--text-4)', fontSize: 9 }}>{row.expiry?.slice(5)}</div>
                              <div style={{ textAlign: 'right', color: row.type === 'CALL' ? 'var(--signal-bull)' : 'var(--signal-bear)', fontWeight: 600, fontSize: 9 }}>{row.type}</div>
                              <div style={{ textAlign: 'right' }}>${row.strike}</div>
                              <div style={{ textAlign: 'right', color: 'var(--text-3)' }}>{Number(row.delta).toFixed(3)}</div>
                              <div style={{ textAlign: 'right', color: 'var(--text-3)' }}>{Number(row.iv).toFixed(1)}%</div>
                              <div style={{ textAlign: 'right' }}>${Number(row.bid).toFixed(2)}</div>
                              <div style={{ textAlign: 'right' }}>${Number(row.ask).toFixed(2)}</div>
                              <div style={{ textAlign: 'right', color: 'var(--text-4)' }}>{(row.vol ?? 0).toLocaleString()}</div>
                              <div style={{ textAlign: 'right', color: 'var(--text-4)' }}>{(row.oi ?? 0).toLocaleString()}</div>
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Regular chain — shown when no search active */}
                      {!searchResults && chain.map((row: any, i: number) => {
                        // Normalise field names — real chain uses snake_case, simulated uses camelCase
                        const cDelta = row.call_delta  ?? row.callDelta ?? 0
                        const cIV    = row.call_iv     ?? row.callIV    ?? 0
                        const cBid   = row.call_bid    ?? row.callBid   ?? 0
                        const cAsk   = row.call_ask    ?? row.callAsk   ?? 0
                        const cVol   = row.call_volume ?? row.callVol   ?? 0
                        const cOI    = row.call_oi     ?? 0
                        const cCode  = row.call_code   ?? ''
                        const pDelta = row.put_delta   ?? row.putDelta  ?? 0
                        const pIV    = row.put_iv      ?? row.putIV     ?? 0
                        const pBid   = row.put_bid     ?? row.putBid    ?? 0
                        const pAsk   = row.put_ask     ?? row.putAsk    ?? 0
                        const pVol   = row.put_volume  ?? row.putVol    ?? 0
                        const pOI    = row.put_oi      ?? 0
                        const isATM  = row.is_atm      ?? row.isATM     ?? false
                        const atmBg: React.CSSProperties = isATM ? { background: 'rgba(245,158,11,0.07)' } : {}
                        const itmBg: React.CSSProperties = (parseFloat(String(cDelta)) > 0.5) && !isATM ? { background: 'rgba(21,128,61,0.03)' } : {}
                        return (
                          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 64px 1fr', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }}
                            onClick={() => {
                              if (usingRealChain && cCode) {
                                setOptionOrder({ code: cCode, strike: row.strike, type: 'call', bid: parseFloat(String(cBid))||0, ask: parseFloat(String(cAsk))||0, expiry: realExpiries[expiryIdx] ?? '', ticker: h.ticker })
                              } else {
                                setStaged({ ticker: h.ticker, type: `Call $${row.strike}`, description: `${cDelta}Δ IV ${cIV}%`, premium: `$${cAsk}`, strike: `$${row.strike}`, expiry: realExpiries[expiryIdx] ?? '' })
                              }
                            }}>
                            <div style={{ display: 'grid', gridTemplateColumns: usingRealChain ? 'repeat(6,1fr)' : 'repeat(5,1fr)', ...atmBg, ...itmBg }}>
                              {(usingRealChain
                                ? [String(cDelta), String(cIV)+'%', '$'+Number(cBid).toFixed(2), '$'+Number(cAsk).toFixed(2), fmtN(cVol), fmtN(cOI)]
                                : [String(cDelta), String(cIV)+'%', '$'+Number(cBid).toFixed(2), '$'+Number(cAsk).toFixed(2), fmtN(cVol)]
                              ).map((v, j) => (
                                <div key={j} style={{ padding: '4px 3px', fontSize: 10, textAlign: 'right', fontFamily: 'var(--font-mono)', color: j === 0 ? (parseFloat(String(cDelta)) > 0.5 ? 'var(--signal-bull)' : 'var(--text-3)') : 'var(--text-3)' }}>{v}</div>
                              ))}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', ...atmBg, padding: '2px 0' }}>
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, color: isATM ? 'var(--signal-neut)' : 'var(--text)', background: isATM ? 'rgba(245,158,11,0.15)' : 'transparent', padding: '1px 4px', borderRadius: 2 }}>${row.strike}</span>
                              {usingRealChain && cCode && <span style={{ fontSize: 6, color: 'var(--text-4)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>{cCode.slice(-8)}</span>}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: usingRealChain ? 'repeat(6,1fr)' : 'repeat(5,1fr)', ...atmBg }}>
                              {(usingRealChain
                                ? [fmtN(pOI), fmtN(pVol), '$'+Number(pBid).toFixed(2), '$'+Number(pAsk).toFixed(2), String(pIV)+'%', String(pDelta)]
                                : [fmtN(pVol), '$'+Number(pBid).toFixed(2), '$'+Number(pAsk).toFixed(2), String(pIV)+'%', String(pDelta)]
                              ).map((v, j) => (
                                <div key={j} style={{ padding: '4px 3px', fontSize: 10, textAlign: 'right', fontFamily: 'var(--font-mono)', color: j === (usingRealChain ? 5 : 4) ? (parseFloat(String(pDelta)) < -0.5 ? 'var(--signal-bear)' : 'var(--text-3)') : 'var(--text-3)' }}>{v}</div>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Trade Builder — 2 column: search left, strategy advisory right */}
                {centerTab === 'builder' && h && (
                  <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

                    {/* Left — option search */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)', overflow: 'hidden', minWidth: 0 }}>
                      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                          <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 500 }}>Option Search</span>
                          <span style={{ fontSize: 9, color: 'var(--text-4)' }}>{h.ticker} · ${price.toFixed(2)}</span>
                          {searchResults && (
                            <button onClick={() => setSearchResults(null)}
                              style={{ marginLeft: 'auto', padding: '1px 7px', fontSize: 9, fontFamily: 'inherit', cursor: 'pointer', borderRadius: 'var(--r-md)', background: 'none', border: '1px solid var(--border)', color: 'var(--text-4)' }}>
                              Clear
                            </button>
                          )}
                        </div>
                        <BuilderSearchPanel
                          ticker={h.ticker}
                          spot={price}
                          expiries={realExpiries}
                          onResults={(rows) => setSearchResults(rows)}
                          searching={searching}
                          setSearching={setSearching}
                        />
                      </div>
                      <div style={{ flex: 1, overflowY: 'auto', padding: '0 14px 12px' }}>
                        {searching && <div style={{ padding: 16, textAlign: 'center', fontSize: 'var(--fs-xs)', color: 'var(--text-4)' }}>Searching…</div>}
                        {!searching && !searchResults && <div style={{ padding: 16, textAlign: 'center', fontSize: 'var(--fs-xs)', color: 'var(--text-4)' }}>Set criteria and search</div>}
                        {!searching && searchResults && searchResults.length === 0 && <div style={{ padding: 16, textAlign: 'center', fontSize: 'var(--fs-xs)', color: 'var(--text-4)' }}>No contracts matched</div>}
                        {!searching && searchResults && searchResults.length > 0 && (
                          <div style={{ marginTop: 6 }}>
                            <div style={{ fontSize: 9, color: 'var(--text-4)', padding: '4px 0' }}>{searchResults.length} contracts · click to place order</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '52px 40px 50px 50px 48px 52px 52px 46px 46px', fontSize: 8, color: 'var(--text-4)', textTransform: 'uppercase', padding: '3px 0', borderBottom: '1px solid var(--border)', gap: 2 }}>
                              {['Expiry','Type','Strike','Delta','IV%','Bid','Ask','Vol','OI'].map(c => <div key={c} style={{ textAlign: 'right' }}>{c}</div>)}
                            </div>
                            {searchResults.map((row, i) => (
                              <div key={i} onClick={() => {
                                if (row.code) setOptionOrder({ code: row.code, strike: row.strike, type: row.type === 'CALL' ? 'call' : 'put', bid: row.bid ?? 0, ask: row.ask ?? 0, expiry: row.expiry, ticker: h.ticker })
                              }} style={{ display: 'grid', gridTemplateColumns: '52px 40px 50px 50px 48px 52px 52px 46px 46px', fontSize: 10, fontFamily: 'var(--font-mono)', padding: '4px 0', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer', gap: 2, background: i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.01)' }}>
                                <div style={{ textAlign: 'right', color: 'var(--text-4)', fontSize: 9 }}>{row.expiry?.slice(5)}</div>
                                <div style={{ textAlign: 'right', color: row.type === 'CALL' ? 'var(--signal-bull)' : 'var(--signal-bear)', fontWeight: 600, fontSize: 9 }}>{row.type}</div>
                                <div style={{ textAlign: 'right' }}>${row.strike}</div>
                                <div style={{ textAlign: 'right', color: 'var(--text-3)' }}>{Number(row.delta).toFixed(3)}</div>
                                <div style={{ textAlign: 'right', color: 'var(--text-3)' }}>{Number(row.iv).toFixed(1)}%</div>
                                <div style={{ textAlign: 'right' }}>${Number(row.bid).toFixed(2)}</div>
                                <div style={{ textAlign: 'right' }}>${Number(row.ask).toFixed(2)}</div>
                                <div style={{ textAlign: 'right', color: 'var(--text-4)' }}>{(row.vol ?? 0).toLocaleString()}</div>
                                <div style={{ textAlign: 'right', color: 'var(--text-4)' }}>{(row.oi ?? 0).toLocaleString()}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right — strategy advisory */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
                      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                        <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 500, marginBottom: 1 }}>Strategy Advisory</div>
                        <div style={{ fontSize: 9, color: 'var(--text-4)' }}>{h.ticker} · IV {iv}%{ivRank !== null ? ` · IVR ${ivRank}` : ''}{hv30 ? ` · HV ${hv30.toFixed(1)}%` : ''}</div>
                      </div>
                      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
                          {strats.map((s, i) => (
                            <div key={i} onClick={() => setSelStrat(selStrat === i ? null : i)}
                              style={{ background: 'var(--bg-subtle)', border: `1px solid ${selStrat === i ? s.color : 'var(--border)'}`, borderRadius: 'var(--r-lg)', padding: '9px 11px', cursor: 'pointer', transition: 'all 0.15s', position: 'relative', overflow: 'hidden' }}>
                              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: s.color }} />
                              <div style={{ fontWeight: 600, fontSize: 11, marginBottom: 1, marginTop: 2 }}>{s.name}</div>
                              <div style={{ fontSize: 8, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>{s.type}</div>
                              <div style={{ fontSize: 10, color: 'var(--text-3)', lineHeight: 1.5, marginBottom: 7 }}>{s.desc}</div>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
                                {[{ l: 'Risk', v: s.risk }, { l: 'Reward', v: s.reward }, { l: 'Prob', v: s.prob }].map(m => (
                                  <div key={m.l}>
                                    <div style={{ fontSize: 7, color: 'var(--text-4)' }}>{m.l}</div>
                                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text)', marginTop: 1 }}>{m.v}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                        {selStrat !== null && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <button onClick={() => { setChatInput(`Tell me about the ${strats[selStrat].name} for my ${h.ticker} position`); setShowAI(true) }}
                              style={{ padding: '5px 0', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-3)', fontSize: 'var(--fs-sm)', cursor: 'pointer', fontFamily: 'inherit' }}>Ask AI ✦</button>
                            <button onClick={() => setCenterTab('chain')}
                              style={{ padding: '5px 0', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-3)', fontSize: 'var(--fs-sm)', cursor: 'pointer', fontFamily: 'inherit' }}>View Chain</button>
                            <button onClick={() => {
                              if (strats[selStrat].name === 'LEAPS / PMCC') { setShowPMCC(true) }
                              else setStaged({ ticker: h.ticker, type: strats[selStrat].name, description: strats[selStrat].desc, premium: strats[selStrat].reward, legs: strats[selStrat].legs, expiry: strats[selStrat].expiry })
                            }}
                              style={{ padding: '5px 0', background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.25)', borderRadius: 'var(--r-md)', color: 'var(--color-info)', fontSize: 'var(--fs-sm)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>Stage →</button>
                          </div>
                        )}
                        {/* IV context */}
                        <div style={{ marginTop: 10, padding: '8px 10px', background: (ivRank ?? iv) > 40 ? 'rgba(185,28,28,0.04)' : 'rgba(21,128,61,0.04)', border: `1px solid ${(ivRank ?? iv) > 40 ? 'rgba(185,28,28,0.12)' : 'rgba(21,128,61,0.12)'}`, borderRadius: 'var(--r-lg)', fontSize: 10, lineHeight: 1.6, color: 'var(--text-3)' }}>
                          <strong style={{ color: 'var(--text)' }}>
                            IV {iv.toFixed(1)}%{ivRank !== null ? ` · IVR ${ivRank}` : ''} —{' '}
                          </strong>
                          {ivRank !== null
                            ? ivRank > 50 ? 'Elevated — sell premium'
                            : ivRank < 20 ? 'Low — buy options'
                            : `Moderate${hv30 ? `. IV ${iv < hv30 ? '< HV → cheap' : '> HV → rich'}` : ''}`
                            : iv > 40 ? 'Elevated — consider selling premium'
                            : 'Moderate — standard strategies apply'}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Strategies tab removed — moved to Trade Builder right panel */}

                {/* DCA */}
                {centerTab === 'dca' && (
                  <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                      {[{ l: 'Total capital ($)', v: dcaCap, s: setDcaCap }, { l: 'Installments', v: dcaN, s: setDcaN }].map(f => (
                        <div key={f.l}>
                          <div style={{ fontSize: 9, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{f.l}</div>
                          <input value={f.v} onChange={e => f.s(e.target.value)} type="number" style={{ ...inBase, height: 29 }} />
                        </div>
                      ))}
                      <div>
                        <div style={{ fontSize: 9, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Ticker</div>
                        <input value={h.ticker} readOnly style={{ ...inBase, height: 29, color: 'var(--text-4)' }} />
                      </div>
                    </div>
                    <button onClick={genDCA} style={{ padding: '6px 0', background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.25)', borderRadius: 'var(--r-md)', color: 'var(--color-info)', fontSize: 'var(--fs-sm)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
                      Generate Schedule
                    </button>
                    {dcaSched.length > 0 && (
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                          <div style={{ fontSize: 9, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>DCA Schedule</div>
                          {dcaOrders.length > 0 && (
                            <button onClick={() => setShowDCAManager(true)}
                              style={{ fontSize: 9, padding: '2px 8px', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', background: 'none', color: 'var(--color-info)', cursor: 'pointer', fontFamily: 'inherit' }}>
                              Manage staged ({dcaOrders.filter(o => o.status === 'pending').length})
                            </button>
                          )}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '24px 60px 72px 72px 60px 1fr', gap: 4, padding: '4px 0', borderBottom: '1px solid var(--border)', fontSize: 8, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          {['#','Date','Amount','Est. Price','Shares',''].map(c => <div key={c}>{c}</div>)}
                        </div>
                        {dcaSched.map((row, i) => (
                          <div key={i} style={{ display: 'grid', gridTemplateColumns: '24px 60px 72px 72px 60px 1fr', gap: 4, padding: '5px 0', borderBottom: '1px solid var(--border-subtle)', alignItems: 'center', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)' }}>
                            <div>{row.num}</div>
                            <div>{row.date}</div>
                            <div>${fmtN(row.amount)}</div>
                            <div>${row.estPrice.toFixed(2)}</div>
                            <div>{row.shares}</div>
                            <button onClick={() => setShowDCAStage({ row, idx: i })}
                              style={{ padding: '2px 7px', background: stagedDCA.has(i) ? 'rgba(21,128,61,0.1)' : 'var(--bg-subtle)', border: `1px solid ${stagedDCA.has(i) ? 'rgba(21,128,61,0.3)' : 'var(--border)'}`, borderRadius: 3, color: stagedDCA.has(i) ? 'var(--signal-bull)' : 'var(--text-4)', fontSize: 9, cursor: 'pointer', fontFamily: 'inherit' }}>
                              {stagedDCA.has(i) ? '✓ Staged' : 'Stage →'}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

        {/* Floating AI button */}
      <button onClick={() => setShowAI(true)}
        style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 300, width: 48, height: 48, borderRadius: '50%', background: 'var(--color-info)', border: 'none', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 20px rgba(37,99,235,0.4)', fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono)', transition: 'transform 0.15s', flexShrink: 0 }}
        title="Ask AI Advisor">
        ✦
      </button>

      {/* AI Popup */}
      {showAI && (
        <>
          <div onClick={() => setShowAI(false)} style={{ position: 'fixed', inset: 0, zIndex: 350, background: 'rgba(0,0,0,0.3)' }} />
          <div style={{ position: 'fixed', bottom: 80, right: 24, zIndex: 351, width: 360, height: 520, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 500 }}>AI Advisor</span>
                <span style={{ fontSize: 8, background: 'rgba(37,99,235,0.1)', color: 'var(--color-info)', border: '1px solid rgba(37,99,235,0.2)', padding: '1px 5px', borderRadius: 3, fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>Claude</span>
                {apiKey && <span style={{ fontSize: 8, background: 'rgba(21,128,61,0.1)', color: 'var(--signal-bull)', border: '1px solid rgba(21,128,61,0.25)', padding: '1px 6px', borderRadius: 3 }}>● Active</span>}
                {h && <span style={{ fontSize: 9, color: 'var(--text-4)', marginLeft: 4 }}>{h.ticker} · ${price.toFixed(2)}</span>}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button onClick={() => setMessages([])} style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: 'var(--fs-xs)', fontFamily: 'inherit' }}>Clear</button>
                <button onClick={() => setShowAI(false)} style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: '1.1rem' }}>×</button>
              </div>
            </div>
            {/* Messages */}
            <div ref={chatRef} style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
              {messages.length === 0 && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5, opacity: 0.35 }}>
                  <div style={{ fontSize: 22 }}>✦</div>
                  <div style={{ fontSize: 10, color: 'var(--text-4)', textAlign: 'center' }}>
                    {apiKey ? 'Ask anything about your holdings or options' : 'Set API key in Settings to start'}
                  </div>
                </div>
              )}
              {messages.map((msg, i) => (
                <div key={i}>
                  {msg.role === 'user' ? (
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <div style={{ background: 'rgba(37,99,235,0.12)', border: '1px solid rgba(37,99,235,0.2)', borderRadius: '8px 8px 2px 8px', padding: '6px 9px', fontSize: 'var(--fs-sm)', maxWidth: '88%', lineHeight: 1.5 }}>{msg.content}</div>
                    </div>
                  ) : (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                        <span style={{ fontSize: 10 }}>✦</span>
                        <span style={{ fontSize: 8, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Advisor</span>
                      </div>
                      <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: '2px 8px 8px 8px', padding: '7px 9px', fontSize: 'var(--fs-sm)', lineHeight: 1.55 }}
                        dangerouslySetInnerHTML={{ __html: fmtAI(msg.content) }} />
                    </div>
                  )}
                </div>
              ))}
              {chatLoading && (
                <div style={{ display: 'flex', gap: 4, padding: '4px 0' }}>
                  {[0,1,2].map(i => <div key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--text-4)', animation: 'pulse 1.2s ease-in-out infinite', animationDelay: `${i * 0.2}s` }} />)}
                </div>
              )}
            </div>
            {/* Chips */}
            <div style={{ padding: '4px 12px 2px', display: 'flex', flexWrap: 'wrap', gap: 3, flexShrink: 0, borderTop: '1px solid var(--border)' }}>
              {chips.map(chip => (
                <button key={chip} onClick={() => sendChat(chip)}
                  style={{ fontSize: 9, padding: '2px 7px', borderRadius: 20, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-4)', cursor: apiKey ? 'pointer' : 'default', fontFamily: 'inherit', whiteSpace: 'nowrap', opacity: apiKey ? 1 : 0.4 }}>
                  {chip}
                </button>
              ))}
            </div>
            {/* Input */}
            <div style={{ padding: '5px 12px 10px', flexShrink: 0 }}>
              <div style={{ display: 'flex', gap: 5, alignItems: 'flex-end' }}>
                <textarea ref={taRef} value={chatInput}
                  onChange={e => { setChatInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 90) + 'px' }}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat() } }}
                  placeholder={!apiKey ? 'Add API key in Settings…' : h ? `Ask about ${h.ticker}…` : 'Select a holding first…'}
                  rows={1} disabled={!apiKey}
                  style={{ flex: 1, background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '6px 8px', fontSize: 'var(--fs-sm)', fontFamily: 'inherit', color: 'var(--text)', outline: 'none', resize: 'none', minHeight: 32, maxHeight: 90, lineHeight: 1.4, boxSizing: 'border-box', opacity: apiKey ? 1 : 0.6 }} />
                <button onClick={() => sendChat()} disabled={chatLoading || !chatInput.trim() || !apiKey}
                  style={{ width: 32, height: 32, borderRadius: 'var(--r-md)', background: !apiKey || chatLoading || !chatInput.trim() ? 'var(--bg-subtle)' : 'var(--color-info)', border: 'none', color: 'white', cursor: !apiKey || chatLoading || !chatInput.trim() ? 'not-allowed' : 'pointer', fontSize: 13, flexShrink: 0 }}>→</button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* DCA Stage Order Modal */}
      {showDCAStage && h && (
        <DCAStageModal
          row={showDCAStage.row}
          idx={showDCAStage.idx}
          ticker={h.ticker}
          currentPrice={price}
          onClose={() => setShowDCAStage(null)}
          onStaged={(order) => {
            setDcaOrders(prev => [...prev, order])
            setStagedDCA(prev => new Set(prev).add(showDCAStage.idx))
            setShowDCAStage(null)
          }}
        />
      )}

      {/* DCA Orders Manager */}
      {showDCAManager && (
        <DCAManagerModal
          orders={dcaOrders}
          onClose={() => setShowDCAManager(false)}
          onCancel={async (id) => {
            try {
              await fetch(`/api/orders/conditional?id=${id}`, { method: 'DELETE' })
            } catch {}
            setDcaOrders(prev => prev.filter(o => o.id !== id))
          }}
        />
      )}
      {showPMCC && h && (
        <PMCCStageModal
          ticker={h.ticker}
          price={price}
          iv={iv}
          ivRank={ivRank}
          expiries={realExpiries}
          onClose={() => setShowPMCC(false)}
          onStaged={() => setShowPMCC(false)}
        />
      )}
      {showSearch && h && (
        <OptionSearchModal
          ticker={h.ticker}
          spot={price}
          expiries={realExpiries}
          onClose={() => setShowSearch(false)}
          onResults={(rows) => { setSearchResults(rows); setShowSearch(false) }}
          searching={searching}
          setSearching={setSearching}
        />
      )}
      {showConditional && h && (
        <ConditionalOrderModal
          ticker={h.ticker}
          currentPrice={price}
          suggestion={aiSuggestedOrder}
          onClose={() => { setShowConditional(false); setAiSuggestedOrder(null) }}
          onCreated={() => { setShowConditional(false); setAiSuggestedOrder(null) }}
        />
      )}
      {optionOrder && (
        <OptionOrderModal
          order={optionOrder}
          onClose={() => setOptionOrder(null)}
          onPlaced={() => setOptionOrder(null)}
        />
      )}
      <style>{`@keyframes pulse{0%,80%,100%{opacity:0.2}40%{opacity:1}}`}</style>
    </div>
  )
}
