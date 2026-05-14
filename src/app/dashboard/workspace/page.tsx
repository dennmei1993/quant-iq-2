'use client'
// src/app/dashboard/workspace/page.tsx
// Options & Research Workspace — AI-assisted options research per holding
// Integrates with: Supabase holdings, broker bridge, Anthropic API

import { useState, useEffect, useRef, useCallback } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Holding {
  id:              string
  ticker:          string
  quantity:        number
  avg_cost:        number
  unrealised_gain: number
  realised_gain:   number
  signal?: {
    price_usd:   number | null
    change_pct:  number | null
    signal:      string | null
  } | null
}

interface ChatMessage {
  role:    'user' | 'assistant'
  content: string
}

interface StagedTrade {
  ticker:      string
  type:        string
  description: string
  premium?:    string
  strike?:     string
  expiry?:     string
  legs?:       string
}

// ── Option chain data (simulated until Moomoo options API wired) ──────────────

function genChainRow(strike: number, spot: number, iv: number, dte: number) {
  const t    = dte / 365
  const σ    = iv / 100
  const d1   = (Math.log(spot / strike) + (0.05 + σ * σ / 2) * t) / (σ * Math.sqrt(t))
  const cDelta = Math.max(0.01, Math.min(0.99, 0.5 + d1 * 0.3))
  const callIV  = (iv * (1 + Math.abs(spot - strike) / spot * 0.4)).toFixed(1)
  const putIV   = (iv * (1 + Math.abs(spot - strike) / spot * 0.5)).toFixed(1)
  const tVal    = spot * σ * Math.sqrt(t) * 0.4
  const callPrem = Math.max(0.05, tVal * cDelta + Math.max(0, spot - strike) * 0.98)
  const putPrem  = Math.max(0.05, tVal * (1 - cDelta) + Math.max(0, strike - spot) * 0.98)
  return {
    strike,
    callDelta:  cDelta.toFixed(2),
    putDelta:   (cDelta - 1).toFixed(2),
    callIV, putIV,
    callBid:  (callPrem * 0.97).toFixed(2),
    callAsk:  callPrem.toFixed(2),
    putBid:   (putPrem * 0.97).toFixed(2),
    putAsk:   putPrem.toFixed(2),
    callVol:  Math.floor(Math.random() * 900 + 100),
    putVol:   Math.floor(Math.random() * 700 + 80),
    isATM:    Math.abs(strike - spot) < spot * 0.015,
    isCallITM: strike < spot,
  }
}

function buildChain(spot: number, iv: number, dte: number) {
  const step   = spot < 50 ? 1 : spot < 200 ? 2.5 : spot < 500 ? 5 : 10
  const base   = Math.round(spot / step) * step
  const rows   = []
  for (let i = -8; i <= 8; i++) rows.push(genChainRow(base + i * step, spot, iv, dte))
  return rows
}

const EXPIRIES = [
  { label: 'Jun 20, 2025', dte: 37 },
  { label: 'Jul 18, 2025', dte: 65 },
  { label: 'Aug 15, 2025', dte: 93 },
  { label: 'Sep 19, 2025', dte: 128 },
  { label: 'Jan 16, 2026', dte: 246 },
]

// ── Strategy recommendations ──────────────────────────────────────────────────

function buildStrategies(h: Holding, price: number, iv: number) {
  const pnlPct   = ((price - h.avg_cost) / h.avg_cost * 100)
  const posVal   = h.quantity * price
  const strats   = []

  // Covered Call — always relevant if holding ≥ 100 shares
  if (h.quantity >= 100) {
    const strike    = Math.round(price * 1.05 / 2.5) * 2.5
    const premium   = (price * (iv / 100) * Math.sqrt(37 / 365) * 0.4 * 0.28).toFixed(2)
    const yield37d  = ((parseFloat(premium) * 100) / posVal * 100).toFixed(2)
    strats.push({
      name: 'Covered Call',
      type: 'Income',
      color: '#22c55e',
      desc: `Sell the $${strike} call (37 DTE) for ~$${premium} premium per share ($${(parseFloat(premium) * 100).toFixed(0)} per contract). Yield: ${yield37d}% over 37 days. Caps upside at $${strike}, keeps you long the stock.`,
      risk: 'Capped upside above $' + strike,
      reward: '$' + (parseFloat(premium) * 100).toFixed(0) + '/contract',
      prob: '~70% expire worthless',
      expiry: 'Jun 20',
      legs: `Sell 1× ${h.ticker} $${strike} Call Jun 20`,
    })
  }

  // CSP — if they want to accumulate more
  const cspStrike = Math.round(price * 0.93 / 2.5) * 2.5
  const cspPrem   = (price * (iv / 100) * Math.sqrt(65 / 365) * 0.4 * 0.32).toFixed(2)
  strats.push({
    name: 'Cash-Secured Put',
    type: 'Accumulate',
    color: '#3b82f6',
    desc: `Sell the $${cspStrike} put (65 DTE) for ~$${cspPrem}. If assigned, buy ${h.ticker} at effective cost $${(cspStrike - parseFloat(cspPrem)).toFixed(2)} — a ${((1 - (cspStrike - parseFloat(cspPrem)) / price) * 100).toFixed(1)}% discount. Premium collected: $${(parseFloat(cspPrem) * 100).toFixed(0)}.`,
    risk: 'Must buy at $' + cspStrike + ' if assigned',
    reward: '$' + (parseFloat(cspPrem) * 100).toFixed(0) + '/contract',
    prob: '~68% expire worthless',
    expiry: 'Jul 18',
    legs: `Sell 1× ${h.ticker} $${cspStrike} Put Jul 18`,
  })

  // Protective Put — if sitting on large gain
  if (pnlPct > 15) {
    const putStrike = Math.round(h.avg_cost * 1.02 / 2.5) * 2.5
    const putCost   = (price * (iv / 100) * Math.sqrt(93 / 365) * 0.4 * 0.22).toFixed(2)
    strats.push({
      name: 'Protective Put',
      type: 'Hedge',
      color: '#f59e0b',
      desc: `Buy $${putStrike} put (93 DTE) for ~$${putCost}/share to lock in gains. Breakeven at $${(price - parseFloat(putCost)).toFixed(2)}. Protects your +${pnlPct.toFixed(1)}% gain down to your cost basis.`,
      risk: '$' + (parseFloat(putCost) * (h.quantity < 100 ? h.quantity : 100)).toFixed(0) + ' premium cost',
      reward: 'Full downside protection',
      prob: 'Pure insurance',
      expiry: 'Aug 15',
      legs: `Buy 1× ${h.ticker} $${putStrike} Put Aug 15`,
    })
  }

  // Bull Call Spread — directional
  const bcsLong  = Math.round(price * 1.01 / 2.5) * 2.5
  const bcsShort = Math.round(price * 1.08 / 2.5) * 2.5
  const bcsDebit = (price * (iv / 100) * Math.sqrt(65 / 365) * 0.4 * 0.18).toFixed(2)
  const bcsMax   = ((bcsShort - bcsLong - parseFloat(bcsDebit)) * 100).toFixed(0)
  strats.push({
    name: 'Bull Call Spread',
    type: 'Directional',
    color: '#14b8a6',
    desc: `Buy $${bcsLong}/$${bcsShort} call spread for ~$${bcsDebit} debit. Max profit $${bcsMax} if ${h.ticker} closes above $${bcsShort}. Defined risk, ${((parseFloat(bcsMax) / parseFloat(bcsDebit) / 100)).toFixed(1)}×R setup.`,
    risk: '$' + (parseFloat(bcsDebit) * 100).toFixed(0) + ' max loss',
    reward: '$' + bcsMax + ' max profit',
    prob: '~38% full profit',
    expiry: 'Jul 18',
    legs: `Buy $${bcsLong} Call / Sell $${bcsShort} Call Jul 18`,
  })

  return strats
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt  = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(1)}K` : `$${n.toFixed(2)}`
const fmtN = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 })
const pct  = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`

// IV rank mock (would come from bridge in production)
const ivRankMap: Record<string, number> = {
  TSLA:58, META:31, GOOG:24, PLTR:62, AMD:41, NVDA:45,
  GLD:16, JEPQ:20, QQQ:18, SPY:14, SLV:32, FCX:38,
}
function getIVRank(ticker: string) { return ivRankMap[ticker] ?? Math.floor(Math.random() * 40 + 15) }

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function WorkspacePage() {
  const [holdings,      setHoldings]      = useState<Holding[]>([])
  const [selected,      setSelected]      = useState<Holding | null>(null)
  const [loading,       setLoading]       = useState(true)
  const [centerTab,     setCenterTab]     = useState<'overview' | 'chain' | 'strategies' | 'dca'>('overview')
  const [expiryIdx,     setExpiryIdx]     = useState(0)
  const [searchQ,       setSearchQ]       = useState('')
  const [apiKey,        setApiKey]        = useState('')
  const [apiKeyInput,   setApiKeyInput]   = useState('')
  const [apiKeySet,     setApiKeySet]     = useState(false)
  const [messages,      setMessages]      = useState<ChatMessage[]>([])
  const [chatInput,     setChatInput]     = useState('')
  const [chatLoading,   setChatLoading]   = useState(false)
  const [staged,        setStaged]        = useState<StagedTrade | null>(null)
  const [selectedStrat, setSelectedStrat] = useState<number | null>(null)
  const [dcaCapital,    setDcaCapital]    = useState('20000')
  const [dcaN,          setDcaN]          = useState('6')
  const [dcaSchedule,   setDcaSchedule]   = useState<any[]>([])
  const [stagedDCA,     setStagedDCA]     = useState<Set<number>>(new Set())
  const chatRef  = useRef<HTMLDivElement>(null)
  const textaRef = useRef<HTMLTextAreaElement>(null)

  // Load holdings from portfolio API
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/portfolio')
        if (!res.ok) return
        const d = await res.json()
        const raw = d.holdings ?? []
        const parsed = raw.map((h: any) => ({
          ...h,
          quantity:        parseFloat(h.quantity) || 0,
          avg_cost:        parseFloat(h.avg_cost) || 0,
          unrealised_gain: parseFloat(h.unrealised_gain) || 0,
          realised_gain:   parseFloat(h.realised_gain) || 0,
        })).filter((h: Holding) => h.quantity > 0 && h.ticker !== 'CASH')
        setHoldings(parsed)
        if (parsed.length > 0) setSelected(parsed[0])
      } catch {}
      finally { setLoading(false) }
    }
    load()
  }, [])

  // Welcome message
  useEffect(() => {
    setMessages([{
      role: 'assistant',
      content: `Portfolio loaded. I can see your holdings and am ready to help with:\n\n• **Options strategies** for any holding\n• **Covered call** yield analysis\n• **Accumulation plans** via CSPs\n• **Hedging** your largest positions\n• **DCA schedules** and entry timing\n\nSelect a holding to get started, or ask me anything about your portfolio.`,
    }])
  }, [])

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [messages, chatLoading])

  const h = selected
  const price      = h?.signal?.price_usd ?? h?.avg_cost ?? 0
  const iv         = h ? getIVRank(h.ticker) : 20
  const pnlAmt     = h ? (price - h.avg_cost) * h.quantity : 0
  const pnlPctVal  = h ? (price - h.avg_cost) / h.avg_cost * 100 : 0
  const mktVal     = h ? price * h.quantity : 0
  const chainData  = h ? buildChain(price, iv, EXPIRIES[expiryIdx].dte) : []
  const strategies = h ? buildStrategies(h, price, iv) : []

  // DCA generation
  function generateDCA() {
    const cap  = parseFloat(dcaCapital) || 20000
    const n    = parseInt(dcaN) || 6
    const rows = []
    let d = new Date()
    d.setDate(d.getDate() + 7)
    for (let i = 0; i < n; i++) {
      const priceVar = price * (1 + (Math.random() * 0.08 - 0.04))
      const amt      = cap / n
      rows.push({
        num: i + 1,
        date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        amount: amt,
        estPrice: priceVar,
        shares: (amt / priceVar).toFixed(3),
      })
      d = new Date(d.getTime() + 14 * 86400000)
    }
    setDcaSchedule(rows)
    setStagedDCA(new Set())
  }

  // AI chat
  async function sendChat() {
    if (!chatInput.trim() || chatLoading) return
    if (!apiKey) { setApiKeySet(false); return }
    const text = chatInput.trim()
    setChatInput('')
    if (textaRef.current) textaRef.current.style.height = 'auto'

    const userMsg: ChatMessage = { role: 'user', content: text }
    const newHistory = [...messages, userMsg]
    setMessages(newHistory)
    setChatLoading(true)

    const holdingsSummary = holdings.map(h => {
      const p    = h.signal?.price_usd ?? h.avg_cost
      const pnl  = ((p - h.avg_cost) / h.avg_cost * 100).toFixed(1)
      return `${h.ticker}: ${Math.round(h.quantity)} shares @ $${h.avg_cost.toFixed(2)} avg, now $${p.toFixed(2)} (${parseFloat(pnl) >= 0 ? '+' : ''}${pnl}%)`
    }).join('\n')

    const systemPrompt = `You are an AI investment advisor embedded in Quant IQ, a professional trading platform for a sophisticated investor trading US markets via Moomoo.

CURRENTLY VIEWING: ${h?.ticker ?? 'Portfolio'} — ${h ? `${Math.round(h.quantity)} shares @ avg $${h.avg_cost.toFixed(2)}, current $${price.toFixed(2)}, IV Rank ${iv}` : 'Portfolio overview'}

PORTFOLIO HOLDINGS:
${holdingsSummary}

ADVISOR GUIDELINES:
- Be direct like a seasoned wealth manager — give exact strikes, dates, premium estimates
- Options permissions: covered calls, CSPs, long options — no naked options
- Keep responses under 250 words unless asked for detail
- Use **bold** for key numbers, bullet points for steps
- Reference actual position size, cost basis, and P&L when relevant`

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model:      'claude-sonnet-4-20250514',
          max_tokens: 1024,
          system:     systemPrompt,
          messages:   newHistory.slice(-16),
        }),
      })
      const data = await res.json()
      const reply = data.content?.[0]?.text ?? (data.error ? `Error: ${data.error.message}` : 'No response.')
      setMessages(prev => [...prev, { role: 'assistant', content: reply }])
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Connection error: ${e.message}` }])
    }
    setChatLoading(false)
  }

  function useQuickChip(text: string) {
    setChatInput(text)
    setTimeout(() => sendChatWith(text), 50)
  }

  async function sendChatWith(text: string) {
    if (!apiKey) return
    const userMsg: ChatMessage = { role: 'user', content: text }
    const newHistory = [...messages, userMsg]
    setMessages(newHistory)
    setChatLoading(true)
    setChatInput('')
    // Same logic as sendChat but with provided text
    const holdingsSummary = holdings.map(hh => `${hh.ticker}: ${Math.round(hh.quantity)} shares @ $${hh.avg_cost.toFixed(2)}`).join(', ')
    const systemPrompt = `You are an AI investment advisor for Quant IQ. Currently viewing: ${h?.ticker ?? 'portfolio'}. Holdings: ${holdingsSummary}. Be direct, specific, under 250 words.`
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1024, system: systemPrompt, messages: newHistory.slice(-16) }),
      })
      const data = await res.json()
      setMessages(prev => [...prev, { role: 'assistant', content: data.content?.[0]?.text ?? 'No response.' }])
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${e.message}` }])
    }
    setChatLoading(false)
  }

  function formatAI(text: string) {
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code style="background:rgba(59,130,246,0.15);color:#93c5fd;padding:1px 4px;border-radius:3px;font-size:11px">$1</code>')
      .replace(/^[•\-]\s(.+)$/gm, '<div style="padding-left:10px;margin:2px 0;color:var(--text-3)">· $1</div>')
      .replace(/\n\n/g, '<br/><br/>')
      .replace(/\n/g, '<br/>')
  }

  const quickChips: Record<string, string[]> = {
    TSLA: ['Best covered call yield?', 'TSLA hedge idea', 'CSP to buy dip?', 'IV analysis'],
    GOOG: ['Accumulate GOOG?', 'Covered call strikes', 'DCA $10k?', 'Compare to META'],
    META: ['META after earnings', 'Best CC strike?', 'Reduce or hold?', 'Options play'],
    GLD:  ['Gold hedge thesis', 'GLD covered call?', 'SLV vs GLD?', 'Macro view'],
    JEPQ: ['JEPQ income analysis', 'Compare to QYLD', 'Add more JEPQ?', 'Tax efficiency'],
    DEFAULT: ['Review my portfolio', 'Best income strategy', 'Highest IV holdings', 'Risk overview'],
  }
  const chips = h ? (quickChips[h.ticker] ?? quickChips.DEFAULT) : quickChips.DEFAULT

  const filtered = holdings.filter(hh => hh.ticker.includes(searchQ.toUpperCase()) || searchQ === '')

  // ── Styles ───────────────────────────────────────────────────────────────────

  const S = {
    page: {
      display: 'flex', height: '100%', overflow: 'hidden',
      fontFamily: 'var(--font-sans)',
    } as React.CSSProperties,

    // Sidebar
    sidebar: {
      width: 220, minWidth: 220,
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column' as const,
      overflow: 'hidden', background: 'var(--bg)',
    } as React.CSSProperties,

    searchWrap: { padding: '8px 10px', borderBottom: '1px solid var(--border)' } as React.CSSProperties,
    searchInput: {
      width: '100%', height: 28, background: 'var(--bg-subtle)',
      border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
      padding: '0 8px', fontSize: 'var(--fs-sm)', color: 'var(--text)',
      outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' as const,
    } as React.CSSProperties,

    holdingsList: { flex: 1, overflowY: 'auto' as const } as React.CSSProperties,

    holdingRow: (active: boolean): React.CSSProperties => ({
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 10px', cursor: 'pointer',
      borderLeft: `2px solid ${active ? 'var(--color-info)' : 'transparent'}`,
      background: active ? 'rgba(37,99,235,0.06)' : 'transparent',
      transition: 'all 0.1s',
    }),

    // Center
    center: {
      flex: 1, display: 'flex', flexDirection: 'column' as const,
      overflow: 'hidden', minWidth: 0,
    } as React.CSSProperties,

    hero: {
      padding: '12px 18px 10px',
      borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'flex-start', gap: 24,
      background: 'var(--bg)', flexShrink: 0,
    } as React.CSSProperties,

    centerTabs: {
      display: 'flex', borderBottom: '1px solid var(--border)',
      background: 'var(--bg)', flexShrink: 0,
      padding: '0 18px',
    } as React.CSSProperties,

    tab: (active: boolean): React.CSSProperties => ({
      padding: '8px 12px', fontSize: 'var(--fs-sm)', cursor: 'pointer',
      border: 'none',
      borderBottom: `2px solid ${active ? 'var(--color-info)' : 'transparent'}`,
      color: active ? 'var(--text)' : 'var(--text-4)',
      fontWeight: active ? 500 : 400, transition: 'all 0.15s',
      background: 'none', fontFamily: 'inherit',
    }),

    body: { flex: 1, overflowY: 'auto' as const } as React.CSSProperties,

    // Right panel
    rightPanel: {
      width: 300, minWidth: 300,
      borderLeft: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column' as const,
      background: 'var(--bg)',
    } as React.CSSProperties,

    inputBase: {
      padding: '5px 8px', background: 'var(--bg-subtle)',
      border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
      color: 'var(--text)', fontSize: 'var(--fs-sm)', outline: 'none',
      fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const,
    } as React.CSSProperties,
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-4)', fontSize: 'var(--fs-sm)' }}>
      Loading workspace…
    </div>
  )

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div style={S.page}>

      {/* ── LEFT SIDEBAR — Holdings ── */}
      <div style={S.sidebar}>
        <div style={S.searchWrap}>
          <input
            style={S.searchInput}
            placeholder="Search holdings…"
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
          />
        </div>

        {/* Portfolio summary */}
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 'var(--fs-label)', color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
            Portfolio · {holdings.length} holdings
          </div>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-3)' }}>
            IV Range: {Math.min(...holdings.map(hh => getIVRank(hh.ticker)))}–{Math.max(...holdings.map(hh => getIVRank(hh.ticker)))}
          </div>
        </div>

        <div style={S.holdingsList}>
          {filtered.map(hh => {
            const p       = hh.signal?.price_usd ?? hh.avg_cost
            const pnlP    = ((p - hh.avg_cost) / hh.avg_cost * 100)
            const isPos   = pnlP >= 0
            const ivR     = getIVRank(hh.ticker)
            const isActive = selected?.ticker === hh.ticker
            return (
              <div key={hh.id} style={S.holdingRow(isActive)} onClick={() => { setSelected(hh); setCenterTab('overview') }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text)' }}>{hh.ticker}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: isPos ? 'var(--signal-bull)' : 'var(--signal-bear)' }}>
                      {isPos ? '+' : ''}{pnlP.toFixed(1)}%
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
                    <span style={{ fontSize: 10, color: 'var(--text-4)' }}>{Math.round(hh.quantity)} shs</span>
                    <span style={{ fontSize: 9, color: ivR > 45 ? 'var(--signal-bear)' : ivR > 25 ? 'var(--signal-neut)' : 'var(--text-4)', background: ivR > 45 ? 'rgba(185,28,28,0.08)' : 'transparent', padding: '0 3px', borderRadius: 2 }}>
                      IV {ivR}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── CENTER PANEL ── */}
      <div style={S.center}>

        {/* Hero */}
        {h && (
          <div style={S.hero}>
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 300, color: 'var(--text)', letterSpacing: '-0.5px' }}>{h.ticker}</div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', marginTop: 2 }}>
                {Math.round(h.quantity)} shares · Avg ${h.avg_cost.toFixed(2)}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 24, marginLeft: 'auto', alignItems: 'flex-start', flexWrap: 'wrap' }}>
              {[
                { label: 'Market price', value: `$${price.toFixed(2)}`, color: 'var(--text)' },
                { label: 'Market value', value: fmt(mktVal), color: 'var(--text)' },
                { label: 'Unrealised P&L', value: `${pnlAmt >= 0 ? '+' : ''}${fmt(Math.abs(pnlAmt))} (${pct(pnlPctVal)})`, color: pnlAmt >= 0 ? 'var(--signal-bull)' : 'var(--signal-bear)' },
                { label: 'IV Rank', value: String(iv), color: iv > 45 ? 'var(--signal-bear)' : iv > 25 ? 'var(--signal-neut)' : 'var(--signal-bull)' },
              ].map(m => (
                <div key={m.label} style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 9, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{m.label}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', color: m.color, marginTop: 2 }}>{m.value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div style={S.centerTabs}>
          {(['overview', 'chain', 'strategies', 'dca'] as const).map(t => (
            <button key={t} style={S.tab(centerTab === t)} onClick={() => setCenterTab(t)}>
              {t === 'overview' ? 'Overview' : t === 'chain' ? 'Option Chain' : t === 'strategies' ? 'Strategies' : 'DCA Plan'}
            </button>
          ))}
        </div>

        {/* Tab bodies */}
        <div style={S.body}>

          {/* ── Overview ── */}
          {centerTab === 'overview' && h && (
            <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                {[
                  { label: 'Position value', value: fmt(mktVal), sub: `${Math.round(h.quantity)} shares @ $${price.toFixed(2)}` },
                  { label: 'Cost basis', value: fmt(h.quantity * h.avg_cost), sub: `Avg $${h.avg_cost.toFixed(2)} · FIFO` },
                  { label: 'Unrealised P&L', value: `${pnlAmt >= 0 ? '+' : ''}${fmt(Math.abs(pnlAmt))}`, sub: pct(pnlPctVal), valueColor: pnlAmt >= 0 ? 'var(--signal-bull)' : 'var(--signal-bear)' },
                  { label: 'IV Rank', value: String(iv), sub: iv > 45 ? 'High — good to sell vol' : iv < 25 ? 'Low — favor buying' : 'Moderate' },
                  { label: 'Options signal', value: iv > 40 ? 'Sell premium' : iv < 20 ? 'Buy options' : 'Neutral', sub: 'Based on IV rank' },
                  { label: 'Realised P&L', value: `${h.realised_gain >= 0 ? '+' : ''}${fmt(Math.abs(h.realised_gain))}`, sub: 'Closed positions', valueColor: h.realised_gain >= 0 ? 'var(--signal-bull)' : 'var(--signal-bear)' },
                ].map(m => (
                  <div key={m.label} style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '10px 12px' }}>
                    <div style={{ fontSize: 9, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>{m.label}</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 300, color: (m as any).valueColor ?? 'var(--text)' }}>{m.value}</div>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', marginTop: 3 }}>{m.sub}</div>
                  </div>
                ))}
              </div>

              {/* Quick actions */}
              <div style={{ display: 'flex', gap: 8 }}>
                {[
                  { label: 'View option chain →', tab: 'chain' as const },
                  { label: 'AI strategy recs →', tab: 'strategies' as const },
                  { label: 'Build DCA plan →', tab: 'dca' as const },
                ].map(btn => (
                  <button key={btn.label} onClick={() => setCenterTab(btn.tab)}
                    style={{ flex: 1, padding: '6px 0', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-3)', fontSize: 'var(--fs-sm)', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s' }}>
                    {btn.label}
                  </button>
                ))}
              </div>

              {/* IV context */}
              <div style={{ padding: '10px 12px', background: iv > 40 ? 'rgba(185,28,28,0.05)' : 'rgba(21,128,61,0.04)', border: `1px solid ${iv > 40 ? 'rgba(185,28,28,0.15)' : 'rgba(21,128,61,0.12)'}`, borderRadius: 'var(--r-lg)', fontSize: 'var(--fs-sm)' }}>
                <div style={{ fontWeight: 500, marginBottom: 4, color: 'var(--text)' }}>IV Rank {iv} — {iv > 45 ? 'Elevated: good time to sell premium' : iv < 20 ? 'Low: consider buying options' : 'Moderate: balanced approach'}</div>
                <div style={{ color: 'var(--text-3)', lineHeight: 1.6 }}>
                  {iv > 45
                    ? `With IV Rank at ${iv}, implied volatility is elevated relative to the past year. Covered calls and CSPs will collect richer premiums. Consider selling the 30-45 DTE range.`
                    : iv < 20
                    ? `IV Rank at ${iv} indicates options are cheap. Buying long calls or puts costs less than usual. Protective puts are affordable for hedging.`
                    : `IV Rank ${iv} is moderate. Standard premium selling strategies work well. Covered calls at 30 delta offer a good balance of income and upside participation.`}
                </div>
              </div>
            </div>
          )}

          {/* ── Option Chain ── */}
          {centerTab === 'chain' && h && (
            <div>
              {/* Controls */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 18px', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 2 }}>
                <select value={expiryIdx} onChange={e => setExpiryIdx(Number(e.target.value))}
                  style={{ ...S.inputBase, width: 'auto', height: 28, padding: '0 8px', fontFamily: 'var(--font-mono)' }}>
                  {EXPIRIES.map((exp, i) => (
                    <option key={i} value={i}>{exp.label} ({exp.dte}d)</option>
                  ))}
                </select>
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>
                  {h.ticker} · Spot ${price.toFixed(2)} · IV {iv}%
                </span>
              </div>

              {/* Chain table */}
              <div style={{ padding: '0 18px 20px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 72px 1fr', gap: 0, marginTop: 8 }}>
                  {/* Calls header */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                    {['Delta', 'IV%', 'Bid', 'Ask', 'Vol'].map(h => (
                      <div key={h} style={{ fontSize: 9, color: 'var(--text-4)', textAlign: 'right', padding: '0 4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid var(--border)', fontSize: 9, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>STRIKE</div>
                  {/* Puts header */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                    {['Vol', 'Bid', 'Ask', 'IV%', 'Delta'].map(h => (
                      <div key={h} style={{ fontSize: 9, color: 'var(--text-4)', textAlign: 'right', padding: '0 4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</div>
                    ))}
                  </div>
                </div>

                {chainData.map((row, i) => {
                  const atmStyle: React.CSSProperties = row.isATM ? { background: 'rgba(245,158,11,0.08)' } : {}
                  const callITMStyle: React.CSSProperties = row.isCallITM ? { background: 'rgba(21,128,61,0.04)' } : {}
                  return (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 72px 1fr', gap: 0, borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }}
                      onClick={() => setStaged({ ticker: h.ticker, type: `${h.ticker} Call $${row.strike.toFixed(2)}`, description: `${row.callDelta}Δ · IV ${row.callIV}%`, premium: `$${row.callAsk}`, strike: `$${row.strike.toFixed(2)}`, expiry: EXPIRIES[expiryIdx].label })}>
                      {/* Call side */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', ...atmStyle, ...callITMStyle }}>
                        {[row.callDelta, row.callIV + '%', '$' + row.callBid, '$' + row.callAsk, fmtN(row.callVol)].map((val, j) => (
                          <div key={j} style={{ padding: '5px 4px', fontSize: 11, textAlign: 'right', fontFamily: 'var(--font-mono)', color: j === 0 ? (parseFloat(row.callDelta) > 0.5 ? 'var(--signal-bull)' : 'var(--text-3)') : 'var(--text-3)' }}>{val}</div>
                        ))}
                      </div>
                      {/* Strike */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', ...atmStyle }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, color: row.isATM ? 'var(--signal-neut)' : 'var(--text)', background: row.isATM ? 'rgba(245,158,11,0.15)' : 'transparent', padding: '1px 5px', borderRadius: 3 }}>${row.strike.toFixed(0)}</span>
                      </div>
                      {/* Put side */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', ...atmStyle }}>
                        {[fmtN(row.putVol), '$' + row.putBid, '$' + row.putAsk, row.putIV + '%', row.putDelta].map((val, j) => (
                          <div key={j} style={{ padding: '5px 4px', fontSize: 11, textAlign: 'right', fontFamily: 'var(--font-mono)', color: j === 4 ? (parseFloat(row.putDelta) < -0.5 ? 'var(--signal-bear)' : 'var(--text-3)') : 'var(--text-3)' }}>{val}</div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Strategies ── */}
          {centerTab === 'strategies' && h && (
            <div style={{ padding: '14px 18px' }}>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', marginBottom: 12 }}>
                AI-generated strategies for your {h.ticker} position based on current IV Rank {iv} and your {Math.round(h.quantity)} share position.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {strategies.map((s, i) => (
                  <div key={i} onClick={() => setSelectedStrat(selectedStrat === i ? null : i)}
                    style={{ background: 'var(--bg-subtle)', border: `1px solid ${selectedStrat === i ? s.color : 'var(--border)'}`, borderRadius: 'var(--r-lg)', padding: '12px 14px', cursor: 'pointer', transition: 'all 0.15s', position: 'relative', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: s.color }} />
                    <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)', marginBottom: 2, marginTop: 4 }}>{s.name}</div>
                    <div style={{ fontSize: 9, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{s.type} · {s.expiry}</div>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', lineHeight: 1.55, marginBottom: 10 }}>{s.desc}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                      {[{ l: 'Risk', v: s.risk }, { l: 'Reward', v: s.reward }, { l: 'Prob', v: s.prob }].map(m => (
                        <div key={m.l}>
                          <div style={{ fontSize: 9, color: 'var(--text-4)' }}>{m.l}</div>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text)', marginTop: 1 }}>{m.v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {selectedStrat !== null && (
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button onClick={() => { setChatInput(`Tell me more about the ${strategies[selectedStrat].name} strategy for my ${h.ticker} position`) }}
                    style={{ flex: 1, padding: '6px 0', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-3)', fontSize: 'var(--fs-sm)', cursor: 'pointer', fontFamily: 'inherit' }}>
                    Ask AI ↗
                  </button>
                  <button onClick={() => setCenterTab('chain')}
                    style={{ flex: 1, padding: '6px 0', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-3)', fontSize: 'var(--fs-sm)', cursor: 'pointer', fontFamily: 'inherit' }}>
                    View Chain
                  </button>
                  <button onClick={() => setStaged({ ticker: h.ticker, type: strategies[selectedStrat].name, description: strategies[selectedStrat].desc, premium: strategies[selectedStrat].reward, legs: strategies[selectedStrat].legs, expiry: strategies[selectedStrat].expiry })}
                    style={{ flex: 1, padding: '6px 0', background: 'rgba(37,99,235,0.1)', border: '1px solid rgba(37,99,235,0.3)', borderRadius: 'var(--r-md)', color: 'var(--color-info)', fontSize: 'var(--fs-sm)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
                    Stage Trade →
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── DCA Plan ── */}
          {centerTab === 'dca' && h && (
            <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {[
                  { label: 'Total capital ($)', key: 'capital', value: dcaCapital, setter: setDcaCapital },
                  { label: 'Installments', key: 'n', value: dcaN, setter: setDcaN },
                ].map(f => (
                  <div key={f.key}>
                    <div style={{ fontSize: 9, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{f.label}</div>
                    <input value={f.value} onChange={e => f.setter(e.target.value)} type="number" style={{ ...S.inputBase, height: 30 }} />
                  </div>
                ))}
                <div>
                  <div style={{ fontSize: 9, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Ticker</div>
                  <input value={h.ticker} readOnly style={{ ...S.inputBase, height: 30, color: 'var(--text-4)' }} />
                </div>
              </div>
              <button onClick={generateDCA}
                style={{ padding: '7px 0', background: 'rgba(37,99,235,0.1)', border: '1px solid rgba(37,99,235,0.3)', borderRadius: 'var(--r-md)', color: 'var(--color-info)', fontSize: 'var(--fs-sm)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
                Generate DCA Schedule
              </button>

              {dcaSchedule.length > 0 && (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: '30px 70px 80px 80px 70px 1fr', gap: 4, padding: '5px 0', borderBottom: '1px solid var(--border)', fontSize: 9, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {['#', 'Date', 'Amount', 'Est. Price', 'Shares', 'Action'].map(h => <div key={h}>{h}</div>)}
                  </div>
                  {dcaSchedule.map((row, i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '30px 70px 80px 80px 70px 1fr', gap: 4, padding: '6px 0', borderBottom: '1px solid var(--border-subtle)', alignItems: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>
                      <div>{row.num}</div>
                      <div>{row.date}</div>
                      <div>${fmtN(row.amount)}</div>
                      <div>${row.estPrice.toFixed(2)}</div>
                      <div>{row.shares}</div>
                      <div>
                        <button onClick={() => { setStagedDCA(prev => new Set(prev).add(i)); setStaged({ ticker: h.ticker, type: 'Market Buy', description: `DCA installment ${row.num} of ${dcaSchedule.length}`, premium: `$${fmtN(row.amount)}`, expiry: row.date }) }}
                          style={{ padding: '2px 8px', background: stagedDCA.has(i) ? 'rgba(21,128,61,0.1)' : 'var(--bg-subtle)', border: `1px solid ${stagedDCA.has(i) ? 'rgba(21,128,61,0.3)' : 'var(--border)'}`, borderRadius: 3, color: stagedDCA.has(i) ? 'var(--signal-bull)' : 'var(--text-4)', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit' }}>
                          {stagedDCA.has(i) ? '✓ Staged' : 'Stage'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Staged Trade Bar ── */}
        {staged && (
          <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-subtle)', padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
            <div style={{ flex: 1, display: 'flex', gap: 20 }}>
              {[
                { label: 'Strategy', value: `${staged.ticker} ${staged.type}` },
                { label: 'Legs', value: staged.legs ?? staged.description },
                staged.premium ? { label: 'Premium / Amount', value: staged.premium } : null,
                staged.expiry  ? { label: 'Expiry', value: staged.expiry } : null,
              ].filter(Boolean).map((m: any) => (
                <div key={m.label}>
                  <div style={{ fontSize: 9, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{m.label}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', color: 'var(--text)', marginTop: 1 }}>{m.value}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setStaged(null)}
                style={{ padding: '5px 12px', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-4)', fontSize: 'var(--fs-sm)', cursor: 'pointer', fontFamily: 'inherit' }}>
                Clear
              </button>
              <button onClick={() => { alert(`Sending to Moomoo:\n${staged.ticker} ${staged.type}\n${staged.legs ?? staged.description}\n\n(Connect to broker bridge to execute)`); setStaged(null) }}
                style={{ padding: '5px 16px', background: 'rgba(21,128,61,0.1)', border: '1px solid rgba(21,128,61,0.3)', borderRadius: 'var(--r-md)', color: 'var(--signal-bull)', fontSize: 'var(--fs-sm)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
                Send to Moomoo →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── RIGHT PANEL — AI Advisor ── */}
      <div style={S.rightPanel}>
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 500 }}>AI Advisor</span>
            <span style={{ fontSize: 9, background: 'rgba(37,99,235,0.12)', color: 'var(--color-info)', border: '1px solid rgba(37,99,235,0.25)', padding: '1px 5px', borderRadius: 3, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Claude</span>
          </div>
          <button onClick={() => { setMessages([]); setTimeout(() => setMessages([{ role: 'assistant', content: 'Chat cleared. Ask me anything about your portfolio.' }]), 50) }}
            style={{ background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', fontSize: 'var(--fs-xs)' }}>
            Clear
          </button>
        </div>

        {/* API key setup */}
        {!apiKeySet && (
          <div style={{ margin: '10px 12px', padding: '8px 10px', background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 'var(--r-md)', fontSize: 'var(--fs-xs)', color: 'var(--signal-neut)' }}>
            Enter your Anthropic API key to activate
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <input type="password" value={apiKeyInput} onChange={e => setApiKeyInput(e.target.value)}
                placeholder="sk-ant-…"
                style={{ flex: 1, height: 26, background: 'var(--bg)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 3, padding: '0 6px', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text)', outline: 'none' }} />
              <button onClick={() => { if (apiKeyInput.startsWith('sk-')) { setApiKey(apiKeyInput); setApiKeySet(true) } }}
                style={{ height: 26, padding: '0 10px', background: 'var(--signal-neut)', border: 'none', borderRadius: 3, fontSize: 10, color: 'var(--bg)', cursor: 'pointer', fontWeight: 500, whiteSpace: 'nowrap' }}>
                Activate
              </button>
            </div>
          </div>
        )}

        {/* Messages */}
        <div ref={chatRef} style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {messages.map((msg, i) => (
            <div key={i}>
              {msg.role === 'user' ? (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <div style={{ background: 'rgba(37,99,235,0.15)', border: '1px solid rgba(37,99,235,0.2)', borderRadius: '10px 10px 2px 10px', padding: '7px 10px', fontSize: 'var(--fs-sm)', color: 'var(--text)', maxWidth: '85%', lineHeight: 1.5 }}>
                    {msg.content}
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                    <div style={{ width: 14, height: 14, borderRadius: 3, background: 'var(--color-info)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, color: 'white', fontFamily: 'var(--font-mono)' }}>AI</div>
                    <span style={{ fontSize: 9, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Advisor</span>
                  </div>
                  <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: '2px 10px 10px 10px', padding: '8px 10px', fontSize: 'var(--fs-sm)', lineHeight: 1.55, color: 'var(--text)' }}
                    dangerouslySetInnerHTML={{ __html: formatAI(msg.content) }} />
                </div>
              )}
            </div>
          ))}
          {chatLoading && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                <div style={{ width: 14, height: 14, borderRadius: 3, background: 'var(--color-info)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, color: 'white' }}>AI</div>
                <span style={{ fontSize: 9, color: 'var(--text-4)' }}>Thinking…</span>
              </div>
              <div style={{ display: 'flex', gap: 4, padding: '8px 10px' }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--text-4)', animation: 'pulse 1.2s ease-in-out infinite', animationDelay: `${i * 0.2}s` }} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Input area */}
        <div style={{ padding: '8px 12px 10px', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
            {chips.map(chip => (
              <button key={chip} onClick={() => useQuickChip(chip)}
                style={{ fontSize: 10, padding: '3px 7px', borderRadius: 20, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-4)', cursor: 'pointer', transition: 'all 0.1s', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                {chip}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
            <textarea ref={textaRef} value={chatInput} onChange={e => { setChatInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px' }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat() } }}
              placeholder={`Ask about ${h?.ticker ?? 'portfolio'}…`} rows={1}
              style={{ flex: 1, background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '7px 9px', fontSize: 'var(--fs-sm)', fontFamily: 'inherit', color: 'var(--text)', outline: 'none', resize: 'none', minHeight: 34, maxHeight: 100, lineHeight: 1.4, boxSizing: 'border-box' }} />
            <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()}
              style={{ width: 34, height: 34, borderRadius: 'var(--r-md)', background: chatLoading || !chatInput.trim() ? 'var(--bg-subtle)' : 'var(--color-info)', border: 'none', color: 'white', cursor: chatLoading || !chatInput.trim() ? 'not-allowed' : 'pointer', flexShrink: 0, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              →
            </button>
          </div>
        </div>
      </div>

      <style>{`@keyframes pulse { 0%,80%,100%{opacity:0.2} 40%{opacity:1} }`}</style>
    </div>
  )
}
