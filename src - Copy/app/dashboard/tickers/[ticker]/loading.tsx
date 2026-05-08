// src/app/dashboard/tickers/[ticker]/loading.tsx
// Shows while the server component is fetching + generating rationale

export default function TickerLoading() {
  return (
    <div>
      {/* Back link skeleton */}
      <div style={{ width: 100, height: 14, background: 'rgba(255,255,255,0.05)', borderRadius: 4, marginBottom: '1.5rem' }} />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', marginBottom: '0.4rem' }}>
            <div style={{ width: 80, height: 32, background: 'rgba(255,255,255,0.07)', borderRadius: 6 }} />
            <div style={{ width: 48, height: 20, background: 'rgba(255,255,255,0.05)', borderRadius: 4 }} />
          </div>
          <div style={{ width: 160, height: 14, background: 'rgba(255,255,255,0.04)', borderRadius: 4, marginBottom: '0.3rem' }} />
          <div style={{ width: 120, height: 11, background: 'rgba(255,255,255,0.03)', borderRadius: 4 }} />
        </div>
        <div style={{ display: 'flex', gap: '0.6rem' }}>
          <div style={{ width: 110, height: 36, background: 'rgba(255,255,255,0.04)', borderRadius: 7 }} />
          <div style={{ width: 120, height: 36, background: 'rgba(255,255,255,0.04)', borderRadius: 7 }} />
          <div style={{ width: 120, height: 36, background: 'rgba(255,255,255,0.04)', borderRadius: 7 }} />
        </div>
      </div>

      {/* Price row */}
      <div style={{
        background: 'var(--navy2)', border: '1px solid var(--dash-border)',
        borderRadius: 10, padding: '1.2rem 1.5rem', marginBottom: '1.5rem',
        display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '2rem', alignItems: 'center',
      }}>
        <div>
          <div style={{ width: 120, height: 36, background: 'rgba(255,255,255,0.07)', borderRadius: 6, marginBottom: '0.4rem' }} />
          <div style={{ width: 80, height: 16, background: 'rgba(255,255,255,0.04)', borderRadius: 4 }} />
        </div>
        <div style={{ width: 200, height: 48, background: 'rgba(255,255,255,0.04)', borderRadius: 6 }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem 1.5rem' }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i}>
              <div style={{ width: 40, height: 9, background: 'rgba(255,255,255,0.03)', borderRadius: 3, marginBottom: '0.2rem' }} />
              <div style={{ width: 60, height: 13, background: 'rgba(255,255,255,0.05)', borderRadius: 3 }} />
            </div>
          ))}
        </div>
      </div>

      {/* Two column content */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        {/* Left */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div style={{ background: 'var(--navy2)', border: '1px solid var(--dash-border)', borderRadius: 10, padding: '1.2rem 1.4rem' }}>
            <div style={{ width: 40, height: 10, background: 'rgba(255,255,255,0.04)', borderRadius: 3, marginBottom: '0.8rem' }} />
            <Skeleton lines={4} />
          </div>
          <div style={{ background: 'var(--navy2)', border: '1px solid var(--dash-border)', borderRadius: 10, padding: '1.2rem 1.4rem' }}>
            <div style={{ width: 80, height: 10, background: 'rgba(255,255,255,0.04)', borderRadius: 3, marginBottom: '0.8rem' }} />
            {/* Thinking indicator */}
            <ThinkingIndicator />
          </div>
        </div>

        {/* Right */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div style={{ background: 'var(--navy2)', border: '1px solid var(--dash-border)', borderRadius: 10, padding: '1.2rem 1.4rem' }}>
            <div style={{ width: 80, height: 10, background: 'rgba(255,255,255,0.04)', borderRadius: 3, marginBottom: '0.8rem' }} />
            {[1,2,3].map(i => (
              <div key={i} style={{ height: 44, background: 'rgba(255,255,255,0.03)', borderRadius: 6, marginBottom: '0.5rem' }} />
            ))}
          </div>
          <div style={{ background: 'var(--navy2)', border: '1px solid var(--dash-border)', borderRadius: 10, padding: '1.2rem 1.4rem' }}>
            <div style={{ width: 80, height: 10, background: 'rgba(255,255,255,0.04)', borderRadius: 3, marginBottom: '0.8rem' }} />
            {[1,2,3].map(i => (
              <div key={i} style={{ display: 'flex', gap: '0.6rem', marginBottom: '0.6rem' }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', marginTop: '0.3rem', flexShrink: 0 }} />
                <Skeleton lines={2} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function Skeleton({ lines = 3 }: { lines?: number }) {
  const widths = ['100%', '92%', '85%', '78%', '60%']
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} style={{
          height: 12,
          width: widths[i % widths.length],
          background: 'rgba(255,255,255,0.05)',
          borderRadius: 3,
        }} />
      ))}
    </div>
  )
}

function ThinkingIndicator() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 0' }}>
      <div style={{ display: 'flex', gap: '0.3rem' }}>
        {[0, 1, 2].map(i => (
          <div
            key={i}
            style={{
              width: 6, height: 6, borderRadius: '50%',
              background: 'var(--gold)',
              opacity: 0.6,
              animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </div>
      <span style={{ fontSize: '0.78rem', color: 'rgba(200,169,110,0.6)', fontStyle: 'italic' }}>
        Analysing market signals…
      </span>
      <style>{`
        @keyframes pulse {
          0%, 80%, 100% { transform: scale(0.7); opacity: 0.3; }
          40% { transform: scale(1); opacity: 0.9; }
        }
      `}</style>
    </div>
  )
}
