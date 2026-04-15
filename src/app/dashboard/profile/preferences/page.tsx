'use client'
// src/app/dashboard/profile/preferences/page.tsx
// Investment profile questionnaire — 8 scenario-based questions
// Derives risk_score, horizon, style, volatility_tol, min_signal, min_conviction, sector_exclude

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

// ─── Questions ────────────────────────────────────────────────────────────────

interface Option {
  id:    string
  label: string
  sub?:  string
}

interface Question {
  id:       string
  q:        string
  sub?:     string
  type:     'single' | 'multi'
  options:  Option[]
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
    q:    'Which type of investment most appeals to you?',
    sub:  'Choose the one that feels most like your natural instinct.',
    type: 'single',
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

  // ── Style ──
  const styleAnswer = answers.style as string
  const style: Profile['style'] =
    styleAnswer === 'value'    ? 'value' :
    styleAnswer === 'growth'   ? 'growth' :
    styleAnswer === 'momentum' ? 'momentum' :
    styleAnswer === 'income'   ? 'income' : 'thematic'

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

// ─── Component ────────────────────────────────────────────────────────────────

export default function PreferencesPage() {
  const router = useRouter()
  const [step,      setStep]      = useState(0)
  const [answers,   setAnswers]   = useState<Record<string, string | string[]>>({})
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [hasExisting, setHasExisting] = useState(false)

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // Load existing profile on mount
  useEffect(() => {
    async function loadProfile() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { setLoading(false); return }

        const { data } = await (supabase as any)
          .from('user_profiles')
          .select('qa_answers, qa_completed')
          .eq('user_id', user.id)
          .maybeSingle()

        if (data?.qa_completed && data?.qa_answers) {
          setAnswers(data.qa_answers)
          setHasExisting(true)
        }
      } catch { /* no profile yet */ }
      finally { setLoading(false) }
    }
    loadProfile()
  }, [])

  const totalSteps = QUESTIONS.length
  const isIntro    = step === 0
  const isResults  = step === totalSteps + 1
  const currentQ   = !isIntro && !isResults ? QUESTIONS[step - 1] : null
  const progress   = isResults ? 100 : Math.round((step / totalSteps) * 100)

  function handleSingle(questionId: string, optionId: string) {
    setAnswers(prev => ({ ...prev, [questionId]: optionId }))
  }

  function handleMulti(questionId: string, optionId: string) {
    setAnswers(prev => {
      const current = (prev[questionId] as string[]) ?? []
      const next    = current.includes(optionId)
        ? current.filter(id => id !== optionId)
        : [...current, optionId]
      return { ...prev, [questionId]: next }
    })
  }

  function canAdvance(): boolean {
    if (isIntro) return true
    if (!currentQ) return true
    if (currentQ.type === 'multi') return true  // multi is optional
    return !!answers[currentQ.id]
  }

  function advance() {
    if (step === totalSteps) {
      setStep(totalSteps + 1)  // go to results
    } else {
      setStep(s => s + 1)
    }
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not logged in')

      const profile = scoreAnswers(answers)

      const { error: upsertErr } = await (supabase as any)
        .from('user_profiles')
        .upsert({
          user_id:         user.id,
          ...profile,
          universe:        profile.universe,
          qa_completed:    true,
          qa_answers:      answers,
          qa_version:      1,
          qa_completed_at: new Date().toISOString(),
          updated_at:      new Date().toISOString(),
        }, { onConflict: 'user_id' })

      if (upsertErr) throw upsertErr
      router.push('/dashboard')
    } catch (e: any) {
      setError(e.message ?? 'Failed to save profile')
    } finally {
      setSaving(false)
    }
  }

  const derived = isResults ? scoreAnswers(answers) : null
  const summary = derived   ? profileSummary(derived) : null

  // ── Shared styles ────────────────────────────────────────────────────────
  const S = {
    page: {
      maxWidth: 600,
      margin:   '0 auto',
      padding:  '2rem 1rem',
    } as React.CSSProperties,
    card: {
      background:   'var(--navy2)',
      border:       '1px solid var(--dash-border)',
      borderRadius: 10,
      padding:      '2rem',
    } as React.CSSProperties,
    progressBar: {
      height:       3,
      background:   'rgba(255,255,255,0.06)',
      borderRadius: 2,
      marginBottom: '2rem',
      overflow:     'hidden',
    } as React.CSSProperties,
    progressFill: {
      height:     '100%',
      background: 'var(--green)',
      borderRadius: 2,
      transition: 'width 0.3s ease',
      width:      `${progress}%`,
    } as React.CSSProperties,
    question: {
      fontSize:     '1.05rem',
      fontWeight:   500,
      color:        'rgba(232,226,217,0.95)',
      lineHeight:   1.5,
      marginBottom: '0.4rem',
    } as React.CSSProperties,
    sub: {
      fontSize:     '0.78rem',
      color:        'rgba(232,226,217,0.50)',
      lineHeight:   1.6,
      marginBottom: '1.5rem',
    } as React.CSSProperties,
    btn: {
      padding:        '10px 24px',
      fontFamily:     'var(--font-mono)',
      fontSize:       '0.72rem',
      letterSpacing:  '0.08em',
      textTransform:  'uppercase' as const,
      border:         '1px solid rgba(78,255,145,0.35)',
      background:     'rgba(78,255,145,0.08)',
      color:          'var(--green)',
      borderRadius:   4,
      cursor:         'pointer',
    } as React.CSSProperties,
    btnDisabled: {
      padding:       '10px 24px',
      fontFamily:    'var(--font-mono)',
      fontSize:      '0.72rem',
      letterSpacing: '0.08em',
      textTransform: 'uppercase' as const,
      border:        '1px solid rgba(255,255,255,0.1)',
      background:    'none',
      color:         'rgba(232,226,217,0.25)',
      borderRadius:  4,
      cursor:        'not-allowed',
    } as React.CSSProperties,
    skip: {
      fontSize:   '0.72rem',
      color:      'rgba(232,226,217,0.35)',
      background: 'none',
      border:     'none',
      cursor:     'pointer',
      padding:    '10px 16px',
    } as React.CSSProperties,
  }

  // ── Intro screen ─────────────────────────────────────────────────────────
  if (isIntro) {
    if (loading) {
      return (
        <div style={S.page}>
          <div style={{ color: 'rgba(232,226,217,0.45)', fontSize: '0.8rem', textAlign: 'center', padding: '3rem' }}>
            Loading…
          </div>
        </div>
      )
    }

    return (
      <div style={S.page}>
        <div style={S.card}>
          <div style={{ fontSize: '0.6rem', color: 'rgba(232,226,217,0.45)', fontFamily: 'var(--font-mono)', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: '1rem' }}>
            Investment Profile
          </div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 500, color: 'rgba(232,226,217,0.95)', marginBottom: '0.75rem', lineHeight: 1.3 }}>
            {hasExisting ? 'Update your profile' : 'Personalise your experience'}
          </h1>
          {hasExisting && (
            <div style={{ background: 'rgba(78,255,145,0.06)', border: '1px solid rgba(78,255,145,0.2)', borderRadius: 6, padding: '8px 12px', marginBottom: '1rem', fontSize: '0.75rem', color: 'rgba(78,255,145,0.8)' }}>
              ✓ You have an existing profile — your previous answers are pre-filled. Retake to update.
            </div>
          )}
          <p style={{ fontSize: '0.82rem', color: 'rgba(232,226,217,0.60)', lineHeight: 1.7, marginBottom: '1.5rem' }}>
            Answer 8 scenario-based questions and we'll calibrate your signals, themes, and portfolio recommendations to match how you actually invest — not how you think you should.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: '2rem' }}>
            {[
              'Signals filtered to your risk appetite',
              'Themes matched to your investment horizon',
              'Sectors you want to avoid are hidden',
              'Takes about 3 minutes',
            ].map(item => (
              <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.78rem', color: 'rgba(232,226,217,0.65)' }}>
                <span style={{ color: 'var(--green)', fontSize: '0.7rem' }}>✓</span>
                {item}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button style={S.btn} onClick={advance}>Start questionnaire</button>
            <button style={S.skip} onClick={() => router.push('/dashboard/profile')}>Skip for now</button>
          </div>
        </div>
      </div>
    )
  }

  // ── Results screen ───────────────────────────────────────────────────────
  if (isResults && derived && summary) {
    const horizonLabel = { short: 'Short-term (< 1 year)', medium: 'Medium-term (1–3 years)', long: 'Long-term (3+ years)' }
    const signalLabel  = { buy: 'BUY only', watch: 'BUY + WATCH', hold: 'All signals' }

    return (
      <div style={S.page}>
        <div style={S.card}>
          <div style={{ fontSize: '0.6rem', color: 'rgba(232,226,217,0.45)', fontFamily: 'var(--font-mono)', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: '1rem' }}>
            Your profile
          </div>

          {/* Profile type */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1rem' }}>
            <span style={{ fontSize: '1.6rem', fontWeight: 700, color: summary.color, fontFamily: 'var(--font-mono)' }}>
              {summary.label}
            </span>
            <span style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'rgba(232,226,217,0.45)', border: '1px solid rgba(255,255,255,0.1)', padding: '2px 8px', borderRadius: 3 }}>
              Risk {derived.risk_score}/10
            </span>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'rgba(232,226,217,0.60)', lineHeight: 1.65, marginBottom: '1.5rem' }}>
            {summary.desc}
          </p>

          {/* Derived settings */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '1.5rem' }}>
            {[
              { label: 'Horizon',       value: horizonLabel[derived.horizon] },
              { label: 'Style',         value: derived.style.charAt(0).toUpperCase() + derived.style.slice(1) },
              { label: 'Signals shown', value: signalLabel[derived.min_signal] },
              { label: 'Min conviction',value: `${derived.min_conviction}%+` },
              { label: 'Volatility',    value: derived.volatility_tol.charAt(0).toUpperCase() + derived.volatility_tol.slice(1) },
              { label: 'Assets',        value: derived.asset_types.join(', ').toUpperCase() },
            ].map(({ label, value }) => (
              <div key={label} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 6, padding: '0.6rem 0.8rem', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ fontSize: '0.58rem', color: 'rgba(232,226,217,0.40)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3, fontFamily: 'var(--font-mono)' }}>{label}</div>
                <div style={{ fontSize: '0.78rem', color: 'rgba(232,226,217,0.85)', fontWeight: 500 }}>{value}</div>
              </div>
            ))}
          </div>

          {derived.sector_exclude.length > 0 && (
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.58rem', color: 'rgba(232,226,217,0.40)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6, fontFamily: 'var(--font-mono)' }}>Excluded sectors</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {derived.sector_exclude.map(s => (
                  <span key={s} style={{ fontSize: '0.7rem', padding: '2px 8px', background: 'rgba(239,83,80,0.1)', color: '#ef5350', border: '1px solid rgba(239,83,80,0.25)', borderRadius: 3 }}>
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {derived.universe.length > 0 && (
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.58rem', color: 'rgba(232,226,217,0.40)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6, fontFamily: 'var(--font-mono)' }}>Universe focus</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {derived.universe.map(u => {
                  const labels: Record<string, string> = {
                    us_large: 'US Large Cap', mag7: 'Mag 7', dividend: 'Dividend',
                    etf_broad: 'Broad ETFs', etf_sector: 'Sector ETFs', etf_global: 'Global ETFs',
                    small_mid: 'Small/Mid Cap', thematic: 'Thematic',
                  }
                  return (
                    <span key={u} style={{ fontSize: '0.7rem', padding: '2px 8px', background: 'rgba(200,169,110,0.1)', color: 'rgba(200,169,110,0.85)', border: '1px solid rgba(200,169,110,0.25)', borderRadius: 3 }}>
                      {labels[u] ?? u}
                    </span>
                  )
                })}
              </div>
            </div>
          )}

          {error && (
            <div style={{ fontSize: '0.75rem', color: '#ef5350', marginBottom: '1rem' }}>{error}</div>
          )}

          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button style={saving ? S.btnDisabled : S.btn} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Apply this profile'}
            </button>
            <button style={S.skip} onClick={() => setStep(1)}>Retake</button>
          </div>
        </div>
      </div>
    )
  }

  // ── Question screen ──────────────────────────────────────────────────────
  if (!currentQ) return null

  const selected = answers[currentQ.id]

  return (
    <div style={S.page}>
      {/* Progress */}
      <div style={S.progressBar}>
        <div style={S.progressFill} />
      </div>
      <div style={{ fontSize: '0.6rem', color: 'rgba(232,226,217,0.40)', fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', marginBottom: '1.2rem' }}>
        Question {step} of {totalSteps}
      </div>

      <div style={S.card}>
        <p style={S.question}>{currentQ.q}</p>
        {currentQ.sub && <p style={S.sub}>{currentQ.sub}</p>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: '2rem' }}>
          {currentQ.options.map(opt => {
            const isSelected = currentQ.type === 'single'
              ? selected === opt.id
              : ((selected as string[]) ?? []).includes(opt.id)

            return (
              <button
                key={opt.id}
                onClick={() => currentQ.type === 'single'
                  ? handleSingle(currentQ.id, opt.id)
                  : handleMulti(currentQ.id, opt.id)
                }
                style={{
                  display:     'flex',
                  alignItems:  'flex-start',
                  gap:         12,
                  padding:     '12px 14px',
                  background:  isSelected ? 'rgba(78,255,145,0.06)' : 'rgba(255,255,255,0.02)',
                  border:      `1px solid ${isSelected ? 'rgba(78,255,145,0.35)' : 'rgba(255,255,255,0.08)'}`,
                  borderRadius: 6,
                  cursor:      'pointer',
                  textAlign:   'left',
                  transition:  'all 0.12s',
                  width:       '100%',
                }}
                onMouseEnter={e => {
                  if (!isSelected) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)'
                }}
                onMouseLeave={e => {
                  if (!isSelected) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'
                }}
              >
                {/* Radio/checkbox indicator */}
                <div style={{
                  width:        16,
                  height:       16,
                  borderRadius: currentQ.type === 'multi' ? 3 : '50%',
                  border:       `1px solid ${isSelected ? 'var(--green)' : 'rgba(255,255,255,0.25)'}`,
                  background:   isSelected ? 'var(--green)' : 'none',
                  flexShrink:   0,
                  marginTop:    2,
                  display:      'flex',
                  alignItems:   'center',
                  justifyContent: 'center',
                }}>
                  {isSelected && (
                    <div style={{ width: 6, height: 6, borderRadius: currentQ.type === 'multi' ? 1 : '50%', background: 'var(--bg-base, #0f1c2e)' }} />
                  )}
                </div>
                <div>
                  <div style={{ fontSize: '0.82rem', color: isSelected ? 'rgba(232,226,217,0.95)' : 'rgba(232,226,217,0.75)', fontWeight: isSelected ? 500 : 400, lineHeight: 1.4 }}>
                    {opt.label}
                  </div>
                  {opt.sub && (
                    <div style={{ fontSize: '0.7rem', color: 'rgba(232,226,217,0.40)', marginTop: 2, lineHeight: 1.4 }}>
                      {opt.sub}
                    </div>
                  )}
                </div>
              </button>
            )
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button
            style={S.skip}
            onClick={() => setStep(s => Math.max(1, s - 1))}
            disabled={step === 1}
          >
            ← Back
          </button>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {currentQ.type === 'single' && !selected && (
              <button style={S.skip} onClick={advance}>Skip</button>
            )}
            <button
              style={canAdvance() ? S.btn : S.btnDisabled}
              onClick={advance}
              disabled={!canAdvance()}
            >
              {step === totalSteps ? 'See results →' : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
