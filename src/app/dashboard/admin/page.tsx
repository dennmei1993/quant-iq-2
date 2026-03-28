// src/app/dashboard/admin/page.tsx
'use client'
import { useEffect, useState } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type Coverage = {
  total:      number
  with_price: number
  by_type:    { asset_type: string; total: number; with_price: number }[]
  missing:    { ticker: string; asset_type: string; bootstrap_priority: number }[]
}

type JobResult = {
  ok:      boolean
  log?:    string[]
  error?:  string
  synced?: number
  total?:  number
  scored?: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatusDot({ ok }: { ok: boolean | null }) {
  const color = ok === null ? 'rgba(232,226,217,0.2)' : ok ? '#4eca99' : '#e87070'
  return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color, marginRight: '0.4rem' }} />
}

function LogPanel({ log }: { log: string[] }) {
  if (!log.length) return null
  return (
    <div style={{
      marginTop: '0.75rem', background: 'rgba(0,0,0,0.3)',
      borderRadius: 6, padding: '0.75rem 1rem',
      fontFamily: 'monospace', fontSize: '0.72rem',
      color: 'rgba(232,226,217,0.55)', lineHeight: 1.7,
      maxHeight: 200, overflowY: 'auto',
    }}>
      {log.map((l, i) => <div key={i}>{l}</div>)}
    </div>
  )
}

// ─── Action card ─────────────────────────────────────────────────────────────

function ActionCard({
  title, description, buttonLabel, buttonColor = 'var(--gold)',
  onRun, disabled = false,
}: {
  title:        string
  description:  string
  buttonLabel:  string
  buttonColor?: string
  onRun:        () => Promise<JobResult>
  disabled?:    boolean
}) {
  const [running, setRunning] = useState(false)
  const [result,  setResult]  = useState<JobResult | null>(null)

  async function handleRun() {
    setRunning(true)
    setResult(null)
    try {
      const res = await onRun()
      setResult(res)
    } catch (e) {
      setResult({ ok: false, error: String(e) })
    }
    setRunning(false)
  }

  return (
    <div style={{
      background: 'var(--navy2)', border: '1px solid var(--dash-border)',
      borderRadius: 10, padding: '1.2rem 1.4rem',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
        <div>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--cream)', marginBottom: '0.2rem' }}>
            {result && <StatusDot ok={result.ok} />}{title}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'rgba(232,226,217,0.35)' }}>{description}</div>
        </div>
        <button
          onClick={handleRun}
          disabled={running || disabled}
          style={{
            padding: '0.5rem 1.1rem', borderRadius: 6,
            background: running ? 'rgba(200,169,110,0.15)' : `${buttonColor}22`,
            color: running ? 'rgba(232,226,217,0.3)' : buttonColor,
            fontSize: '0.8rem', fontWeight: 600, cursor: running ? 'wait' : 'pointer',
            whiteSpace: 'nowrap', flexShrink: 0, marginLeft: '1rem',
            border: `1px solid ${buttonColor}44`,
          }}
        >
          {running ? '⟳ Running…' : buttonLabel}
        </button>
      </div>

      {result && (
        <div style={{ marginTop: '0.5rem' }}>
          {result.error && (
            <div style={{ fontSize: '0.75rem', color: '#e87070' }}>{result.error}</div>
          )}
          {result.synced !== undefined && (
            <div style={{ fontSize: '0.75rem', color: 'rgba(232,226,217,0.4)' }}>
              Synced {result.synced} / {result.total} tickers
            </div>
          )}
          {result.scored !== undefined && (
            <div style={{ fontSize: '0.75rem', color: 'rgba(232,226,217,0.4)' }}>
              Scored {result.scored} aspects
            </div>
          )}
          {result.log && <LogPanel log={result.log} />}
        </div>
      )}
    </div>
  )
}

// ─── Coverage panel ───────────────────────────────────────────────────────────

function CoveragePanel() {
  const [coverage, setCoverage] = useState<Coverage | null>(null)
  const [loading,  setLoading]  = useState(true)

  async function load() {
    setLoading(true)
    try {
      const res  = await fetch('/api/admin/coverage')
      const data = await res.json()
      setCoverage(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (loading) return (
    <div style={{ background: 'var(--navy2)', border: '1px solid var(--dash-border)', borderRadius: 10, padding: '1.2rem 1.4rem' }}>
      <div style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.25)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.8rem' }}>Signal Coverage</div>
      <div style={{ color: 'rgba(232,226,217,0.25)', fontSize: '0.8rem' }}>Loading…</div>
    </div>
  )

  if (!coverage) return null

  const pct = Math.round((coverage.with_price / coverage.total) * 100)

  return (
    <div style={{ background: 'var(--navy2)', border: '1px solid var(--dash-border)', borderRadius: 10, padding: '1.2rem 1.4rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
        <div style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.25)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Signal Coverage</div>
        <button onClick={load} style={{ fontSize: '0.65rem', color: 'rgba(200,169,110,0.5)', background: 'none', border: 'none', cursor: 'pointer' }}>↻ Refresh</button>
      </div>

      {/* Overall bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
        <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3 }}>
          <div style={{ width: `${pct}%`, height: '100%', background: pct >= 80 ? '#4eca99' : pct >= 50 ? '#e09845' : '#e87070', borderRadius: 3, transition: 'width 0.3s' }} />
        </div>
        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--cream)', fontFamily: 'monospace', minWidth: '4rem', textAlign: 'right' }}>
          {coverage.with_price}/{coverage.total}
        </div>
        <div style={{ fontSize: '0.72rem', color: 'rgba(232,226,217,0.35)', minWidth: '2.5rem' }}>{pct}%</div>
      </div>

      {/* By asset type */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem', marginBottom: '1rem' }}>
        {coverage.by_type.map(t => {
          const p = Math.round((t.with_price / t.total) * 100)
          return (
            <div key={t.asset_type} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 6, padding: '0.5rem 0.6rem' }}>
              <div style={{ fontSize: '0.6rem', color: 'rgba(232,226,217,0.3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.2rem' }}>{t.asset_type}</div>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: p >= 80 ? '#4eca99' : p >= 50 ? '#e09845' : '#e87070', fontFamily: 'monospace' }}>
                {t.with_price}/{t.total}
              </div>
              <div style={{ fontSize: '0.6rem', color: 'rgba(232,226,217,0.25)' }}>{p}%</div>
            </div>
          )
        })}
      </div>

      {/* Missing tickers */}
      {coverage.missing.length > 0 && (
        <div>
          <div style={{ fontSize: '0.6rem', color: 'rgba(232,226,217,0.25)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.4rem' }}>
            Missing signals ({coverage.missing.length})
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
            {coverage.missing.map(m => (
              <span key={m.ticker} style={{
                fontSize: '0.65rem', fontFamily: 'monospace',
                background: 'rgba(232,112,112,0.08)',
                border: '1px solid rgba(232,112,112,0.2)',
                color: '#e87070', padding: '0.1rem 0.4rem', borderRadius: 3,
              }}>
                {m.ticker}
                <span style={{ opacity: 0.5, marginLeft: '0.2rem' }}>p{m.bootstrap_priority}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const CRON    = process.env.NEXT_PUBLIC_CRON_SECRET   // won't work — handled via API
  const ADMIN   = process.env.NEXT_PUBLIC_ADMIN_SECRET  // same

  async function runCron(path: string): Promise<JobResult> {
    const res  = await fetch(`/api/admin/run-cron`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ cron: path }),
    })
    return res.json()
  }

  async function syncPrices(priority: number): Promise<JobResult> {
    const res = await fetch(`/api/admin/sync-prices?priority=${priority}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    return res.json()
  }

  return (
    <div>
      <h1 style={{ color: 'var(--cream)', fontFamily: 'serif', fontSize: '1.8rem', marginBottom: '0.4rem' }}>
        Admin
      </h1>
      <p style={{ color: 'rgba(232,226,217,0.3)', fontSize: '0.8rem', marginBottom: '2rem' }}>
        Manage data pipelines and sync jobs
      </p>

      {/* Coverage */}
      <div style={{ marginBottom: '2rem' }}>
        <CoveragePanel />
      </div>

      {/* Price sync */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.25)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem' }}>
          Price Sync
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <ActionCard
            title="Sync Priority 1 — Core tickers"
            description="~17 tickers (AAPL, BTC, SPY etc) · ~65s"
            buttonLabel="▶ Run"
            onRun={() => syncPrices(1)}
          />
          <ActionCard
            title="Sync Priority 1+2 — Extended"
            description="~133 tickers · ~260s · may timeout on Vercel"
            buttonLabel="▶ Run"
            buttonColor="#8de0bf"
            onRun={() => syncPrices(2)}
          />
        </div>
      </div>

      {/* Cron jobs */}
      <div>
        <div style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.25)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem' }}>
          Cron Jobs
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <ActionCard
            title="Ingest"
            description="Fetch RSS feeds → Claude classification → alerts · ~127s"
            buttonLabel="▶ Run"
            onRun={() => runCron('ingest')}
          />
          <ActionCard
            title="Macro Scoring"
            description="Score 6 macro aspects from recent events · ~30s"
            buttonLabel="▶ Run"
            onRun={() => runCron('macro')}
          />
          <ActionCard
            title="Themes"
            description="Generate / refresh active investment themes · ~60s"
            buttonLabel="▶ Run"
            onRun={() => runCron('themes')}
          />
        </div>
      </div>
    </div>
  )
}
