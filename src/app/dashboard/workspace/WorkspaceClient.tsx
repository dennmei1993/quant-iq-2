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
  const [centerTab,   setCenterTab]   = useState<'overview' | 'chain' | 'strategies' | 'dca'>('overview')
  const [expiryIdx,   setExpiryIdx]   = useState(0)
  const [staged,      setStaged]      = useState<StagedTrade | null>(null)
  const [selStrat,    setSelStrat]    = useState<number | null>(null)
  const [dcaCap,      setDcaCap]      = useState('20000')
  const [dcaN,        setDcaN]        = useState('6')
  const [dcaSched,    setDcaSched]    = useState<any[]>([])
  const [stagedDCA,   setStagedDCA]   = useState<Set<number>>(new Set())
  const [messages,    setMessages]    = useState<ChatMessage[]>([])
  const [chatInput,   setChatInput]   = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [apiKey,      setApiKey]      = useState('')
  const [signals,     setSignals]     = useState<Record<string, { price_usd: number | null; change_pct: number | null; iv_rank?: number | null }>>({})
  const [realChain,   setRealChain]   = useState<any[] | null>(null)
  const [chainLoading,setChainLoading] = useState(false)
  const [realExpiries,setRealExpiries] = useState<string[]>([])
  const [brokerOnline,setBrokerOnline] = useState(false)
  const [chainError,  setChainError]   = useState('')
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
          console.log('[chain] expiries loaded:', d.expiries.slice(0,3))
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
    fetch(`/api/broker/options/chain?symbol=US.${ticker}&expiry=${expiry.slice(0,10)}&strike_count=12`)
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
  const chain    = realChain ?? (h ? buildChain(price, 20, EXPIRIES[expiryIdx].dte) : [])
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

  // IV: prefer live chain ATM IV → signal → mock
  const iv       = liveIV ?? (h ? ((sigData as any)?.iv_rank ?? (sigData as any)?.score ?? getIV(h.ticker)) : 20)
  const pnlAmt   = h ? (price - h.avg_cost) * h.quantity : 0
  const pnlPct   = h && h.avg_cost > 0 ? (price - h.avg_cost) / h.avg_cost * 100 : 0
  const mktVal   = h ? price * h.quantity : 0
  const strats   = h ? buildStrategies(h, price, iv) : []
  const chips    = h ? (quickChips[h.ticker] ?? quickChips.DEFAULT) : quickChips.DEFAULT

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
            { l: 'Total capital',   v: fmt(portfolioCapital),                                            s: null },
            { l: 'Invested',        v: fmt(totalInvested),                                               s: `${deployedPct.toFixed(1)}% deployed` },
            { l: 'Cash available',  v: fmt(cashAvail),                                                   s: `${(100 - deployedPct).toFixed(1)}% idle`, vc: 'var(--color-info)' },
            { l: 'Current value',   v: fmt(totalInvested),                                               s: `${holdings.length} positions` },
            { l: 'Unrealised P&L',  v: `${totalUnrealised >= 0 ? '+' : ''}${fmt(Math.abs(totalUnrealised))}`, s: `${totalUnrealised >= 0 ? '+' : ''}${portfolioCapital > 0 ? (totalUnrealised / portfolioCapital * 100).toFixed(2) : '0.00'}%`, vc: totalUnrealised >= 0 ? 'var(--signal-bull)' : 'var(--signal-bear)' },
            { l: 'Realised P&L',    v: `${totalRealised >= 0 ? '+' : ''}${fmt(Math.abs(totalRealised))}`,     s: 'Closed',                               vc: totalRealised >= 0 ? 'var(--signal-bull)' : 'var(--signal-bear)' },
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
                        // Create a synthetic holding for watchlist items (no position yet)
                        const existing = holdings.find(hh => hh.ticker === w.ticker)
                        if (existing) { setSelected(existing); setCenterTab('overview'); setSelStrat(null) }
                        else {
                          setSelected({ id: w.id, ticker: w.ticker, quantity: 0, avg_cost: 0, unrealised_gain: 0, realised_gain: 0, signal: null })
                          setCenterTab('chain'); setSelStrat(null)
                        }
                      }}
                      style={{ display: 'grid', gridTemplateColumns: '1fr 55px', gap: 4, padding: '5px 10px', cursor: 'pointer', alignItems: 'center', borderLeft: `2px solid ${isSelected ? 'rgba(245,158,11,0.6)' : 'transparent'}`, background: isSelected ? 'rgba(245,158,11,0.04)' : 'transparent', transition: 'all 0.1s' }}>
                      <input type="checkbox" checked={checked.has(w.id)} onChange={e => { e.stopPropagation(); toggleCheck(w.id) }}
                        style={{ width: 12, height: 12, cursor: 'pointer', accentColor: 'var(--signal-neut)' }} />
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
                    { l: 'IV Rank (est)', v: String(iv),                                        c: iv > 45 ? 'var(--signal-bear)' : iv < 20 ? 'var(--signal-bull)' : 'var(--signal-neut)' },
                  ].map(m => (
                    <div key={m.l} style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 9, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{m.l}</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', color: m.c, marginTop: 2 }}>{m.v}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tabs */}
              <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 16px', flexShrink: 0 }}>
                {(['overview', 'chain', 'strategies', 'dca'] as const).map(t => (
                  <button key={t} onClick={() => setCenterTab(t)} style={{ padding: '7px 11px', fontSize: 'var(--fs-sm)', cursor: 'pointer', border: 'none', borderBottom: `2px solid ${centerTab === t ? 'var(--color-info)' : 'transparent'}`, color: centerTab === t ? 'var(--text)' : 'var(--text-4)', fontWeight: centerTab === t ? 500 : 400, background: 'none', fontFamily: 'inherit', transition: 'all 0.15s' }}>
                    {t === 'overview' ? 'Overview' : t === 'chain' ? 'Option Chain' : t === 'strategies' ? 'Strategies' : 'DCA'}
                  </button>
                ))}
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
                        { l: 'Options signal', v: iv > 40 ? 'Sell premium' : iv < 20 ? 'Buy options' : 'Neutral', s: 'Based on IV rank' },
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
                    <div style={{ padding: '9px 11px', background: iv > 40 ? 'rgba(185,28,28,0.04)' : 'rgba(21,128,61,0.04)', border: `1px solid ${iv > 40 ? 'rgba(185,28,28,0.12)' : 'rgba(21,128,61,0.12)'}`, borderRadius: 'var(--r-lg)', fontSize: 'var(--fs-sm)', lineHeight: 1.6, color: 'var(--text-3)' }}>
                      <strong style={{ color: 'var(--text)' }}>IV Rank {iv} — </strong>
                      {iv > 45 ? `Elevated. Options premiums are rich. Covered calls and CSPs will collect above-average income. Ideal selling window.` : iv < 20 ? `Low. Options are cheap relative to history. Good time to buy protective puts or long calls. Avoid selling premium.` : `Moderate. Standard strategies apply. Covered calls at 30 delta offer balanced income vs upside participation.`}
                    </div>
                  </div>
                )}

                {/* Option Chain */}
                {centerTab === 'chain' && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 16px', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 2 }}>
                      <select value={expiryIdx} onChange={e => setExpiryIdx(Number(e.target.value))}
                        style={{ ...inBase, width: 'auto', height: 27, padding: '0 8px', fontFamily: 'var(--font-mono)' }}>
                        {EXPIRIES.map((exp, i) => <option key={i} value={i}>{exp.label} ({exp.dte}d)</option>)}
                      </select>
                      <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-xs)', color: 'var(--text-4)', fontFamily: 'var(--font-mono)' }}>
                        {h.ticker} · ${price.toFixed(2)} · IV {iv}%
                      </span>
                    </div>
                    <div style={{ padding: '0 16px 16px' }}>
                      {/* Column headers */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 64px 1fr', marginTop: 6 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                          {(usingRealChain ? ['Delta','IV%','Bid','Ask','Vol','OI'] : ['Delta','IV%','Bid','Ask','Vol']).map(c => <div key={c} style={{ fontSize: 8, color: 'var(--text-4)', textAlign: 'right', padding: '0 3px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{c}</div>)}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid var(--border)', fontSize: 8, color: 'var(--text-4)', textTransform: 'uppercase', gap: 1 }}>
                          <span>STRIKE</span>
                          {usingRealChain && <span style={{ fontSize: 7, opacity: 0.6 }}>code</span>}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                          {(usingRealChain ? ['OI','Vol','Bid','Ask','IV%','Delta'] : ['Vol','Bid','Ask','IV%','Delta']).map(c => <div key={c} style={{ fontSize: 8, color: 'var(--text-4)', textAlign: 'right', padding: '0 3px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{c}</div>)}
                        </div>
                      </div>
                      {chain.map((row, i) => {
                        const atmBg: React.CSSProperties = row.isATM ? { background: 'rgba(245,158,11,0.07)' } : {}
                        const itmBg: React.CSSProperties = row.isCallITM && !row.isATM ? { background: 'rgba(21,128,61,0.03)' } : {}
                        return (
                          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 64px 1fr', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }}
                            onClick={() => setStaged({ ticker: h.ticker, type: `Call $${row.strike.toFixed(0)}`, description: `${row.callDelta}Δ IV ${row.callIV}%`, premium: `$${row.callAsk}`, strike: `$${row.strike.toFixed(0)}`, expiry: EXPIRIES[expiryIdx].label })}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', ...atmBg, ...itmBg }}>
                              {[row.callDelta, row.callIV+'%', '$'+row.callBid, '$'+row.callAsk, fmtN(row.callVol)].map((v, j) => (
                                <div key={j} style={{ padding: '4px 3px', fontSize: 10, textAlign: 'right', fontFamily: 'var(--font-mono)', color: j === 0 ? (parseFloat(row.callDelta) > 0.5 ? 'var(--signal-bull)' : 'var(--text-3)') : 'var(--text-3)' }}>{v}</div>
                              ))}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', ...atmBg }}>
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, color: row.isATM ? 'var(--signal-neut)' : 'var(--text)', background: row.isATM ? 'rgba(245,158,11,0.15)' : 'transparent', padding: '1px 4px', borderRadius: 2 }}>${row.strike.toFixed(0)}</span>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', ...atmBg }}>
                              {[fmtN(row.putVol), '$'+row.putBid, '$'+row.putAsk, row.putIV+'%', row.putDelta].map((v, j) => (
                                <div key={j} style={{ padding: '4px 3px', fontSize: 10, textAlign: 'right', fontFamily: 'var(--font-mono)', color: j === 4 ? (parseFloat(row.putDelta) < -0.5 ? 'var(--signal-bear)' : 'var(--text-3)') : 'var(--text-3)' }}>{v}</div>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Strategies */}
                {centerTab === 'strategies' && (
                  <div style={{ padding: '12px 16px' }}>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', marginBottom: 10 }}>
                      Strategies for {h.ticker} · {Math.round(h.quantity)} shares · IV Rank {iv}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      {strats.map((s, i) => (
                        <div key={i} onClick={() => setSelStrat(selStrat === i ? null : i)}
                          style={{ background: 'var(--bg-subtle)', border: `1px solid ${selStrat === i ? s.color : 'var(--border)'}`, borderRadius: 'var(--r-lg)', padding: '11px 13px', cursor: 'pointer', transition: 'all 0.15s', position: 'relative', overflow: 'hidden' }}>
                          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: s.color }} />
                          <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)', marginBottom: 2, marginTop: 3 }}>{s.name}</div>
                          <div style={{ fontSize: 9, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 7 }}>{s.type} · {s.expiry}</div>
                          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', lineHeight: 1.55, marginBottom: 9 }}>{s.desc}</div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 5, paddingTop: 7, borderTop: '1px solid var(--border)' }}>
                            {[{ l: 'Risk', v: s.risk }, { l: 'Reward', v: s.reward }, { l: 'Prob', v: s.prob }].map(m => (
                              <div key={m.l}>
                                <div style={{ fontSize: 8, color: 'var(--text-4)' }}>{m.l}</div>
                                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text)', marginTop: 1 }}>{m.v}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    {selStrat !== null && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                        <button onClick={() => { setChatInput(`Tell me about the ${strats[selStrat].name} for my ${h.ticker} position`) }}
                          style={{ flex: 1, padding: '5px 0', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-3)', fontSize: 'var(--fs-sm)', cursor: 'pointer', fontFamily: 'inherit' }}>Ask AI ↗</button>
                        <button onClick={() => setCenterTab('chain')}
                          style={{ flex: 1, padding: '5px 0', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-3)', fontSize: 'var(--fs-sm)', cursor: 'pointer', fontFamily: 'inherit' }}>View Chain</button>
                        <button onClick={() => setStaged({ ticker: h.ticker, type: strats[selStrat].name, description: strats[selStrat].desc, premium: strats[selStrat].reward, legs: strats[selStrat].legs, expiry: strats[selStrat].expiry })}
                          style={{ flex: 1, padding: '5px 0', background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.25)', borderRadius: 'var(--r-md)', color: 'var(--color-info)', fontSize: 'var(--fs-sm)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>Stage →</button>
                      </div>
                    )}
                  </div>
                )}

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
                            <button onClick={() => { setStagedDCA(prev => new Set(prev).add(i)); setStaged({ ticker: h.ticker, type: 'Market Buy', description: `DCA #${row.num}`, premium: `$${fmtN(row.amount)}`, expiry: row.date }) }}
                              style={{ padding: '2px 7px', background: stagedDCA.has(i) ? 'rgba(21,128,61,0.1)' : 'var(--bg-subtle)', border: `1px solid ${stagedDCA.has(i) ? 'rgba(21,128,61,0.3)' : 'var(--border)'}`, borderRadius: 3, color: stagedDCA.has(i) ? 'var(--signal-bull)' : 'var(--text-4)', fontSize: 9, cursor: 'pointer', fontFamily: 'inherit' }}>
                              {stagedDCA.has(i) ? '✓' : 'Stage'}
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

        {/* ── Panel 3: AI Advisor ── */}
        <div style={{ width: 280, minWidth: 280, borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0, height: '100%' }}>

          {/* Header */}
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 500 }}>AI Advisor</span>
              <span style={{ fontSize: 8, background: 'rgba(37,99,235,0.1)', color: 'var(--color-info)', border: '1px solid rgba(37,99,235,0.2)', padding: '1px 5px', borderRadius: 3, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Claude</span>
              {apiKey
                ? <span style={{ fontSize: 8, background: 'rgba(21,128,61,0.1)', color: 'var(--signal-bull)', border: '1px solid rgba(21,128,61,0.25)', padding: '1px 6px', borderRadius: 3 }}>● API Activated</span>
                : <a href="/dashboard/settings" style={{ fontSize: 8, background: 'rgba(245,158,11,0.08)', color: 'var(--signal-neut)', border: '1px solid rgba(245,158,11,0.25)', padding: '1px 6px', borderRadius: 3, textDecoration: 'none' }}>⚠ Set API key</a>
              }
            </div>
            <button onClick={() => setMessages([])} style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: 'var(--fs-xs)', fontFamily: 'inherit' }}>Clear</button>
          </div>

          {/* Input + chips — at top */}
          <div style={{ flexShrink: 0, borderBottom: '1px solid var(--border)', padding: '6px 10px 8px' }}>
            <div style={{ display: 'flex', gap: 5, alignItems: 'flex-end', marginBottom: 5 }}>
              <textarea ref={taRef} value={chatInput}
                onChange={e => { setChatInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 90) + 'px' }}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat() } }}
                placeholder={!apiKey ? 'Add API key in Settings…' : h ? `Ask about ${h.ticker}…` : 'Select a holding first…'}
                rows={1} disabled={!apiKey}
                style={{ flex: 1, background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '6px 8px', fontSize: 'var(--fs-sm)', fontFamily: 'inherit', color: apiKey ? 'var(--text)' : 'var(--text-4)', outline: 'none', resize: 'none', minHeight: 32, maxHeight: 90, lineHeight: 1.4, boxSizing: 'border-box', opacity: apiKey ? 1 : 0.6 }} />
              <button onClick={() => sendChat()} disabled={chatLoading || !chatInput.trim() || !apiKey}
                style={{ width: 32, height: 32, borderRadius: 'var(--r-md)', background: !apiKey || chatLoading || !chatInput.trim() ? 'var(--bg-subtle)' : 'var(--color-info)', border: 'none', color: 'white', cursor: !apiKey || chatLoading || !chatInput.trim() ? 'not-allowed' : 'pointer', fontSize: 13, flexShrink: 0 }}>
                →
              </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
              {chips.map(chip => (
                <button key={chip} onClick={() => sendChat(chip)}
                  style={{ fontSize: 9, padding: '2px 7px', borderRadius: 20, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-4)', cursor: apiKey ? 'pointer' : 'default', fontFamily: 'inherit', whiteSpace: 'nowrap', opacity: apiKey ? 1 : 0.4 }}>
                  {chip}
                </button>
              ))}
            </div>
          </div>

          {/* Messages — grow downward from top */}
          <div ref={chatRef} style={{ flex: 1, overflowY: 'auto', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
            {messages.map((msg, i) => (
              <div key={i}>
                {msg.role === 'user' ? (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <div style={{ background: 'rgba(37,99,235,0.12)', border: '1px solid rgba(37,99,235,0.2)', borderRadius: '8px 8px 2px 8px', padding: '6px 9px', fontSize: 'var(--fs-sm)', color: 'var(--text)', maxWidth: '88%', lineHeight: 1.5 }}>
                      {msg.content}
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                      <div style={{ width: 13, height: 13, borderRadius: 3, background: 'var(--color-info)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, color: 'white', fontFamily: 'var(--font-mono)' }}>AI</div>
                      <span style={{ fontSize: 8, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Advisor</span>
                    </div>
                    <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: '2px 8px 8px 8px', padding: '7px 9px', fontSize: 'var(--fs-sm)', lineHeight: 1.55 }}
                      dangerouslySetInnerHTML={{ __html: fmtAI(msg.content) }} />
                  </div>
                )}
              </div>
            ))}
            {chatLoading && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                  <div style={{ width: 13, height: 13, borderRadius: 3, background: 'var(--color-info)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, color: 'white' }}>AI</div>
                  <span style={{ fontSize: 8, color: 'var(--text-4)' }}>Thinking…</span>
                </div>
                <div style={{ display: 'flex', gap: 4, padding: '4px 0' }}>
                  {[0,1,2].map(i => (
                    <div key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--text-4)', animation: 'pulse 1.2s ease-in-out infinite', animationDelay: `${i * 0.2}s` }} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

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
