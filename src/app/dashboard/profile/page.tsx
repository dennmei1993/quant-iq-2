'use client'
// src/app/dashboard/profile/page.tsx
// Merged profile + investment personality questionnaire
// Navbar entry: Profile

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'

// ─── Questions & types ───────────────────────────────────────────────────────

interface Option {
  id:    string
  label: string
  sub?:  string
}

interface Question {
  id:      string
  q:       string
  sub?:    string
  type:    'single' | 'multi'
  options: Option[]
}

const QUESTIONS: Question[] = [
  {
    id:   'drawdown',
    q:    'Your portfolio drops 20% in a month. What do you do?',
    sub:  'Be honest — what would you actually do, not what you think you should do.',
    type: 'single',
    options: [
      { id: 'sell',      label: 'Sell everything',           sub: 'Protect what\'s left and wait for clarity' },
      { id: 'hold',      label: 'Hold and wait',             sub: 'Markets recover — stay the course' },
      { id: 'rebalance', label: 'Rebalance to target',       sub: 'Systematic approach, buy what\'s fallen' },
      { id: 'buy_more',  label: 'Buy more aggressively',     sub: 'Great buying opportunity' },
    ],
  },
  {
    id:   'gamble',
    q:    'You have $10,000 to invest. Which outcome do you prefer?',
    type: 'single',
    options: [
      { id: 'safe',       label: '$9,800 guaranteed',                    sub: 'Certain, small loss' },
      { id: 'moderate',   label: '70% chance of $11,500 · 30% of $8,000', sub: 'Likely gain, limited downside' },
      { id: 'aggressive', label: '50% chance of $15,000 · 50% of $7,000', sub: 'High upside, meaningful downside' },
      { id: 'speculative', label: '25% chance of $25,000 · 75% of $6,500', sub: 'Long shot, could lose a lot' },
    ],
  },
  {
    id:   'winner',
    q:    'A stock you own surges 40% in two weeks. What do you do?',
    type: 'single',
    options: [
      { id: 'sell_all',    label: 'Sell all — lock in the gain',         sub: 'A win is a win' },
      { id: 'sell_half',   label: 'Sell half — take some profit',        sub: 'Reduce risk, keep upside' },
      { id: 'hold',        label: 'Hold — the trend may continue',       sub: 'Winners keep winning' },
      { id: 'buy_more',    label: 'Buy more — conviction is higher',     sub: 'Price action confirms the thesis' },
    ],
  },
  {
    id:   'style',
    q:    'Which type of investment appeals to you?',
    sub:  'Select all that apply — you can have multiple styles.',
    type: 'multi',
    options: [
      { id: 'value',     label: 'Undervalued companies',        sub: 'Trading below what they\'re worth' },
      { id: 'growth',    label: 'High-growth businesses',       sub: 'Expanding fast, reinvesting profits' },
      { id: 'momentum',  label: 'Stocks making new highs',      sub: 'Price action and trend following' },
      { id: 'income',    label: 'Dividend payers',              sub: 'Steady income, lower volatility' },
    ],
  },
  {
    id:   'horizon',
    q:    'How often do you plan to review and act on your portfolio?',
    type: 'single',
    options: [
      { id: 'daily',     label: 'Daily or more',           sub: 'I watch markets closely' },
      { id: 'weekly',    label: 'Weekly',                  sub: 'Stay on top of it' },
      { id: 'monthly',   label: 'Monthly',                 sub: 'Regular but not obsessive' },
      { id: 'quarterly', label: 'Quarterly or less',       sub: 'Set and forget mostly' },
    ],
  },
  {
    id:   'goal',
    q:    'Which best describes your primary investment goal?',
    type: 'single',
    options: [
      { id: 'preserve',  label: 'Preserve capital',          sub: 'Don\'t lose what I have' },
      { id: 'income',    label: 'Generate income',           sub: 'Regular returns I can use' },
      { id: 'grow',      label: 'Grow wealth steadily',      sub: '8-12% per year, manageable risk' },
      { id: 'maximise',  label: 'Maximise long-term returns', sub: 'Willing to ride out volatility' },
    ],
  },
  {
    id:   'concentration',
    q:    'How many positions are you comfortable actively tracking?',
    type: 'single',
    options: [
      { id: 'few',      label: '5 – 10 positions',      sub: 'Concentrated, high conviction' },
      { id: 'moderate', label: '10 – 20 positions',     sub: 'Balanced diversification' },
      { id: 'many',     label: '20 – 40 positions',     sub: 'Broad exposure' },
      { id: 'etf',      label: 'Mainly ETFs',           sub: 'Minimal stock picking' },
    ],
  },
  {
    id:   'exclusions',
    q:    'Are there sectors you want excluded from recommendations?',
    sub:  'Select all that apply. Leave blank for no exclusions.',
    type: 'multi',
    options: [
      { id: 'Energy',                label: 'Fossil fuels / Energy' },
      { id: 'Industrials',           label: 'Defence / Weapons' },
      { id: 'Consumer Defensive',    label: 'Tobacco / Alcohol' },
      { id: 'Financial Services',    label: 'Gambling / Finance' },
      { id: 'Healthcare',            label: 'Pharmaceuticals' },
      { id: 'Communication Services',label: 'Social Media / Tech' },
    ],
  },
  {
    id:   'universe',
    q:    'Which investment universe interests you most?',
    sub:  'Select all that apply — this shapes what tickers and themes surface for you.',
    type: 'multi',
    options: [
      { id: 'us_large',   label: 'US Large Cap Stocks',        sub: 'S&P 500 blue chips' },
      { id: 'mag7',       label: 'Mega-cap Tech (Mag 7)',       sub: 'AAPL, MSFT, NVDA, GOOG, AMZN, META, TSLA' },
      { id: 'dividend',   label: 'Dividend Stocks',            sub: 'Income-generating, lower volatility' },
      { id: 'etf_broad',  label: 'Broad Market ETFs',          sub: 'SPY, QQQ, VTI — passive exposure' },
      { id: 'etf_sector', label: 'Sector ETFs',                sub: 'XLE, XLK, XLV — targeted sector bets' },
      { id: 'etf_global', label: 'International / Global ETFs',sub: 'VWO, EFA — exposure beyond US' },
      { id: 'small_mid',  label: 'Small & Mid Cap',            sub: 'Higher growth potential, more volatility' },
      { id: 'thematic',   label: 'Thematic / Trend investing', sub: 'AI, clean energy, defence, biotech' },
    ],
  },
]

// ─── Scoring ──────────────────────────────────────────────────────────────────

interface Profile {
  risk_score:     number
  horizon:        'short' | 'medium' | 'long'
  style:          'value' | 'growth' | 'momentum' | 'income' | 'thematic'
  volatility_tol: 'low' | 'medium' | 'high'
  min_signal:     'buy' | 'watch' | 'hold'
  min_conviction: number
  sector_exclude: string[]
  asset_types:    string[]
  universe:       string[]
}

function scoreAnswers(answers: Record<string, string | string[]>): Profile {
  // ── Risk score (1=very conservative, 10=very aggressive) ──
  let riskScore = 5
  const drawdown = answers.drawdown as string
  if (drawdown === 'sell')       riskScore -= 3
  if (drawdown === 'hold')       riskScore -= 1
  if (drawdown === 'rebalance')  riskScore += 1
  if (drawdown === 'buy_more')   riskScore += 3

  const gamble = answers.gamble as string
  if (gamble === 'safe')        riskScore -= 2
  if (gamble === 'moderate')    riskScore -= 0
  if (gamble === 'aggressive')  riskScore += 2
  if (gamble === 'speculative') riskScore += 3

  const winner = answers.winner as string
  if (winner === 'sell_all')  riskScore -= 1
  if (winner === 'hold')      riskScore += 1
  if (winner === 'buy_more')  riskScore += 2

  const goal = answers.goal as string
  if (goal === 'preserve')  riskScore -= 2
  if (goal === 'income')    riskScore -= 1
  if (goal === 'maximise')  riskScore += 2

  riskScore = Math.max(1, Math.min(10, riskScore))

  // ── Volatility tolerance ──
  const volatilityTol: 'low' | 'medium' | 'high' =
    riskScore <= 3 ? 'low' :
    riskScore <= 6 ? 'medium' : 'high'

  // ── Investment horizon ──
  const horizonAnswer = answers.horizon as string
  const goalAnswer    = answers.goal as string
  let horizon: 'short' | 'medium' | 'long' =
    horizonAnswer === 'daily' || horizonAnswer === 'weekly' ? 'short' :
    horizonAnswer === 'monthly' ? 'medium' : 'long'

  // Goal modifies horizon
  if (goalAnswer === 'maximise' && horizon !== 'short') horizon = 'long'
  if (goalAnswer === 'preserve') horizon = 'short'

  // ── Style — pick primary style from multi-select ──
  const styleAnswers = Array.isArray(answers.style) ? answers.style as string[] : answers.style ? [answers.style as string] : []
  // Primary style = first selected; if income selected, adjust risk score down slightly
  const style: Profile['style'] =
    styleAnswers.includes('value')    ? 'value' :
    styleAnswers.includes('growth')   ? 'growth' :
    styleAnswers.includes('momentum') ? 'momentum' :
    styleAnswers.includes('income')   ? 'income' : 'thematic'
  // Income preference → slightly conservative
  if (styleAnswers.includes('income')) riskScore = Math.max(1, riskScore - 1)

  // ── Min signal — how selective to be ──
  let minSignal: 'buy' | 'watch' | 'hold' = 'watch'
  if (riskScore <= 3) minSignal = 'buy'    // conservative — only strong signals
  if (riskScore >= 8) minSignal = 'hold'   // aggressive — wants to see everything

  // Override based on concentration preference
  const concentration = answers.concentration as string
  if (concentration === 'few')  minSignal = 'buy'   // concentrated = only best signals
  if (concentration === 'many') minSignal = 'hold'  // broad = show more
  if (concentration === 'etf')  minSignal = 'watch' // ETF focus

  // ── Min conviction threshold ──
  let minConviction = 60
  if (riskScore <= 3) minConviction = 70  // conservative — high conviction only
  if (riskScore >= 7) minConviction = 50  // aggressive — willing to act on lower conviction
  if (concentration === 'few') minConviction = 75
  if (concentration === 'many' || concentration === 'etf') minConviction = 50

  // ── Sector exclusions ──
  const sectorExclude = (answers.exclusions as string[]) ?? []

  // ── Asset types — derived from universe selection ──
  const universe = (answers.universe as string[]) ?? []
  let assetTypes = ['stock', 'etf']
  if (universe.length > 0) {
    const wantsStock = universe.some(u => ['us_large','mag7','dividend','small_mid','thematic'].includes(u))
    const wantsEtf   = universe.some(u => ['etf_broad','etf_sector','etf_global'].includes(u))
    if (wantsStock && wantsEtf) assetTypes = ['stock', 'etf']
    else if (wantsEtf)          assetTypes = ['etf']
    else if (wantsStock)        assetTypes = ['stock']
  }
  if (concentration === 'etf') assetTypes = ['etf']

  return {
    risk_score:     riskScore,
    horizon,
    style,
    volatility_tol: volatilityTol,
    min_signal:     minSignal,
    min_conviction: minConviction,
    sector_exclude: sectorExclude,
    asset_types:    assetTypes,
    universe,
  }
}

// ─── Profile summary labels ───────────────────────────────────────────────────

function profileSummary(p: Profile): { label: string; desc: string; color: string } {
  if (p.risk_score <= 3) return {
    label: 'Conservative',
    desc:  'Capital preservation first. High-conviction BUY signals only, avoiding volatile sectors.',
    color: '#7ab4e8',
  }
  if (p.risk_score <= 5) return {
    label: 'Balanced',
    desc:  'Moderate risk for steady growth. BUY and WATCH signals, diversified across sectors.',
    color: '#e0c97a',
  }
  if (p.risk_score <= 7) return {
    label: 'Growth-oriented',
    desc:  'Comfortable with volatility for higher returns. Wider signal range, theme-driven ideas.',
    color: '#4eca99',
  }
  return {
    label: 'Aggressive',
    desc:  'Maximum growth focus. Full signal range, high conviction in concentrated positions.',
    color: '#ff9800',
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relTime(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (d === 0) return 'today'
  if (d === 1) return 'yesterday'
  return `${d} days ago`
}

const universeLabel: Record<string, string> = {
  us_large: 'US Large Cap', mag7: 'Mag 7', dividend: 'Dividend',
  etf_broad: 'Broad ETFs', etf_sector: 'Sector ETFs', etf_global: 'Global ETFs',
  small_mid: 'Small/Mid', thematic: 'Thematic',
}
const signalLabel:  Record<string, string> = { buy: 'BUY only', watch: 'BUY + WATCH', hold: 'All signals' }
const horizonLabel: Record<string, string> = { short: 'Short-term', medium: 'Medium-term', long: 'Long-term' }
const riskLabel = (s: number | null) => !s ? '—' : s <= 3 ? 'Conservative' : s <= 5 ? 'Balanced' : s <= 7 ? 'Growth' : 'Aggressive'
const riskColor = (s: number | null) => !s ? 'rgba(232,226,217,0.40)' : s <= 3 ? '#7ab4e8' : s <= 5 ? '#e0c97a' : s <= 7 ? '#4eca99' : '#ff9800'

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  // ── Identity state ──
  const [displayName, setDisplayName] = useState('')
  const [savingName,  setSavingName]  = useState(false)
  const [savedName,   setSavedName]   = useState(false)
  const [nameError,   setNameError]   = useState('')

  // ── QA state ──
  const [qaMode,      setQaMode]      = useState<'summary' | 'qa'>('summary')
  const [step,        setStep]        = useState(1)
  const [answers,     setAnswers]     = useState<Record<string, string | string[]>>({})
  const [saving,      setSaving]      = useState(false)
  const [saved,       setSaved]       = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [qaCompleted, setQaCompleted] = useState(false)
  const [qaCompletedAt, setQaCompletedAt] = useState<string | null>(null)

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    async function load() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        const { data } = await (supabase as any)
          .from('user_profiles')
          .select('display_name, risk_score, horizon, style, min_signal, min_conviction, sector_exclude, universe, qa_completed, qa_completed_at, qa_answers')
          .eq('user_id', user.id)
          .maybeSingle()
        if (data) {
          setDisplayName(data.display_name ?? '')
          setQaCompleted(data.qa_completed ?? false)
          setQaCompletedAt(data.qa_completed_at ?? null)
          if (data.qa_completed && data.qa_answers) {
            setAnswers(data.qa_answers)
          }
        }
      } catch {}
      finally { setLoading(false) }
    }
    load()
  }, [])

  async function handleSaveName() {
    setSavingName(true); setSavedName(false); setNameError('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not logged in')
      const { error: err } = await (supabase as any)
        .from('user_profiles')
        .upsert({ user_id: user.id, display_name: displayName || null, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
      if (err) throw err
      setSavedName(true)
      setTimeout(() => setSavedName(false), 3000)
    } catch (e: any) { setNameError(e.message ?? 'Failed') }
    finally { setSavingName(false) }
  }

  async function handleSaveQA() {
    setSaving(true); setError(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not logged in')
      const profile = scoreAnswers(answers)
      const now = new Date().toISOString()
      const { error: err } = await (supabase as any)
        .from('user_profiles')
        .upsert({
          user_id: user.id, ...profile,
          qa_completed: true, qa_answers: answers, qa_version: 1,
          qa_completed_at: now, updated_at: now,
        }, { onConflict: 'user_id' })
      if (err) throw err
      setQaCompleted(true)
      setQaCompletedAt(now)
      setQaMode('summary')
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e: any) { setError(e.message ?? 'Failed to save') }
    finally { setSaving(false) }
  }

  function handleSingle(qId: string, oId: string) {
    setAnswers(prev => ({ ...prev, [qId]: oId }))
  }
  function handleMulti(qId: string, oId: string) {
    setAnswers(prev => {
      const cur = (prev[qId] as string[]) ?? []
      return { ...prev, [qId]: cur.includes(oId) ? cur.filter(id => id !== oId) : [...cur, oId] }
    })
  }
  function canAdvance() {
    const q = QUESTIONS[step - 1]
    if (!q) return true
    if (q.type === 'multi') return true
    return !!answers[q.id]
  }
  function advance() {
    if (step === QUESTIONS.length) { handleSaveQA(); return }
    setStep(s => s + 1)
  }

  const derived  = qaCompleted || qaMode === 'qa' ? scoreAnswers(answers) : null
  const summary  = derived ? profileSummary(derived) : null
  const currentQ = qaMode === 'qa' ? QUESTIONS[step - 1] : null
  const progress = Math.round((step / QUESTIONS.length) * 100)

  // ── Shared button styles ──
  const btnGreen: React.CSSProperties = { padding: '8px 20px', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.08em', textTransform: 'uppercase', border: '1px solid rgba(78,255,145,0.35)', background: 'rgba(78,255,145,0.08)', color: 'var(--green)', borderRadius: 4, cursor: 'pointer' }
  const btnGold:  React.CSSProperties = { padding: '8px 20px', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.08em', textTransform: 'uppercase', border: '1px solid rgba(200,169,110,0.35)', background: 'rgba(200,169,110,0.1)', color: 'var(--gold)', borderRadius: 4, cursor: 'pointer' }
  const btnGhost: React.CSSProperties = { fontSize: '0.72rem', color: 'rgba(232,226,217,0.40)', background: 'none', border: 'none', cursor: 'pointer', padding: '8px 12px' }
  const btnDisabled: React.CSSProperties = { ...btnGreen, opacity: 0.35, cursor: 'not-allowed' }
  const card: React.CSSProperties = { background: 'var(--navy2)', border: '1px solid var(--dash-border)', borderRadius: 10, padding: '1.4rem 1.6rem' }

  if (loading) return <div style={{ color: 'rgba(232,226,217,0.45)', fontSize: '0.82rem', padding: '2rem 0' }}>Loading…</div>

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={{ color: 'var(--cream)', fontFamily: "'Syne', serif", fontSize: '1.8rem', marginBottom: '0.3rem' }}>Profile</h1>
      <p style={{ color: 'rgba(232,226,217,0.50)', fontSize: '0.82rem', marginBottom: '2rem' }}>
        Your account identity and investment personality.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

        {/* ── Display name ── */}
        <div style={card}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'rgba(232,226,217,0.65)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.2rem' }}>Display Name</div>
          <div style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.40)', marginBottom: '0.8rem' }}>How you'd like to be addressed</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="e.g. Alex"
              style={{ width: 240, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(232,226,217,0.12)', borderRadius: 6, padding: '0.55rem 0.85rem', color: 'rgba(232,226,217,0.88)', fontSize: '0.85rem', outline: 'none' }}
            />
            <button onClick={handleSaveName} disabled={savingName} style={btnGold}>{savingName ? 'Saving…' : 'Save'}</button>
            {savedName && <span style={{ fontSize: '0.72rem', color: '#4eca99' }}>✓ Saved</span>}
            {nameError && <span style={{ fontSize: '0.72rem', color: '#e87070' }}>{nameError}</span>}
          </div>
        </div>

        {/* ── Investment personality ── */}
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div>
              <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'rgba(232,226,217,0.65)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Investment Personality</div>
              <div style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.40)', marginTop: 2 }}>Scenario-based questionnaire · drives signal filtering and theme matching</div>
            </div>
            {qaMode === 'summary' && qaCompleted && (
              <button onClick={() => { setStep(1); setQaMode('qa') }} style={btnGhost}>Retake →</button>
            )}
          </div>

          {/* ── Summary view ── */}
          {qaMode === 'summary' && (
            qaCompleted && derived && summary ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1rem' }}>
                  <span style={{ fontSize: '1.4rem', fontWeight: 700, color: summary.color, fontFamily: 'var(--font-mono)' }}>{summary.label}</span>
                  <span style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: 'rgba(232,226,217,0.45)', border: '1px solid rgba(255,255,255,0.1)', padding: '2px 8px', borderRadius: 3 }}>Risk {derived.risk_score}/10</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginBottom: '0.8rem' }}>
                  {[
                    { label: 'Risk profile',   value: riskLabel(derived.risk_score),  color: riskColor(derived.risk_score) },
                    { label: 'Horizon',        value: horizonLabel[derived.horizon ?? ''] ?? '—', color: 'rgba(232,226,217,0.82)' },
                    { label: 'Style',          value: Array.isArray(answers.style) ? (answers.style as string[]).map((s: string) => s.charAt(0).toUpperCase() + s.slice(1)).join(', ') : derived.style.charAt(0).toUpperCase() + derived.style.slice(1), color: 'rgba(232,226,217,0.82)' },
                    { label: 'Signals',        value: signalLabel[derived.min_signal ?? ''] ?? '—', color: 'rgba(232,226,217,0.82)' },
                    { label: 'Min conviction', value: `${derived.min_conviction}%+`, color: 'rgba(232,226,217,0.82)' },
                    { label: 'Volatility',     value: derived.volatility_tol.charAt(0).toUpperCase() + derived.volatility_tol.slice(1), color: 'rgba(232,226,217,0.82)' },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 6, padding: '0.5rem 0.7rem', border: '1px solid rgba(255,255,255,0.05)' }}>
                      <div style={{ fontSize: '0.55rem', color: 'rgba(232,226,217,0.38)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 2, fontFamily: 'var(--font-mono)' }}>{label}</div>
                      <div style={{ fontSize: '0.75rem', color, fontWeight: 500 }}>{value}</div>
                    </div>
                  ))}
                </div>
                {derived.universe.length > 0 && (
                  <div style={{ marginBottom: '0.6rem' }}>
                    <div style={{ fontSize: '0.55rem', color: 'rgba(232,226,217,0.38)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 5, fontFamily: 'var(--font-mono)' }}>Universe</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {derived.universe.map(u => (
                        <span key={u} style={{ fontSize: '0.65rem', padding: '1px 7px', background: 'rgba(200,169,110,0.1)', color: 'rgba(200,169,110,0.8)', border: '1px solid rgba(200,169,110,0.2)', borderRadius: 3 }}>{universeLabel[u] ?? u}</span>
                      ))}
                    </div>
                  </div>
                )}
                {derived.sector_exclude.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.55rem', color: 'rgba(232,226,217,0.38)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 5, fontFamily: 'var(--font-mono)' }}>Excluded sectors</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {derived.sector_exclude.map(s => (
                        <span key={s} style={{ fontSize: '0.65rem', padding: '1px 7px', background: 'rgba(239,83,80,0.08)', color: '#ef5350', border: '1px solid rgba(239,83,80,0.2)', borderRadius: 3 }}>{s}</span>
                      ))}
                    </div>
                  </div>
                )}
                {qaCompletedAt && (
                  <div style={{ fontSize: '0.6rem', color: 'rgba(232,226,217,0.30)', marginTop: '0.8rem', fontFamily: 'var(--font-mono)' }}>Last updated {relTime(qaCompletedAt)}</div>
                )}
                {saved && <div style={{ fontSize: '0.72rem', color: '#4eca99', marginTop: 8 }}>✓ Profile saved</div>}
              </>
            ) : (
              <div>
                <p style={{ fontSize: '0.8rem', color: 'rgba(232,226,217,0.55)', lineHeight: 1.65, marginBottom: '1rem' }}>
                  Answer 9 scenario-based questions to calibrate your signals, themes and portfolio recommendations.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: '1.2rem' }}>
                  {['Signals filtered to your risk appetite', 'Themes matched to your investment horizon', 'Excluded sectors hidden throughout', 'Takes about 3 minutes'].map(item => (
                    <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.75rem', color: 'rgba(232,226,217,0.60)' }}>
                      <span style={{ color: 'var(--green)', fontSize: '0.65rem' }}>✓</span>{item}
                    </div>
                  ))}
                </div>
                <button onClick={() => { setStep(1); setQaMode('qa') }} style={btnGreen}>Start questionnaire →</button>
              </div>
            )
          )}

          {/* ── QA view ── */}
          {qaMode === 'qa' && currentQ && (
            <div>
              {/* Progress bar */}
              <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, marginBottom: '1.2rem', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${progress}%`, background: 'var(--green)', borderRadius: 2, transition: 'width 0.3s' }} />
              </div>
              <div style={{ fontSize: '0.58rem', color: 'rgba(232,226,217,0.40)', fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', marginBottom: '1rem' }}>
                Question {step} of {QUESTIONS.length}
              </div>

              <p style={{ fontSize: '1rem', fontWeight: 500, color: 'rgba(232,226,217,0.95)', lineHeight: 1.5, marginBottom: '0.35rem' }}>{currentQ.q}</p>
              {currentQ.sub && <p style={{ fontSize: '0.76rem', color: 'rgba(232,226,217,0.50)', lineHeight: 1.55, marginBottom: '1.2rem' }}>{currentQ.sub}</p>}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: '1.5rem' }}>
                {currentQ.options.map(opt => {
                  const sel = currentQ.type === 'single'
                    ? answers[currentQ.id] === opt.id
                    : ((answers[currentQ.id] as string[]) ?? []).includes(opt.id)
                  return (
                    <button key={opt.id}
                      onClick={() => currentQ.type === 'single' ? handleSingle(currentQ.id, opt.id) : handleMulti(currentQ.id, opt.id)}
                      style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', background: sel ? 'rgba(78,255,145,0.05)' : 'rgba(255,255,255,0.02)', border: `1px solid ${sel ? 'rgba(78,255,145,0.35)' : 'rgba(255,255,255,0.07)'}`, borderRadius: 6, cursor: 'pointer', textAlign: 'left', width: '100%', transition: 'all 0.1s' }}>
                      <div style={{ width: 15, height: 15, borderRadius: currentQ.type === 'multi' ? 3 : '50%', border: `1px solid ${sel ? 'var(--green)' : 'rgba(255,255,255,0.25)'}`, background: sel ? 'var(--green)' : 'none', flexShrink: 0, marginTop: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {sel && <div style={{ width: 5, height: 5, borderRadius: currentQ.type === 'multi' ? 1 : '50%', background: '#0f1c2e' }} />}
                      </div>
                      <div>
                        <div style={{ fontSize: '0.8rem', color: sel ? 'rgba(232,226,217,0.95)' : 'rgba(232,226,217,0.72)', fontWeight: sel ? 500 : 400, lineHeight: 1.4 }}>{opt.label}</div>
                        {opt.sub && <div style={{ fontSize: '0.67rem', color: 'rgba(232,226,217,0.38)', marginTop: 2, lineHeight: 1.4 }}>{opt.sub}</div>}
                      </div>
                    </button>
                  )
                })}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={btnGhost} onClick={() => setStep(s => Math.max(1, s - 1))} disabled={step === 1}>← Back</button>
                  {qaCompleted && <button style={btnGhost} onClick={() => setQaMode('summary')}>Cancel</button>}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {currentQ.type === 'single' && !answers[currentQ.id] && (
                    <button style={btnGhost} onClick={() => setStep(s => s + 1)}>Skip</button>
                  )}
                  {error && <span style={{ fontSize: '0.7rem', color: '#ef5350' }}>{error}</span>}
                  <button style={canAdvance() ? btnGreen : btnDisabled} onClick={advance} disabled={!canAdvance()}>
                    {saving ? 'Saving…' : step === QUESTIONS.length ? 'Save profile →' : 'Next →'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Portfolio settings link ── */}
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'rgba(232,226,217,0.65)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Portfolio Settings</div>
              <div style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.40)', marginTop: 2 }}>Benchmark, target holdings and cash allocation — configured per portfolio</div>
            </div>
            <a href="/dashboard/portfolio" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', letterSpacing: '0.08em', padding: '5px 12px', borderRadius: 4, textDecoration: 'none', border: '1px solid rgba(200,169,110,0.25)', color: 'rgba(200,169,110,0.7)', background: 'rgba(200,169,110,0.05)', whiteSpace: 'nowrap' }}>
              Go to Portfolio →
            </a>
          </div>
        </div>

      </div>
    </div>
  )
}
