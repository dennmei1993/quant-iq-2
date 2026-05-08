'use client'
// src/components/dashboard/RelativePerformanceChart.tsx
// Indexed performance chart: ticker vs SPY, QQQ, and sector average
// All series start at 100 on the first common date

import { useEffect, useRef, useState } from 'react'

interface PricePoint { date: string; close: number }

interface Props {
  ticker:        string
  tickerPrices:  PricePoint[]
  spyPrices:     PricePoint[]
  qqqPrices:     PricePoint[]
  sectorPrices:  PricePoint[]   // pre-averaged sector daily closes
  sector:        string | null
}

const PERIODS = [
  { label: '1M', days: 30  },
  { label: '3M', days: 90  },
  { label: '1Y', days: 365 },
]

// Index a price series to 100 at first point
function indexSeries(prices: PricePoint[]): PricePoint[] {
  if (prices.length === 0) return []
  const base = prices[0].close
  if (!base) return []
  return prices.map(p => ({ date: p.date, close: +(p.close / base * 100).toFixed(3) }))
}

// Align multiple series to common dates
function alignSeries(
  dates: string[],
  map:   Map<string, number>
): (number | null)[] {
  return dates.map(d => map.get(d) ?? null)
}

export default function RelativePerformanceChart({
  ticker, tickerPrices, spyPrices, qqqPrices, sectorPrices, sector,
}: Props) {
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const chartRef    = useRef<any>(null)
  const wrapRef     = useRef<HTMLDivElement>(null)
  const [period, setPeriod] = useState(90)
  const [visible, setVisible] = useState(false)

  // Detect when parent <details> is opened — canvas has no dimensions until then
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    // Walk up to find the nearest <details> ancestor
    const details = el.closest('details')
    if (!details) {
      setVisible(true)  // not inside details, always visible
      return
    }
    if (details.open) setVisible(true)
    const handler = () => { if (details.open) setVisible(true) }
    details.addEventListener('toggle', handler)
    return () => details.removeEventListener('toggle', handler)
  }, [])

  useEffect(() => {
    if (!visible) return
    if (!canvasRef.current) return
    if (tickerPrices.length === 0) return

    import('chart.js/auto').then(mod => {
      const Chart = mod.default
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null }

      // Build full lookup maps keyed by date for all series
      const toMap = (arr: PricePoint[]) => new Map(arr.map(p => [p.date, p.close]))
      const spyMap = toMap(spyPrices)
      const qqqMap = toMap(qqqPrices)
      const secMap = toMap(sectorPrices)

      // Calculate cutoff date based on period (calendar-based, not count-based)
      const latestDate = tickerPrices[tickerPrices.length - 1]?.date ?? ''
      const cutoff = (() => {
        if (!latestDate) return ''
        const d = new Date(latestDate)
        if (period === 30)  d.setMonth(d.getMonth() - 1)
        if (period === 90)  d.setMonth(d.getMonth() - 3)
        if (period === 365) d.setFullYear(d.getFullYear() - 1)
        return d.toISOString().slice(0, 10)
      })()

      // Filter ticker prices from cutoff date onwards
      const tSlice = tickerPrices.filter(p => p.date >= cutoff)

      // Use ticker dates as the canonical axis — benchmarks align to these dates
      const dates     = tSlice.map(p => p.date)
      const firstDate = dates[0]

      // Base values: find closest available date in each benchmark at period start
      // Walk forward up to 5 days to handle weekends/holidays
      const findBase = (map: Map<string, number>, startDate: string): number => {
        const allDates = [...map.keys()].sort()
        // Find nearest date >= startDate
        const idx = allDates.findIndex(d => d >= startDate)
        if (idx === -1) return map.get(allDates[allDates.length - 1]) ?? 0
        return map.get(allDates[idx]) ?? 0
      }

      const tBase   = tSlice[0]?.close ?? 0
      const spyBase = findBase(spyMap, firstDate)
      const qqqBase = findBase(qqqMap, firstDate)
      const secBase = findBase(secMap, firstDate)

      // Forward-fill: if a date is missing use last known value
      const indexedValues = (
        map: Map<string, number>,
        base: number,
        invest: number = 10_000
      ): (number | null)[] => {
        if (!base) return dates.map(() => null)
        let last = base
        return dates.map(d => {
          const v = map.get(d)
          if (v != null) last = v
          return +(last / base * invest)
        })
      }

      const INVEST = 10_000

      const tData      = tSlice.map(p => tBase ? +(p.close / tBase * INVEST) : null)
      const spyIndexed = indexedValues(spyMap, spyBase, INVEST)
      const qqqIndexed = indexedValues(qqqMap, qqqBase, INVEST)
      const secIndexed = indexedValues(secMap, secBase, INVEST)

      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      const GRID   = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'
      const TICK   = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)'
      const FONT   = { size: 10, family: "'DM Mono', monospace" }
      const TOOLTIP_BG  = isDark ? '#1a2030' : '#fff'
      const TOOLTIP_BD  = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'

      // Ticker color based on performance
      const lastT   = tData[tData.length - 1] ?? 100
      const tColor  = lastT >= 100 ? '#26a69a' : '#ef5350'

      const datasets = [
        {
          label:       ticker,
          data:        tData,
          borderColor: tColor,
          borderWidth: 1.5,
          pointRadius: 0,
          tension:     0.2,
          fill:        false,
        },
        {
          label:       'SPY',
          data:        spyIndexed,
          borderColor: '#7ab4e8',
          borderWidth: 1,
          borderDash:  [4, 2],
          pointRadius: 0,
          tension:     0.2,
          fill:        false,
        },
        {
          label:       'QQQ',
          data:        qqqIndexed,
          borderColor: '#ff9800',
          borderWidth: 1,
          borderDash:  [4, 2],
          pointRadius: 0,
          tension:     0.2,
          fill:        false,
        },
      ]

      // Only add sector if we have data
      if (secBase && sectorPrices.length > 0) {
        datasets.push({
          label:       sector ? `${sector} avg` : 'Sector avg',
          data:        secIndexed as any,
          borderColor: '#ab47bc',
          borderWidth: 1,
          borderDash:  [2, 3],
          pointRadius: 0,
          tension:     0.2,
          fill:        false,
        })
      }

      const xTickCfg = {
        color: TICK, font: FONT, maxRotation: 0,
        callback: (v: any, i: number, ticks: any[]) => {
          const step = Math.max(1, Math.floor(ticks.length / 6))
          return i % step === 0 ? dates[v] : ''
        }
      }

      chartRef.current = new Chart(canvasRef.current!, {
        type: 'line',
        data: { labels: dates.map((_, i) => i), datasets },
        options: {
          responsive:          true,
          maintainAspectRatio: false,
          animation:           false,
          interaction:         { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title:  (items: any[]) => dates[items[0].dataIndex] ?? '',
                label:  (item: any) => {
                  const v = item.raw
                  if (v == null) return ''
                  const gain = v - 10_000
                  const pct  = (gain / 10_000 * 100).toFixed(1)
                  const sign = gain >= 0 ? '+' : ''
                  return `${item.dataset.label}: $${Math.round(v).toLocaleString()} (${sign}${pct}%)`
                },
              },
              backgroundColor: TOOLTIP_BG,
              borderColor:     TOOLTIP_BD,
              borderWidth:     0.5,
              titleColor:      isDark ? '#ccc' : '#333',
              bodyColor:       isDark ? '#aaa' : '#555',
              padding:         8,
            },
          },
          scales: {
            x: {
              ticks:  xTickCfg,
              grid:   { color: GRID, lineWidth: 0.5 },
              border: { display: false },
            },
            y: {
              position: 'right',
              ticks: {
                color: TICK, font: FONT,
                callback: (v: any) => {
                  return '$' + Math.round(v).toLocaleString()
                },
              },
              grid:   { color: GRID, lineWidth: 0.5 },
              border: { display: false },
            },
          },
        },
      })
    })

    return () => { chartRef.current?.destroy(); chartRef.current = null }
  }, [tickerPrices, spyPrices, qqqPrices, sectorPrices, period, visible])

  // Summary stats — date-based cutoff, same logic as chart
  const latestDate  = tickerPrices[tickerPrices.length - 1]?.date ?? ''
  const statCutoff  = (() => {
    if (!latestDate) return ''
    const d = new Date(latestDate)
    if (period === 30)  d.setMonth(d.getMonth() - 1)
    if (period === 90)  d.setMonth(d.getMonth() - 3)
    if (period === 365) d.setFullYear(d.getFullYear() - 1)
    return d.toISOString().slice(0, 10)
  })()
  const tSliceStat  = tickerPrices.filter(p => p.date >= statCutoff)
  const firstDate   = tSliceStat[0]?.date ?? ''
  const tFirst      = tSliceStat[0]?.close ?? 0
  const tLast       = tSliceStat[tSliceStat.length - 1]?.close ?? 0
  const tRet        = tFirst ? ((tLast - tFirst) / tFirst * 100) : 0
  const tVal        = tFirst ? +(tLast / tFirst * 10_000) : 10_000

  const benchReturnByDate = (prices: PricePoint[]): number => {
    if (!firstDate || prices.length === 0) return 0
    const sorted = [...prices].sort((a, b) => a.date.localeCompare(b.date))
    // Find first price at or after firstDate
    const startIdx = sorted.findIndex(p => p.date >= firstDate)
    if (startIdx === -1) return 0
    const baseClose = sorted[startIdx].close
    const lastClose = sorted[sorted.length - 1].close
    return baseClose ? ((lastClose - baseClose) / baseClose * 100) : 0
  }

  const spyRet = benchReturnByDate(spyPrices)
  const qqqRet = benchReturnByDate(qqqPrices)
  const secRet = benchReturnByDate(sectorPrices)

  const alpha  = tRet - spyRet

  return (
    <div ref={wrapRef} style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border-default)', flexWrap: 'wrap' }}>
        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '0.65rem', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          $10k invested
        </span>

        {/* $10k investment summary */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginLeft: 4 }}>
          {[
            { label: ticker, val: tRet,   color: tRet >= 0 ? '#26a69a' : '#ef5350' },
            { label: 'SPY',  val: spyRet, color: '#7ab4e8' },
            { label: 'QQQ',  val: qqqRet, color: '#ff9800' },
            ...(sectorPrices.length > 0 ? [{ label: sector ?? 'Sector', val: secRet, color: '#ab47bc' }] : []),
          ].map(({ label, val, color }) => {
            const endVal = 10_000 * (1 + val / 100)
            return (
              <span key={label} style={{ fontFamily: "'DM Mono', monospace", fontSize: '0.65rem' }}>
                <span style={{ color: 'var(--text-faint)', marginRight: 2 }}>{label}</span>
                <span style={{ color, fontWeight: 500 }}>${Math.round(endVal).toLocaleString()}</span>
                <span style={{ color: 'rgba(232,226,217,0.3)', marginLeft: 2, fontSize: '0.58rem' }}>({val >= 0 ? '+' : ''}{val.toFixed(1)}%)</span>
              </span>
            )
          })}
        </div>

        {/* Alpha vs SPY */}
        <span style={{
          fontFamily: "'DM Mono', monospace", fontSize: '0.6rem',
          padding: '1px 6px', marginLeft: 2,
          border: `1px solid ${alpha >= 0 ? 'rgba(38,166,154,0.4)' : 'rgba(239,83,80,0.4)'}`,
          color: alpha >= 0 ? '#26a69a' : '#ef5350',
          borderRadius: 3,
        }}>
          vs SPY {alpha >= 0 ? '+' : ''}{alpha.toFixed(1)}%
        </span>

        {/* Period toggle */}
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
                background:  period === p.days ? 'rgba(78,255,145,0.08)' : 'none',
                color:       period === p.days ? 'var(--green)' : 'var(--text-faint)',
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
            { color: tRet >= 0 ? '#26a69a' : '#ef5350', label: ticker, dash: false },
            { color: '#7ab4e8', label: 'SPY',  dash: true },
            { color: '#ff9800', label: 'QQQ',  dash: true },
            ...(sectorPrices.length > 0 ? [{ color: '#ab47bc', label: sector ?? 'Sector', dash: true }] : []),
          ].map(({ color, label, dash }) => (
            <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: "'DM Mono', monospace", fontSize: '0.58rem', color: 'var(--text-faint)' }}>
              <span style={{ display: 'inline-block', width: 14, height: 0, borderTop: `1.5px ${dash ? 'dashed' : 'solid'} ${color}` }} />
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div style={{ position: 'relative', height: 220, padding: '4px 0' }}>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`${ticker} relative performance vs SPY, QQQ${sector ? ` and ${sector} sector` : ''}`}
        />
      </div>

    </div>
  )
}
