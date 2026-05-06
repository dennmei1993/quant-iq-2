// testPoliticianTrades.mjs — node testPoliticianTrades.mjs
// Tests FMP congressional trading API (House + Senate).
// Set key: $env:FMP_API_KEY="your_key"  (PowerShell)
// Get free key at: https://financialmodelingprep.com

const FMP_API_KEY = process.env.FMP_API_KEY
const FMP_BASE    = 'https://financialmodelingprep.com/stable'

if (!FMP_API_KEY) {
  console.error('Missing FMP_API_KEY')
  console.error('  PowerShell: $env:FMP_API_KEY="your_key"; node testPoliticianTrades.mjs')
  process.exit(1)
}

const LOOKBACK_DAYS = 7

function getCutoff() {
  const d = new Date()
  d.setDate(d.getDate() - LOOKBACK_DAYS)
  return d
}

async function testEndpoint(name, url) {
  console.log(`\n${'═'.repeat(50)}`)
  console.log(`${name}`)
  console.log('═'.repeat(50))
  console.log(`→ GET ${url.replace(FMP_API_KEY, '***')}`)

  const res = await fetch(url)
  console.log(`← ${res.status} ${res.statusText}`)
  if (!res.ok) { console.error('✗ FAILED:', await res.text()); return }

  const data   = await res.json()
  const trades = Array.isArray(data) ? data : data.data ?? []
  console.log(`✓ Total records: ${trades.length}`)

  if (trades.length > 0) {
    console.log('\nSample record keys:', Object.keys(trades[0]).join(', '))
    console.log('\nSample trade:')
    console.log(JSON.stringify(trades[0], null, 2))

    // Filter to last 7 days
    const cutoff = getCutoff()
    const dateField = trades[0].dateRecieved ? 'dateRecieved' : 'disclosureDate'
    const recent = trades.filter(t => t[dateField] && new Date(t[dateField]) >= cutoff)
    console.log(`\nTrades in last ${LOOKBACK_DAYS} days: ${recent.length}`)

    const purchases = recent.filter(t => (t.type ?? '').toLowerCase().includes('purchase'))
    const tickers   = [...new Set(recent.map(t => t.symbol).filter(t => t && t !== '--'))]
    console.log(`Purchases: ${purchases.length}`)
    console.log(`Unique tickers: ${tickers.length}`)
    console.log(`Sample tickers: ${tickers.slice(0, 10).join(', ')}`)
  }
}

async function main() {
  await testEndpoint('FMP SENATE TRADING', `${FMP_BASE}/senate-latest?page=0&limit=100&apikey=${FMP_API_KEY}`)
  await testEndpoint('FMP HOUSE TRADING',  `${FMP_BASE}/house-latest?page=0&limit=100&apikey=${FMP_API_KEY}`)
  console.log('\n\nDone.')
}

main().catch(console.error)
