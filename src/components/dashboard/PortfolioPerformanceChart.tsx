'use client'
// src/components/dashboard/PortfolioPerformanceChart.tsx
// Portfolio value over time vs benchmark (SPY/QQQ/AXJO)
// Shows: portfolio curve, benchmark curve, cost basis line
// Hover: tooltip with date, value, benchmark, P&L
// Periods: 1M · 3M · 6M · 1Y · All

import { useState, useEffect, useRef, useCallback } from 'react'

interface DataPoint {
  date:       string
  value:      number
  invested:   number
  return_pct: number
}

interface BenchPoint {
  date:       string
  value:      number
  return_pct: number
}

interface Summary {
  start_date:       string
  total_return_pct: number
  vs_benchmark_pct: number
  benchmark_ticker: string
  unrealised_gain:  number
  realised_gain:    number
  data_points:      number
}

interface Props {
  portfolioId: string
  totalCapital: number
}

const PERIODS = ['1m', '3m', '6m', '1y', 'all'] as const
type Period = typeof PERIODS[number]

function formatCurrency(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (Math.abs(v) >= 1_000)     return `$${(v / 1_000).toFixed(1)}K`
  return `$${v.toFixed(0)}`
}

function formatPct(v: number, sign = true): string {
  return `${sign && v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

export function PortfolioPerformanceChart({ portfolioId, totalCapital }: Props) {
  const [period,    setPeriod]    = useState<Period>('3m')
  const [series,    setSeries]    = useState<DataPoint[]>([])
  const [benchmark, setBenchmark] = useState<BenchPoint[]>([])
  const [summary,   setSummary]   = useState<Summary | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [tooltip,   setTooltip]   = useState<{ x: number; y: number; idx: number } | null>(null)
  const [showBench, setShowBench] = useState(true)
  const [showCost,  setShowCost]  = useState(true)

  const svgRef  = useRef<SVGSVGElement>(null)
  const W = 800, H = 260, PAD = { top: 20, right: 16, bottom: 32, left: 64 }

  const fetch_data = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res  = await fetch(`/api/portfolio/performance?portfolio_id=${portfolioId}&period=${period}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to load')
      setSeries(data.series    ?? [])
      setBenchmark(data.benchmark ?? [])
      setSummary(data.summary  ?? null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [portfolioId, period])

  useEffect(() => { fetch_data() }, [fetch_data])

  if (loading) return (
    <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-4)', fontSize: '0.82rem' }}>
      Loading performance data…
    </div>
  )

  if (error) return (
    <div style={{ padding: '1rem', color: 'var(--signal-bear)', fontSize: '0.8rem' }}>Failed to load: {error}</div>
  )

  if (series.length === 0) return (
    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-3)', fontSize: '0.82rem' }}>
      No performance data yet. Add holdings and transactions to start tracking.
    </div>
  )

  // ── Chart geometry ────────────────────────────────────────────────────────
  const chartW = W - PAD.left - PAD.right
  const chartH = H - PAD.top  - PAD.bottom

  // Combine all values to get y scale range
  const allValues = [
    ...series.map(d => d.value),
    ...(showBench ? benchmark.map(d => d.value) : []),
    ...(showCost  ? series.map(d => d.invested)  : []),
  ].filter(v => v > 0)

  const minV = Math.min(...allValues) * 0.98
  const maxV = Math.max(...allValues) * 1.02
  const n    = series.length

  function xPos(i: number)  { return PAD.left + (i / Math.max(n - 1, 1)) * chartW }
  function yPos(v: number)  { return PAD.top  + chartH - ((v - minV) / (maxV - minV)) * chartH }

  // Build SVG path strings
  function buildPath(values: number[]): string {
    return values.map((v, i) => `${i === 0 ? 'M' : 'L'}${xPos(i).toFixed(1)},${yPos(v).toFixed(1)}`).join(' ')
  }

  const portfolioPath = buildPath(series.map(d => d.value))
  const costPath      = buildPath(series.map(d => d.invested))

  // Align benchmark to series dates
  const benchMap = Object.fromEntries(benchmark.map(b => [b.date, b.value]))
  const benchAligned = series.map(d => benchMap[d.date] ?? null)
  const benchPath = benchAligned
    .map((v, i) => v == null ? null : `${i === 0 || benchAligned[i-1] == null ? 'M' : 'L'}${xPos(i).toFixed(1)},${yPos(v).toFixed(1)}`)
    .filter(Boolean).join(' ')

  // Y axis ticks
  const yTicks = 4
  const yTickVals = Array.from({ length: yTicks + 1 }, (_, i) => minV + ((maxV - minV) * i / yTicks))

  // X axis labels — show ~5 dates
  const xLabelIdxs = [0, Math.floor(n * 0.25), Math.floor(n * 0.5), Math.floor(n * 0.75), n - 1]
    .filter((v, i, arr) => arr.indexOf(v) === i && v < n)

  // Tooltip data
  const ttPoint  = tooltip != null ? series[tooltip.idx]    : null
  const ttBench  = tooltip != null ? benchAligned[tooltip.idx] : null
  const gainColor = (v: number) => v >= 0 ? 'var(--signal-bull)' : 'var(--signal-bear)'

  // Summary stats
  const lastPoint   = series[series.length - 1]
  const firstPoint  = series[0]
  const portfolioReturn = summary?.total_return_pct ?? 0
  const benchReturn     = summary ? (benchmark[benchmark.length - 1]?.return_pct ?? 0) : 0

  return (
    <div>
      {/* ── Summary strip ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.6rem', marginBottom: '1rem' }}>
        {[
          { label: 'Current Value',   value: formatCurrency(lastPoint?.value ?? 0),        color: 'var(--text)' },
          { label: 'Total Return',    value: formatPct(portfolioReturn),                    color: gainColor(portfolioReturn) },
          { label: `vs ${summary?.benchmark_ticker ?? 'SPY'}`, value: formatPct(summary?.vs_benchmark_pct ?? 0), color: gainColor(summary?.vs_benchmark_pct ?? 0) },
          { label: 'Unrealised P&L',  value: formatCurrency(summary?.unrealised_gain ?? 0), color: gainColor(summary?.unrealised_gain ?? 0) },
          { label: 'Realised P&L',    value: formatCurrency(summary?.realised_gain   ?? 0), color: gainColor(summary?.realised_gain   ?? 0) },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: 'var(--bg-subtle)', borderRadius: 6, padding: '0.5rem 0.7rem', border: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: '0.55rem', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3, fontFamily: 'var(--font-mono)' }}>{label}</div>
            <div style={{ fontSize: '0.85rem', color, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* ── Period toggles + legend ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
        <div style={{ display: 'flex', gap: '0.3rem' }}>
          {PERIODS.map(p => (
            <button key={p} onClick={() => setPeriod(p)} style={{ padding: '0.25rem 0.6rem', fontFamily: 'var(--font-mono)', fontSize: '0.65rem', letterSpacing: '0.06em', textTransform: 'uppercase', border: `1px solid ${period === p ? 'rgba(180,83,9,0.5)' : 'var(--border)'}`, background: period === p ? 'rgba(180,83,9,0.15)' : 'none', color: period === p ? 'var(--gold)' : 'var(--text-3)', borderRadius: 4, cursor: 'pointer' }}>
              {p}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center' }}>
          <button onClick={() => setShowBench(b => !b)} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', opacity: showBench ? 1 : 0.4 }}>
            <div style={{ width: 20, height: 2, background: 'rgba(37,99,235,0.7)', borderRadius: 1 }} />
            <span style={{ fontSize: '0.65rem', color: 'var(--text-3)' }}>{summary?.benchmark_ticker ?? 'SPY'}</span>
          </button>
          <button onClick={() => setShowCost(c => !c)} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', opacity: showCost ? 1 : 0.4 }}>
            <div style={{ width: 20, height: 2, background: 'var(--text-4)', borderRadius: 1, borderTop: '1px dashed var(--text-4)' }} />
            <span style={{ fontSize: '0.65rem', color: 'var(--text-3)' }}>Cost basis</span>
          </button>
        </div>
      </div>

      {/* ── SVG chart ── */}
      <div style={{ position: 'relative' }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: '100%', height: 'auto', overflow: 'visible' }}
          onMouseMove={e => {
            if (!svgRef.current) return
            const rect = svgRef.current.getBoundingClientRect()
            const scaleX = W / rect.width
            const mx = (e.clientX - rect.left) * scaleX
            const chartX = mx - PAD.left
            const rawIdx = Math.round((chartX / chartW) * (n - 1))
            const idx = Math.max(0, Math.min(n - 1, rawIdx))
            setTooltip({ x: xPos(idx), y: e.clientY - rect.top, idx })
          }}
          onMouseLeave={() => setTooltip(null)}
        >
          <defs>
            <linearGradient id="portGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(21,128,61,0.15)" />
              <stop offset="100%" stopColor="rgba(21,128,61,0)" />
            </linearGradient>
            <clipPath id="chartClip">
              <rect x={PAD.left} y={PAD.top} width={chartW} height={chartH} />
            </clipPath>
          </defs>

          {/* Y axis grid + labels */}
          {yTickVals.map((v, i) => (
            <g key={i}>
              <line x1={PAD.left} x2={PAD.left + chartW} y1={yPos(v)} y2={yPos(v)}
                stroke="var(--border-subtle)" strokeWidth={1} />
              <text x={PAD.left - 6} y={yPos(v) + 4} textAnchor="end"
                fill="var(--text-4)" fontSize={9} fontFamily="monospace">
                {formatCurrency(v)}
              </text>
            </g>
          ))}

          {/* X axis labels */}
          {xLabelIdxs.map(i => (
            <text key={i} x={xPos(i)} y={H - 8} textAnchor="middle"
              fill="var(--text-4)" fontSize={9} fontFamily="monospace">
              {series[i]?.date.slice(5)}
            </text>
          ))}

          <g clipPath="url(#chartClip)">
            {/* Portfolio fill */}
            <path
              d={`${portfolioPath} L${xPos(n - 1)},${PAD.top + chartH} L${PAD.left},${PAD.top + chartH} Z`}
              fill="url(#portGrad)"
            />

            {/* Cost basis dashed line */}
            {showCost && (
              <path d={costPath} fill="none" stroke="var(--text-4)" strokeWidth={1} strokeDasharray="4 3" />
            )}

            {/* Benchmark line */}
            {showBench && benchPath && (
              <path d={benchPath} fill="none" stroke="rgba(37,99,235,0.65)" strokeWidth={1.5} />
            )}

            {/* Portfolio line */}
            <path d={portfolioPath} fill="none" stroke="rgba(21,128,61,0.85)" strokeWidth={2} />

            {/* Tooltip vertical line + dot */}
            {tooltip != null && (
              <>
                <line x1={tooltip.x} x2={tooltip.x} y1={PAD.top} y2={PAD.top + chartH}
                  stroke="var(--border)" strokeWidth={1} />
                <circle cx={tooltip.x} cy={yPos(series[tooltip.idx].value)} r={4}
                  fill="rgba(21,128,61,0.9)" stroke="var(--chart-bg)" strokeWidth={2} />
                {showBench && ttBench != null && (
                  <circle cx={tooltip.x} cy={yPos(ttBench)} r={3}
                    fill="rgba(37,99,235,0.9)" stroke="var(--chart-bg)" strokeWidth={1.5} />
                )}
              </>
            )}
          </g>
        </svg>

        {/* Tooltip box */}
        {tooltip != null && ttPoint && (
          <div style={{
            position: 'absolute',
            top: Math.max(8, tooltip.y - 100),
            left: tooltip.x / (svgRef.current ? W / svgRef.current.getBoundingClientRect().width : 1) > W * 0.65 ? 'auto' : (tooltip.x / (W / (svgRef.current?.getBoundingClientRect().width ?? W))) + 12,
            right: tooltip.x / (svgRef.current ? W / svgRef.current.getBoundingClientRect().width : 1) > W * 0.65 ? 12 : 'auto',
            background: 'rgba(0,0,0,0.85)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '0.6rem 0.8rem',
            pointerEvents: 'none',
            zIndex: 10,
            minWidth: 160,
          }}>
            <div style={{ fontSize: '0.62rem', color: 'var(--text-3)', fontFamily: 'monospace', marginBottom: 6 }}>
              {ttPoint.date}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ fontSize: '0.7rem', color: 'rgba(21,128,61,0.8)' }}>Portfolio</span>
                <span style={{ fontSize: '0.7rem', color: 'var(--text)', fontFamily: 'monospace', fontWeight: 600 }}>{formatCurrency(ttPoint.value)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-3)' }}>Return</span>
                <span style={{ fontSize: '0.7rem', fontFamily: 'monospace', color: gainColor(ttPoint.return_pct), fontWeight: 600 }}>{formatPct(ttPoint.return_pct)}</span>
              </div>
              {showBench && ttBench != null && (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ fontSize: '0.7rem', color: 'rgba(37,99,235,0.7)' }}>{summary?.benchmark_ticker ?? 'SPY'}</span>
                  <span style={{ fontSize: '0.7rem', color: 'rgba(37,99,235,0.9)', fontFamily: 'monospace' }}>{formatCurrency(ttBench)}</span>
                </div>
              )}
              {showCost && (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-4)' }}>Cost basis</span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-3)', fontFamily: 'monospace' }}>{formatCurrency(ttPoint.invested)}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Data note */}
      {summary && (
        <div style={{ fontSize: '0.6rem', color: 'var(--text-4)', marginTop: '0.5rem', fontFamily: 'monospace' }}>
          {summary.data_points} trading days · from {summary.start_date} · benchmark: {summary.benchmark_ticker} normalised to portfolio start value
        </div>
      )}
    </div>
  )
}
