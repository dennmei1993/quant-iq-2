'use client'
// src/app/dashboard/profile/page.tsx
// User investment preferences — drives signal scoring, portfolio advice, benchmarks

import { useState, useEffect } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type Profile = {
  risk_appetite:      'aggressive' | 'moderate' | 'conservative'
  investment_horizon: 'short' | 'medium' | 'long'
  preferred_assets:   string[]
  benchmark:          'SPY' | 'QQQ' | 'ASX200'
  target_holdings:    number
  cash_pct:           number
  display_name:       string | null
}

const DEFAULTS: Profile = {
  risk_appetite:      'moderate',
  investment_horizon: 'medium',
  preferred_assets:   ['stock', 'etf'],
  benchmark:          'SPY',
  target_holdings:    20,
  cash_pct:           0,
  display_name:       null,
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ marginBottom: '1rem' }}>
      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--cream)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {title}
      </div>
      <div style={{ fontSize: '0.68rem', color: 'rgba(232,226,217,0.3)', marginTop: '0.2rem' }}>{subtitle}</div>
    </div>
  )
}

function OptionButton({
  label, sublabel, selected, onClick, color = 'var(--gold)',
}: {
  label:     string
  sublabel?: string
  selected:  boolean
  onClick:   () => void
  color?:    string
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '0.75rem 1rem', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
        border: `1px solid ${selected ? color + '55' : 'rgba(255,255,255,0.07)'}`,
        background: selected ? `${color}12` : 'rgba(255,255,255,0.02)',
        transition: 'all 0.15s',
      }}
    >
      <div style={{ fontSize: '0.8rem', fontWeight: selected ? 600 : 400, color: selected ? color : 'rgba(232,226,217,0.6)' }}>
        {selected && <span style={{ marginRight: '0.4rem' }}>✓</span>}{label}
      </div>
      {sublabel && (
        <div style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.3)', marginTop: '0.2rem' }}>{sublabel}</div>
      )}
    </button>
  )
}

function MultiButton({
  label, selected, onClick,
}: {
  label:    string
  selected: boolean
  onClick:  () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '0.5rem 1rem', borderRadius: 6, cursor: 'pointer',
        border: `1px solid ${selected ? 'rgba(200,169,110,0.5)' : 'rgba(255,255,255,0.07)'}`,
        background: selected ? 'rgba(200,169,110,0.12)' : 'rgba(255,255,255,0.02)',
        fontSize: '0.78rem', fontWeight: selected ? 600 : 400,
        color: selected ? 'var(--gold)' : 'rgba(232,226,217,0.5)',
        transition: 'all 0.15s',
      }}
    >
      {selected && '✓ '}{label}
    </button>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const [profile,  setProfile]  = useState<Profile>(DEFAULTS)
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(false)
  const [error,    setError]    = useState('')

  // Load existing profile
  useEffect(() => {
    fetch('/api/profile')
      .then(r => r.json())
      .then(data => {
        if (data.error) return
        setProfile(prev => ({ ...prev, ...data }))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function toggle(key: keyof Profile, value: string) {
    setProfile(prev => {
      const arr = (prev[key] as string[]) ?? []
      return {
        ...prev,
        [key]: arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value],
      }
    })
  }

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      const res  = await fetch('/api/profile', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(profile),
      })
      const data = await res.json()
      if (!data.ok) { setError(data.error ?? 'Failed to save'); return }
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <div style={{ color: 'rgba(232,226,217,0.3)', fontSize: '0.82rem', padding: '2rem 0' }}>Loading preferences…</div>
  )

  return (
    <div style={{ maxWidth: 680 }}>
      <h1 style={{ color: 'var(--cream)', fontFamily: 'serif', fontSize: '1.8rem', marginBottom: '0.3rem' }}>
        Investor Profile
      </h1>
      <p style={{ color: 'rgba(232,226,217,0.35)', fontSize: '0.82rem', marginBottom: '2.5rem' }}>
        These preferences personalise your signal scoring, portfolio advice and benchmark comparisons.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

        {/* Display name */}
        <div style={{ background: 'var(--navy2)', border: '1px solid var(--dash-border)', borderRadius: 10, padding: '1.4rem 1.6rem' }}>
          <SectionTitle title="Display Name" subtitle="How you'd like to be addressed" />
          <input
            value={profile.display_name ?? ''}
            onChange={e => setProfile(p => ({ ...p, display_name: e.target.value || null }))}
            placeholder="e.g. Alex"
            style={{
              width: '100%', maxWidth: 280, boxSizing: 'border-box',
              background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(232,226,217,0.1)',
              borderRadius: 6, padding: '0.55rem 0.85rem',
              color: 'var(--cream)', fontSize: '0.85rem', outline: 'none',
            }}
          />
        </div>

        {/* Risk Appetite */}
        <div style={{ background: 'var(--navy2)', border: '1px solid var(--dash-border)', borderRadius: 10, padding: '1.4rem 1.6rem' }}>
          <SectionTitle
            title="Risk Appetite"
            subtitle="Affects signal thresholds — aggressive investors act on weaker technical signals"
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
            <OptionButton
              label="Conservative"
              sublabel="Requires strong confirmation before Buy signal"
              selected={profile.risk_appetite === 'conservative'}
              onClick={() => setProfile(p => ({ ...p, risk_appetite: 'conservative' }))}
              color="#7ab4e8"
            />
            <OptionButton
              label="Moderate"
              sublabel="Balanced approach — default thresholds"
              selected={profile.risk_appetite === 'moderate'}
              onClick={() => setProfile(p => ({ ...p, risk_appetite: 'moderate' }))}
              color="var(--gold)"
            />
            <OptionButton
              label="Aggressive"
              sublabel="Acts sooner on momentum signals"
              selected={profile.risk_appetite === 'aggressive'}
              onClick={() => setProfile(p => ({ ...p, risk_appetite: 'aggressive' }))}
              color="#4eca99"
            />
          </div>
        </div>

        {/* Investment Horizon */}
        <div style={{ background: 'var(--navy2)', border: '1px solid var(--dash-border)', borderRadius: 10, padding: '1.4rem 1.6rem' }}>
          <SectionTitle
            title="Investment Horizon"
            subtitle="Affects theme weighting — short-term favours 1M themes, long-term favours 6M themes"
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
            <OptionButton
              label="Short-term"
              sublabel="Days to weeks — momentum focused"
              selected={profile.investment_horizon === 'short'}
              onClick={() => setProfile(p => ({ ...p, investment_horizon: 'short' }))}
            />
            <OptionButton
              label="Medium-term"
              sublabel="Weeks to months — balanced"
              selected={profile.investment_horizon === 'medium'}
              onClick={() => setProfile(p => ({ ...p, investment_horizon: 'medium' }))}
            />
            <OptionButton
              label="Long-term"
              sublabel="Months to years — fundamentals focused"
              selected={profile.investment_horizon === 'long'}
              onClick={() => setProfile(p => ({ ...p, investment_horizon: 'long' }))}
            />
          </div>
        </div>

        {/* Preferred Asset Classes */}
        <div style={{ background: 'var(--navy2)', border: '1px solid var(--dash-border)', borderRadius: 10, padding: '1.4rem 1.6rem' }}>
          <SectionTitle
            title="Preferred Asset Classes"
            subtitle="Filters what appears in your screener and portfolio suggestions"
          />
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {[
              { value: 'stock',     label: 'Stocks' },
              { value: 'etf',       label: 'ETFs' },
              { value: 'crypto',    label: 'Crypto' },
              { value: 'commodity', label: 'Commodities' },
            ].map(({ value, label }) => (
              <MultiButton
                key={value}
                label={label}
                selected={(profile.preferred_assets ?? []).includes(value)}
                onClick={() => toggle('preferred_assets', value)}
              />
            ))}
          </div>
        </div>

        {/* Benchmark */}
        <div style={{ background: 'var(--navy2)', border: '1px solid var(--dash-border)', borderRadius: 10, padding: '1.4rem 1.6rem' }}>
          <SectionTitle
            title="Benchmark"
            subtitle="Your portfolio performance will be compared against this index"
          />
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {[
              { value: 'SPY',    label: 'S&P 500',    sublabel: 'via SPY' },
              { value: 'QQQ',    label: 'NASDAQ 100', sublabel: 'via QQQ' },
              { value: 'ASX200', label: 'ASX 200',    sublabel: 'via IOZ' },
            ].map(({ value, label, sublabel }) => (
              <OptionButton
                key={value}
                label={label}
                sublabel={sublabel}
                selected={profile.benchmark === value}
                onClick={() => setProfile(p => ({ ...p, benchmark: value as Profile['benchmark'] }))}
              />
            ))}
          </div>
        </div>

        {/* Portfolio size + cash */}
        <div style={{ background: 'var(--navy2)', border: '1px solid var(--dash-border)', borderRadius: 10, padding: '1.4rem 1.6rem' }}>
          <SectionTitle
            title="Portfolio Parameters"
            subtitle="Used for concentration analysis and rebalancing suggestions"
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
            <div>
              <div style={{ fontSize: '0.68rem', color: 'rgba(232,226,217,0.35)', marginBottom: '0.5rem' }}>
                Target number of holdings
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <input
                  type="range" min="5" max="50" step="1"
                  value={profile.target_holdings}
                  onChange={e => setProfile(p => ({ ...p, target_holdings: parseInt(e.target.value) }))}
                  style={{ flex: 1, accentColor: 'var(--gold)' }}
                />
                <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--gold)', fontFamily: 'monospace', minWidth: 32 }}>
                  {profile.target_holdings}
                </span>
              </div>
              <div style={{ fontSize: '0.6rem', color: 'rgba(232,226,217,0.2)', marginTop: '0.3rem' }}>
                {profile.target_holdings <= 10 ? 'Concentrated' : profile.target_holdings <= 20 ? 'Focused' : profile.target_holdings <= 35 ? 'Diversified' : 'Highly diversified'}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '0.68rem', color: 'rgba(232,226,217,0.35)', marginBottom: '0.5rem' }}>
                Cash allocation target
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <input
                  type="range" min="0" max="50" step="1"
                  value={profile.cash_pct}
                  onChange={e => setProfile(p => ({ ...p, cash_pct: parseInt(e.target.value) }))}
                  style={{ flex: 1, accentColor: '#7ab4e8' }}
                />
                <span style={{ fontSize: '1rem', fontWeight: 700, color: '#7ab4e8', fontFamily: 'monospace', minWidth: 40 }}>
                  {profile.cash_pct}%
                </span>
              </div>
              <div style={{ fontSize: '0.6rem', color: 'rgba(232,226,217,0.2)', marginTop: '0.3rem' }}>
                {profile.cash_pct === 0 ? 'Fully invested' : profile.cash_pct <= 10 ? 'Low cash buffer' : profile.cash_pct <= 25 ? 'Moderate cash buffer' : 'High cash — defensive'}
              </div>
            </div>
          </div>
        </div>

        {/* Save button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '0.75rem 2rem', borderRadius: 8, cursor: saving ? 'wait' : 'pointer',
              border: '1px solid rgba(200,169,110,0.4)',
              background: saving ? 'rgba(200,169,110,0.06)' : 'rgba(200,169,110,0.12)',
              color: 'var(--gold)', fontSize: '0.85rem', fontWeight: 600,
              transition: 'all 0.15s',
            }}
          >
            {saving ? 'Saving…' : 'Save Preferences'}
          </button>
          {saved && (
            <span style={{ fontSize: '0.78rem', color: '#4eca99' }}>✓ Preferences saved</span>
          )}
          {error && (
            <span style={{ fontSize: '0.78rem', color: '#e87070' }}>{error}</span>
          )}
        </div>

      </div>
    </div>
  )
}
