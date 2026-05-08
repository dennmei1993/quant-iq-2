'use client'
// src/components/dashboard/OHLCChart.tsx
// Candlestick chart with Volume + MA20/MA50 + RSI panel
// Uses Chart.js — install if not already: npm install chart.js

import { useEffect, useRef, useState } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────────

interface PriceBar {
  date:   string
  open:   number
  high:   number
  low:    number
  close:  number
  volume: number
}

interface Props {
  prices: PriceBar[]
  ticker: string
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function calcMA(closes: number[], period: number): (number | null)[] {
  return closes.map((_, i) => {
    if (i < period - 1) return null
    const slice = closes.slice(i - period + 1, i + 1)
    return +(slice.reduce((a, b) => a + b, 0) / period).toFixed(2)
  })
}

function calcRSI(closes: number[], period = 14): (number | null)[] {
  const rsi: (number | null)[] = new Array(period).fill(null)
  let avgGain = 0, avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    if (d >= 0) avgGain += d; else avgLoss -= d
  }
  avgGain /= period; avgLoss /= period
  rsi.push(avgLoss === 0 ? 100 : +(100 - 100 / (1 + avgGain / avgLoss)).toFixed(2))
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    const gain = d > 0 ? d : 0
    const loss = d < 0 ? -d : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    rsi.push(avgLoss === 0 ? 100 : +(100 - 100 / (1 + avgGain / avgLoss)).toFixed(2))
  }
  return rsi
}

// ── Candlestick plugin ─────────────────────────────────────────────────────────

function makeCandlestickPlugin(slice: PriceBar[], bull: string, bear: string) {
  return {
    id: 'candlestick',
    beforeDatasetsDraw(chart: any) {
      const { ctx, chartArea: ca, scales } = chart
      const xScale = scales.x
      const yScale = scales.y
      if (!ca) return
      const n = slice.length
      const barW = Math.max(2, (ca.width / n) * 0.55)
      ctx.save()
      slice.forEach((d, i) => {
        const x  = xScale.getPixelForValue(i)
        const yO = yScale.getPixelForValue(d.open)
        const yC = yScale.getPixelForValue(d.close)
        const yH = yScale.getPixelForValue(d.high)
        const yL = yScale.getPixelForValue(d.low)
        const isBull = d.close >= d.open
        const color  = isBull ? bull : bear
        // Wick
        ctx.strokeStyle = color
        ctx.lineWidth   = 1
        ctx.beginPath()
        ctx.moveTo(x, yH)
        ctx.lineTo(x, yL)
        ctx.stroke()
        // Body
        const top = Math.min(yO, yC)
        const h   = Math.max(1, Math.abs(yC - yO))
        ctx.fillStyle = color
        ctx.fillRect(x - barW / 2, top, barW, h)
        if (!isBull) {
          ctx.strokeStyle = color
          ctx.lineWidth   = 0.5
          ctx.strokeRect(x - barW / 2, top, barW, h)
        }
      })
      ctx.restore()
    }
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

const PERIODS = [
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '1Y', days: 365 },
]

export default function OHLCChart({ prices, ticker }: Props) {
  const [period, setPeriod]   = useState(90)
  const mainRef  = useRef<HTMLCanvasElement>(null)
  const volRef   = useRef<HTMLCanvasElement>(null)
  const rsiRef   = useRef<HTMLCanvasElement>(null)
  const chartsRef = useRef<any[]>([])

  useEffect(() => {
    let Chart: any
    import('chart.js/auto').then(mod => {
      Chart = mod.default

      // Destroy old charts
      chartsRef.current.forEach(c => c?.destroy())
      chartsRef.current = []

      if (!mainRef.current || !volRef.current || !rsiRef.current) return
      if (!prices || prices.length === 0) return

      const slice  = prices.slice(-period)
      const labels = slice.map((_, i) => i)
      const dates  = slice.map(d => d.date)
      const closes = slice.map(d => d.close)
      const vols   = slice.map(d => d.volume)
      const ma20   = calcMA(closes, 20)
      const ma50   = calcMA(closes, 50)
      const rsi    = calcRSI(closes, 14)

      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      const BULL   = '#26a69a'
      const BEAR   = '#ef5350'
      const GRID   = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'
      const TICK   = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)'
      const FONT   = { size: 10, family: "'DM Mono', monospace" }
      const TOOLTIP_BG   = isDark ? '#1a2030' : '#fff'
      const TOOLTIP_BODY = isDark ? '#aaa' : '#555'
      const TOOLTIP_TTL  = isDark ? '#ccc' : '#333'
      const TOOLTIP_BD   = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'

      const yMin = Math.min(...slice.map(d => d.low))  * 0.995
      const yMax = Math.max(...slice.map(d => d.high)) * 1.005

      const xTickCfg = {
        color: TICK, font: FONT, maxRotation: 0,
        callback: (v: any, i: number, ticks: any[]) => {
          const step = Math.max(1, Math.floor(ticks.length / 6))
          return i % step === 0 ? dates[v] : ''
        }
      }

      // Register candlestick plugin locally
      const cplugin = makeCandlestickPlugin(slice, BULL, BEAR)

      // ── Main chart ────────────────────────────────────────────────────────
      const mainData: any = {
        labels,
        datasets: [
          // Invisible dataset — just for tooltip index alignment
          { data: closes.map(() => null), pointRadius: 0, borderWidth: 0, label: '_candle', type: 'line' },
          { label: 'MA20', data: ma20, borderColor: BULL, borderWidth: 1.2, pointRadius: 0, tension: 0.3, type: 'line', spanGaps: true },
          { label: 'MA50', data: ma50, borderColor: '#ff9800', borderWidth: 1.2, pointRadius: 0, tension: 0.3, borderDash: [4, 2], type: 'line', spanGaps: true },
        ]
      }

      chartsRef.current.push(new Chart(mainRef.current, {
        type: 'line',
        data: mainData,
        plugins: [cplugin],
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: (items: any[]) => dates[items[0].dataIndex] ?? '',
                label: (item: any) => {
                  if (item.datasetIndex === 0) {
                    const d = slice[item.dataIndex]
                    return [`O: $${d.open.toFixed(2)}  H: $${d.high.toFixed(2)}`, `L: $${d.low.toFixed(2)}  C: $${d.close.toFixed(2)}`]
                  }
                  const v = item.raw
                  if (v == null) return ''
                  return `${item.dataset.label}: $${Number(v).toFixed(2)}`
                }
              },
              backgroundColor: TOOLTIP_BG,
              borderColor: TOOLTIP_BD,
              borderWidth: 0.5,
              titleColor: TOOLTIP_TTL,
              bodyColor: TOOLTIP_BODY,
              padding: 8,
            }
          },
          scales: {
            x: { ticks: { ...xTickCfg, display: false }, grid: { color: GRID, lineWidth: 0.5 }, border: { display: false } },
            y: { min: yMin, max: yMax, position: 'right', ticks: { color: TICK, font: FONT, callback: (v: any) => '$' + Number(v).toFixed(0) }, grid: { color: GRID, lineWidth: 0.5 }, border: { display: false } }
          }
        }
      }))

      // ── Volume chart ──────────────────────────────────────────────────────
      chartsRef.current.push(new Chart(volRef.current, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            data: vols,
            backgroundColor: slice.map(d => d.close >= d.open ? 'rgba(38,166,154,0.35)' : 'rgba(239,83,80,0.3)'),
            borderWidth: 0,
            label: 'Volume'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: (i: any[]) => dates[i[0].dataIndex] ?? '',
                label: (i: any) => 'Vol: ' + (i.raw / 1e6).toFixed(1) + 'M'
              },
              backgroundColor: TOOLTIP_BG,
              borderColor: TOOLTIP_BD,
              borderWidth: 0.5,
              titleColor: TOOLTIP_TTL,
              bodyColor: TOOLTIP_BODY,
            }
          },
          scales: {
            x: { ticks: { display: false }, grid: { display: false }, border: { display: false } },
            y: { ticks: { display: false }, grid: { display: false }, border: { display: false } }
          }
        }
      }))

      // ── RSI chart ─────────────────────────────────────────────────────────
      chartsRef.current.push(new Chart(rsiRef.current, {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'RSI', data: rsi, borderColor: '#ab47bc', borderWidth: 1.2, pointRadius: 0, tension: 0.2, fill: false, spanGaps: true },
            { label: 'OB',  data: labels.map(() => 70), borderColor: 'rgba(239,83,80,0.4)', borderWidth: 0.8, borderDash: [3, 2], pointRadius: 0 },
            { label: 'OS',  data: labels.map(() => 30), borderColor: 'rgba(38,166,154,0.4)', borderWidth: 0.8, borderDash: [3, 2], pointRadius: 0 },
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              filter: (i: any) => i.datasetIndex === 0,
              callbacks: {
                title: (i: any[]) => dates[i[0].dataIndex] ?? '',
                label: (i: any) => `RSI: ${i.raw ?? '—'}`
              },
              backgroundColor: TOOLTIP_BG,
              borderColor: TOOLTIP_BD,
              borderWidth: 0.5,
              titleColor: TOOLTIP_TTL,
              bodyColor: TOOLTIP_BODY,
            }
          },
          scales: {
            x: { ticks: xTickCfg, grid: { color: GRID, lineWidth: 0.5 }, border: { display: false } },
            y: {
              min: 0, max: 100, position: 'right',
              ticks: { color: TICK, font: FONT, stepSize: 30, callback: (v: any) => String(v) },
              grid: { color: GRID, lineWidth: 0.5 },
              border: { display: false }
            }
          }
        }
      }))
    })

    return () => {
      chartsRef.current.forEach(c => c?.destroy())
      chartsRef.current = []
    }
  }, [prices, period])

  if (!prices || prices.length === 0) {
    return (
      <div style={{ padding: '24px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-faint)' }}>
        No price history available
      </div>
    )
  }

  // Slice from latest date backwards — works correctly even if data is not current
  const slice  = prices.length > 0 ? prices.slice(-Math.min(period, prices.length)) : []
  const last   = slice[slice.length - 1]
  const prev   = slice[slice.length - 2]
  const chgPct = last && prev ? ((last.close - prev.close) / prev.close * 100) : 0
  const isUp   = chgPct >= 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border-default)', flexWrap: 'wrap' }}>
        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '0.72rem', color: 'var(--text-primary)', fontWeight: 500 }}>
          {ticker}
        </span>
        {last && (
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '0.72rem' }}>
            <span style={{ color: 'var(--text-secondary)' }}>${last.close.toFixed(2)}</span>
            <span style={{ color: isUp ? '#26a69a' : '#ef5350', marginLeft: 6 }}>
              {isUp ? '+' : ''}{chgPct.toFixed(2)}%
            </span>
          </span>
        )}
        {slice.length > 0 && (
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '0.62rem', color: 'var(--text-faint)' }}>
            {slice[0].date} – {slice[slice.length - 1].date}
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {PERIODS.map(p => (
            <button
              key={p.days}
              onClick={() => setPeriod(p.days)}
              style={{
                padding: '3px 10px',
                fontFamily: "'DM Mono', monospace",
                fontSize: '0.62rem',
                letterSpacing: '0.08em',
                border: '1px solid',
                borderColor: period === p.days ? 'rgba(78,255,145,0.4)' : 'var(--border-default)',
                background: period === p.days ? 'rgba(78,255,145,0.08)' : 'none',
                color: period === p.days ? 'var(--green)' : 'var(--text-faint)',
                cursor: 'pointer',
                textTransform: 'uppercase',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        {/* Legend */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {[
            { color: '#26a69a', label: 'MA20', dash: false },
            { color: '#ff9800', label: 'MA50', dash: true },
            { color: '#ab47bc', label: 'RSI',  dash: false },
          ].map(({ color, label, dash }) => (
            <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: "'DM Mono', monospace", fontSize: '0.58rem', color: 'var(--text-faint)' }}>
              <span style={{ display: 'inline-block', width: 14, height: 0, borderTop: `1.5px ${dash ? 'dashed' : 'solid'} ${color}` }} />
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Main candlestick chart */}
      <div style={{ position: 'relative', height: 300, padding: '4px 0' }}>
        <canvas ref={mainRef} role="img" aria-label={`${ticker} candlestick price chart with MA20 and MA50`} />
      </div>

      {/* Volume bars */}
      <div style={{ position: 'relative', height: 56, borderTop: '1px solid var(--border-default)' }}>
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: '0.55rem', color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', position: 'absolute', top: 4, left: 12, zIndex: 1 }}>
          VOL
        </div>
        <canvas ref={volRef} role="img" aria-label={`${ticker} volume bars`} />
      </div>

      {/* RSI panel */}
      <div style={{ position: 'relative', height: 96, borderTop: '1px solid var(--border-default)' }}>
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: '0.55rem', color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', position: 'absolute', top: 4, left: 12, zIndex: 1 }}>
          RSI(14)
        </div>
        <canvas ref={rsiRef} role="img" aria-label={`${ticker} RSI 14-period indicator`} />
      </div>

    </div>
  )
}
