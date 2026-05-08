// src/lib/integrations/sync13F.ts
// Fetches latest 13F-HR filings from SEC EDGAR for tracked managers.
// Called by: src/app/api/cron/ingest-13f/route.ts

import { supabaseAdmin, upsertAsset, upsertUniverseTicker, startCronLog, completeCronLog } from '@/lib/supabase/db'
import type { Json } from '@/types/supabase'

const SEC_SUBMISSIONS = 'https://data.sec.gov/submissions'
const SEC_ARCHIVES    = 'https://www.sec.gov/Archives/edgar/data'
const SEC_HEADERS     = { 'User-Agent': 'YourApp/1.0 contact@yourapp.com' }

// ─────────────────────────────────────────
// Managers to track — add/remove CIKs here
// source_key must match a row in universe_sources
// ─────────────────────────────────────────
// Berkshire has its own dedicated cron route (ingest-berkshire)
// so it can be monitored and triggered independently
export const BERKSHIRE_MANAGER = {
  cik: '0001067983', name: 'Berkshire Hathaway', sourceKey: 'BERKSHIRE',
}

// Institutional 13F filers (runs via ingest-13f route)
// CIKs verified against SEC EDGAR filing records
export const MANAGERS = [
  { cik: '0001350694', name: 'Bridgewater Associates', sourceKey: '13F' },
  { cik: '0000102909', name: 'Vanguard Group',          sourceKey: '13F' },
  { cik: '0001364742', name: 'BlackRock',               sourceKey: '13F' },
  { cik: '0000093751', name: 'State Street',            sourceKey: '13F' },
]

interface Manager {
  cik: string
  name: string
  sourceKey: string
}

interface Filing {
  accessionNumber: string
  filingDate: string
  periodOfReport: string
  url: string
}

interface Holding {
  nameOfIssuer: string
  cusip: string
  value: number
  shsOrPrnAmt: number
  investmentDiscretion: string
  putCall: string | null
}

// ─────────────────────────────────────────
// Sync a single manager — called per-manager in the route handler
// ─────────────────────────────────────────
export async function sync13F({ cik, name: managerName, sourceKey }: Manager) {
  const logId = await startCronLog({
    jobName:     `sync_13f_${sourceKey.toLowerCase()}`,
    jobGroup:    'intelligence',
    triggeredBy: 'schedule',
    meta:        { cik, manager: managerName } as Json,
  })

  let recordsIn = 0, recordsOut = 0

  try {
    // 1. Get latest 13F-HR filing metadata
    const filing = await getLatest13FFiling(cik)
    if (!filing) {
      await completeCronLog(logId, { status: 'skipped' })
      return { skipped: true, reason: 'no_filing_found' }
    }

    // 2. Idempotency — skip if already processed this accession number
    const { data: existing } = await supabaseAdmin
      .from('filings_13f')
      .select('id')
      .eq('accession_number', filing.accessionNumber)
      .maybeSingle()

    if (existing) {
      await completeCronLog(logId, { status: 'skipped' })
      return { skipped: true, reason: 'already_processed' }
    }

    // 3. Fetch and parse holdings XML from EDGAR
    const holdings = await fetchHoldings(cik, filing.accessionNumber)
    recordsIn = holdings.length

    // 4. Insert filing record
    const { data: filingRow, error: filingErr } = await supabaseAdmin
      .from('filings_13f')
      .insert({
        cik,
        manager_name:     managerName,
        source_key:       sourceKey,
        filing_date:      filing.filingDate,
        period_of_report: filing.periodOfReport,
        accession_number: filing.accessionNumber,
        raw_url:          filing.url,
      })
      .select('id')
      .single()

    if (filingErr) throw new Error(`Insert filing error: ${filingErr.message}`)
    const filingId = filingRow.id

    // 5. Bulk insert all holdings immediately — no CUSIP resolution here.
    //    Tickers are resolved lazily by the resolve-cusips cron job which
    //    processes unresolved holdings in small batches daily, avoiding
    //    OpenFIGI rate limits and Vercel's 300s timeout.
    const holdingRows = holdings.map(holding => ({
      filing_id:       filingId,
      ticker:          null,          // resolved later by resolve-cusips job
      cusip:           holding.cusip,
      company_name:    holding.nameOfIssuer,
      share_count:     holding.shsOrPrnAmt,
      value_usd:       holding.value,
      investment_type: holding.investmentDiscretion,
      put_call:        holding.putCall,
    }))

    // Bulk insert in chunks of 500 to avoid Supabase payload limits
    const CHUNK = 500
    for (let i = 0; i < holdingRows.length; i += CHUNK) {
      const { error: holdingsErr } = await supabaseAdmin
        .from('holdings_13f')
        .insert(holdingRows.slice(i, i + CHUNK))
      if (holdingsErr) throw new Error(`Insert holdings error: ${holdingsErr.message}`)
    }
    recordsOut = holdingRows.length

    await completeCronLog(logId, { status: 'success', recordsIn, recordsOut })
    return { success: true, manager: managerName, recordsIn, recordsOut }

  } catch (err) {
    const error = err as Error
    await completeCronLog(logId, {
      status:       'failed',
      recordsIn,
      recordsOut,
      errorMessage: error.message,
      errorDetail:  error.stack,
    })
    throw err
  }
}

// ─────────────────────────────────────────
// Sync all configured managers sequentially
// ─────────────────────────────────────────
// Runs all institutional 13F managers (NOT Berkshire — use syncBerkshire for that)
export async function syncAll13F() {
  const results = []
  for (const manager of MANAGERS) {
    try {
      const result = await sync13F(manager)
      results.push({ manager: manager.name, ...result })
    } catch (err) {
      results.push({ manager: manager.name, error: (err as Error).message })
    }
  }
  return results
}

// Dedicated Berkshire sync — called by ingest-berkshire/route.ts
export async function syncBerkshire() {
  return sync13F(BERKSHIRE_MANAGER)
}

// ─────────────────────────────────────────
// SEC EDGAR helpers
// ─────────────────────────────────────────
async function getLatest13FFiling(cik: string): Promise<Filing | null> {
  const paddedCik = cik.replace(/^0+/, '').padStart(10, '0')
  const res       = await fetch(`${SEC_SUBMISSIONS}/CIK${paddedCik}.json`, { headers: SEC_HEADERS })
  if (!res.ok) throw new Error(`EDGAR submissions error: ${res.status}`)

  const data = await res.json()
  const f    = data.filings?.recent
  if (!f) return null

  for (let i = 0; i < f.form.length; i++) {
    if (f.form[i] === '13F-HR') {
      const acc = f.accessionNumber[i].replace(/-/g, '')
      return {
        accessionNumber: f.accessionNumber[i],
        filingDate:      f.filingDate[i],
        periodOfReport:  f.reportDate[i],
        url:             `${SEC_ARCHIVES}/${cik.replace(/^0+/, '')}/${acc}`,
      }
    }
  }
  return null
}

async function fetchHoldings(cik: string, accessionNumber: string): Promise<Holding[]> {
  const cleanCik = cik.replace(/^0+/, '')
  const cleanAcc = accessionNumber.replace(/-/g, '')

  // Step 1: Parse the HTM index page — EDGAR always provides this and it
  // lists every document in the filing with its actual filename.
  // Each filer uses different XML filenames (e.g. "50240.xml", "infotable.xml",
  // "13F_0000102909_20251231.xml", "XML_Infotable.xml") so this is the only
  // reliable way to discover the correct filename.
  const htmIndexUrl = `${SEC_ARCHIVES}/${cleanCik}/${cleanAcc}/${accessionNumber}-index.htm`
  const htmRes      = await fetch(htmIndexUrl, { headers: SEC_HEADERS })

  let xmlFileName: string | null = null

  if (htmRes.ok) {
    const html     = await htmRes.text()
    // Extract all .xml hrefs from the index page, excluding the cover page
    const xmlLinks = [...html.matchAll(/href="([^"]+\.xml)"/gi)]
      .map(m => m[1].split('/').pop() as string)
      .filter(f => f && !f.toLowerCase().includes('primary_doc'))

    // Prefer filenames that suggest holdings data over generic names
    xmlFileName = xmlLinks.find(f =>
      f.toLowerCase().includes('infotable') ||
      f.toLowerCase().includes('13f') ||
      f.toLowerCase().includes('information')
    ) ?? xmlLinks[0] ?? null
  }

  // Step 2: Known candidate filenames as fallback
  if (!xmlFileName) {
    const candidates = ['infotable.xml', 'form13fInfoTable.xml', 'holding.xml']
    for (const candidate of candidates) {
      const testRes = await fetch(
        `${SEC_ARCHIVES}/${cleanCik}/${cleanAcc}/${candidate}`,
        { method: 'HEAD', headers: SEC_HEADERS }
      )
      if (testRes.ok) { xmlFileName = candidate; break }
    }
  }

  if (!xmlFileName) {
    throw new Error(`Could not find infotable XML for ${accessionNumber} (CIK: ${cik})`)
  }

  // Step 3: Fetch and parse the XML
  const xmlUrl = `${SEC_ARCHIVES}/${cleanCik}/${cleanAcc}/${xmlFileName}`
  const xmlRes = await fetch(xmlUrl, { headers: SEC_HEADERS })
  if (!xmlRes.ok) throw new Error(`EDGAR XML fetch error: ${xmlRes.status} — ${xmlUrl}`)

  return parseInfoTable(await xmlRes.text())
}

function parseInfoTable(xml: string): Holding[] {
  // Pure regex XML parser — no external dependencies, works in all runtimes
  // (Node.js serverless, Edge, browser). DOMParser is NOT available in
  // Vercel Node.js serverless functions so we cannot use it here.
  //
  // Strategy:
  //   1. Strip XML namespace prefixes (e.g. ns1:infoTable → infoTable)
  //      since different 13F filers use different namespace declarations
  //   2. Extract each <infoTable>...</infoTable> block
  //   3. Pull individual fields from each block with tag-specific regex

  // Step 1: strip namespace prefixes
  // Must handle BOTH opening <ns1:tag → <tag AND closing </ns1:tag> → </tag>
  const stripped = xml
    .replace(/<([a-zA-Z][a-zA-Z0-9]*):([a-zA-Z][a-zA-Z0-9]*)/g,   '<$2')   // opening tags
    .replace(/<\/([a-zA-Z][a-zA-Z0-9]*):([a-zA-Z][a-zA-Z0-9]*)>/g, '</$2>') // closing tags

  // Step 2: extract infoTable blocks
  const blockRegex = /<infoTable>([\s\S]*?)<\/infoTable>/gi
  const blocks: string[] = []
  let match: RegExpExecArray | null
  while ((match = blockRegex.exec(stripped)) !== null) {
    blocks.push(match[1])
  }

  if (blocks.length === 0) {
    // Some filers use a different root tag — try extracting all cusip values
    // as a fallback signal that parsing failed vs. genuinely empty filing
    const hasCusip = /<cusip>/i.test(stripped)
    if (hasCusip) {
      throw new Error('infoTable blocks not found but CUSIP tags present — unexpected XML structure')
    }
    return [] // genuinely empty filing
  }

  // Step 3: extract a text value between <tag> and </tag> (case-insensitive)
  const tag = (block: string, name: string): string => {
    const re = new RegExp(`<${name}[^>]*>([^<]*)<\/${name}>`, 'i')
    return block.match(re)?.[1]?.trim() ?? ''
  }

  const num = (block: string, name: string): number =>
    Number(tag(block, name)) || 0

  return blocks.map(block => ({
    nameOfIssuer:         tag(block, 'nameOfIssuer'),
    cusip:                tag(block, 'cusip'),
    value:                num(block, 'value'),
    shsOrPrnAmt:          num(block, 'sshPrnamt'),
    investmentDiscretion: tag(block, 'investmentDiscretion'),
    putCall:              tag(block, 'putCall') || null,
  })).filter(e => e.cusip)
}
