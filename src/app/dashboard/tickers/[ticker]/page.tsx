// src/app/dashboard/tickers/[ticker]/page.tsx
export const dynamic = 'force-dynamic'
export default async function TickerPage({ params }: { params: { ticker: string } }) {
  return   <div style={{ color: 'white', padding: '2rem' }}>Ticker: {params.ticker}</div>
}
