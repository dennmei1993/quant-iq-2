import { NextResponse } from "next/server"
export async function GET() {
  const key = process.env.FMP_API_KEY ?? "MISSING"
  const url = `https://financialmodelingprep.com/stable/profile/AAPL?apikey=${key}`
  try {
    const res = await fetch(url)
    const text = await res.text()
    return NextResponse.json({ status: res.status, key_set: key !== "MISSING", key_preview: key.slice(0,6), body: text.slice(0, 300) })
  } catch (e) {
    return NextResponse.json({ error: String(e) })
  }
}