import { NextResponse } from "next/server"
export async function GET() {
  const key = process.env.FMP_API_KEY ?? "MISSING"
  const [p, r] = await Promise.all([
    fetch(`https://financialmodelingprep.com/stable/profile/AAPL?apikey=${key}`).then(r => r.json()).catch(e => ({ error: String(e) })),
    fetch(`https://financialmodelingprep.com/stable/ratios-ttm/AAPL?apikey=${key}`).then(r => r.json()).catch(e => ({ error: String(e) })),
  ])
  return NextResponse.json({ profile: p, ratios: r })
}