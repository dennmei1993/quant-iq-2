'use client'
// src/app/dashboard/settings/page.tsx

import { useState, useEffect } from 'react'

interface Profile {
  id:                 string
  email:              string
  full_name:          string | null
  display_name:       string | null
  plan:               string
  moomoo_account:     string | null
  moomoo_password:    string | null
  trading_mode:       string | null
  data_account:       string | null
  trade_account:      string | null
  anthropic_api_key:  string | null
}

interface Portfolio { id: string; name: string }

const ls: React.CSSProperties = {
  fontSize: '8.5px', fontWeight: 500, color: 'var(--text-4)',
  textTransform: 'uppercase', letterSpacing: '0.07em', display: 'block', marginBottom: 4,
}
const inputSt: React.CSSProperties = {
  padding: '6px 9px', background: 'var(--bg-subtle)',
  border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
  color: 'var(--text)', fontSize: 'var(--fs-sm)', outline: 'none',
  fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
}

export default function SettingsPage() {
  const [profile,        setProfile]        = useState<Profile | null>(null)
  const [portfolios,     setPortfolios]      = useState<Portfolio[]>([])
  const [linkedPortId,   setLinkedPortId]    = useState('')
  const [moomooAccount,  setMoomooAccount]   = useState('')
  const [moomooPassword, setMoomooPassword]  = useState('')
  const [tradingMode,    setTradingMode]     = useState<'paper' | 'live'>('paper')
  const [dataAccount,    setDataAccount]     = useState('')
  const [tradeAccount,   setTradeAccount]    = useState('')
  const [anthropicKey,   setAnthropicKey]    = useState('')
  const [showApiKey,     setShowApiKey]      = useState(false)
  const [loading,        setLoading]         = useState(true)
  const [saving,         setSaving]          = useState(false)
  const [saved,          setSaved]           = useState(false)
  const [error,          setError]           = useState('')
  const [syncing,        setSyncing]         = useState(false)
  const [syncMsg,        setSyncMsg]         = useState('')

  useEffect(() => {
    async function load() {
      const [settingsRes, portfoliosRes] = await Promise.all([
        fetch('/api/user/settings'),
        fetch('/api/portfolio'),
      ])
      if (settingsRes.ok) {
        const d = await settingsRes.json()
        setProfile(d.profile)
        setMoomooAccount(d.profile?.moomoo_account    ?? '')
        setMoomooPassword(d.profile?.moomoo_password  ?? '')
        setTradingMode(d.profile?.trading_mode        ?? 'paper')
        setDataAccount(d.profile?.data_account        ?? d.profile?.moomoo_account ?? '')
        setTradeAccount(d.profile?.trade_account      ?? '')
        setAnthropicKey(d.profile?.anthropic_api_key  ?? '')
        setLinkedPortId(d.moomoo_linked_portfolio?.id ?? '')
      }
      if (portfoliosRes.ok) {
        const d = await portfoliosRes.json()
        setPortfolios(d.portfolios ?? [])
      }
      setLoading(false)
    }
    load()
  }, [])

  async function save() {
    setSaving(true); setError(''); setSaved(false)
    try {
      const res = await fetch('/api/user/settings', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          moomoo_account:             moomooAccount.trim()  || null,
          moomoo_password:            moomooPassword.trim() || null,
          trading_mode:               tradingMode,
          data_account:               dataAccount.trim()    || null,
          trade_account:              tradeAccount.trim()   || null,
          anthropic_api_key:          anthropicKey.trim()   || null,
          moomoo_linked_portfolio_id: linkedPortId          || null,
        }),
      })
      if (!res.ok) throw new Error('Failed to save')
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function syncNow() {
    if (!linkedPortId) return
    setSyncing(true); setSyncMsg('')
    try {
      const res  = await fetch(`/api/portfolio/sync?portfolio_id=${linkedPortId}`, { method: 'POST' })
      const data = await res.json()
      setSyncMsg(data.message ?? 'Sync complete')
    } catch {
      setSyncMsg('Sync failed — check broker bridge is running')
    } finally {
      setSyncing(false)
    }
  }

  if (loading) return (
    <div style={{ color: 'var(--text-4)', fontSize: 'var(--fs-sm)', padding: '2rem 0' }}>Loading…</div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)', maxWidth: 580 }}>

      <div className="page-header">
        <div className="page-title">Settings</div>
      </div>

      {/* ── Account ── */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
        <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="section-label">Account</span>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', background: 'var(--bg-subtle)', padding: '1px 8px', borderRadius: 'var(--r-pill)', border: '1px solid var(--border)' }}>
            {profile?.plan ?? 'free'}
          </span>
        </div>
        <div style={{ padding: '12px 14px', fontSize: 'var(--fs-sm)', color: 'var(--text-3)' }}>
          Account: {profile?.email?.split('@')[0] ?? '—'}
          {profile?.full_name && <span style={{ marginLeft: 12, color: 'var(--text-4)' }}>{profile.full_name}</span>}
        </div>
      </div>

      {/* ── AI Advisor ── */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
        <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="section-label">AI Advisor</span>
          {anthropicKey && (
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--signal-bull)', background: 'rgba(21,128,61,0.08)', padding: '1px 8px', borderRadius: 'var(--r-pill)', border: '1px solid rgba(21,128,61,0.2)' }}>
              ● Active
            </span>
          )}
        </div>
        <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', lineHeight: 1.6 }}>
            Your Anthropic API key powers the AI Advisor in the Workspace. It is stored securely in your profile and never exposed to other users.
          </div>
          <div>
            <label style={ls}>Anthropic API key</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type={showApiKey ? 'text' : 'password'}
                value={anthropicKey}
                onChange={e => setAnthropicKey(e.target.value)}
                placeholder="sk-ant-api03-…"
                style={{ ...inputSt, fontFamily: anthropicKey ? 'var(--font-mono)' : 'inherit', flex: 1 }}
              />
              <button
                onClick={() => setShowApiKey(v => !v)}
                style={{ padding: '0 10px', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-4)', fontSize: 'var(--fs-xs)', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
              >
                {showApiKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', marginTop: 3 }}>
              Get your key at <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" style={{ color: 'var(--color-info)' }}>console.anthropic.com</a>
            </div>
          </div>
        </div>
      </div>

      {/* ── Moomoo ── */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
        <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="section-label">Moomoo account</span>
          {moomooAccount && (
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--signal-bull)', background: 'rgba(21,128,61,0.08)', padding: '1px 8px', borderRadius: 'var(--r-pill)', border: '1px solid rgba(21,128,61,0.2)' }}>
              ● Linked
            </span>
          )}
        </div>
        <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: 10 }}>

          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', lineHeight: 1.6 }}>
            Link your Moomoo trading account to enable broker integration. One portfolio can be synced at a time.
          </div>

          {/* Account ID + PIN */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={ls}>Trading account ID</label>
              <input value={moomooAccount} onChange={e => setMoomooAccount(e.target.value)}
                placeholder="e.g. 284008278648769324" style={inputSt} />
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', marginTop: 3 }}>Not your login ID — see account/list in bridge</div>
            </div>
            <div>
              <label style={ls}>Trade PIN</label>
              <input type="password" value={moomooPassword} onChange={e => setMoomooPassword(e.target.value)}
                placeholder="6-digit trade PIN" style={inputSt} />
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', marginTop: 3 }}>Used to unlock trading API</div>
            </div>
          </div>

          {/* Trading mode */}
          <div>
            <label style={ls}>Trading mode</label>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['paper', 'live'] as const).map(m => (
                <button key={m} onClick={() => setTradingMode(m)} style={{
                  flex: 1, padding: '5px 0', borderRadius: 'var(--r-md)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'var(--fs-sm)', fontWeight: tradingMode === m ? 600 : 400,
                  background: tradingMode === m ? (m === 'live' ? 'rgba(21,128,61,0.1)' : 'rgba(37,99,235,0.08)') : 'none',
                  border: `1px solid ${tradingMode === m ? (m === 'live' ? 'rgba(21,128,61,0.4)' : 'rgba(37,99,235,0.3)') : 'var(--border)'}`,
                  color: tradingMode === m ? (m === 'live' ? 'var(--signal-bull)' : 'var(--color-info)') : 'var(--text-4)',
                }}>
                  {m === 'paper' ? '📄 Paper trading' : '⚡ Live trading'}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 'var(--fs-xs)', color: tradingMode === 'live' ? 'var(--signal-bear)' : 'var(--text-4)', marginTop: 4, lineHeight: 1.6 }}>
              {tradingMode === 'paper'
                ? 'Orders go to simulate account — no real money. Holdings data read from real account.'
                : '⚠ Orders go to real account — real money at risk. Confirm your PIN is correct.'}
            </div>
          </div>

          {/* Data + Trade accounts */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={ls}>Data account (read)</label>
              <input value={dataAccount} onChange={e => setDataAccount(e.target.value)}
                placeholder="Real account for positions" style={inputSt} />
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', marginTop: 2 }}>Reads live positions & prices</div>
            </div>
            <div>
              <label style={ls}>Trade account (write)</label>
              <input value={tradeAccount} onChange={e => setTradeAccount(e.target.value)}
                placeholder={tradingMode === 'paper' ? '327518 (US simulate)' : 'Real account ID'}
                style={inputSt} />
              <div style={{ fontSize: 'var(--fs-xs)', color: tradingMode === 'live' ? 'var(--signal-bear)' : 'var(--text-4)', marginTop: 2 }}>
                {tradingMode === 'live' ? '⚠ Real money — double check' : 'Simulate account for paper orders'}
              </div>
            </div>
          </div>

          {/* Sync portfolio */}
          <div>
            <label style={ls}>Sync holdings to portfolio</label>
            <select value={linkedPortId} onChange={e => setLinkedPortId(e.target.value)} style={inputSt}>
              <option value="">— None (manual holdings) —</option>
              {portfolios.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-4)', marginTop: 3 }}>
              When set, "Sync now" pulls live positions from Moomoo into this portfolio's holdings.
            </div>
          </div>

          {/* Sync now */}
          {linkedPortId && moomooAccount && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={syncNow} disabled={syncing}
                style={{ padding: '4px 12px', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text-3)', fontSize: 'var(--fs-sm)', cursor: syncing ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: syncing ? 0.5 : 1 }}>
                {syncing ? 'Syncing…' : 'Sync now ↗'}
              </button>
              {syncMsg && (
                <span style={{ fontSize: 'var(--fs-xs)', color: syncMsg.includes('fail') ? 'var(--signal-bear)' : 'var(--signal-bull)' }}>
                  {syncMsg}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Save */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={save} disabled={saving} className="btn btn-dark" style={{ opacity: saving ? 0.5 : 1 }}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {saved && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--signal-bull)' }}>✓ Saved</span>}
        {error && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--signal-bear)' }}>{error}</span>}
      </div>

    </div>
  )
}
