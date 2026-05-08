/**
 * POST /api/tickers/[ticker]/thesis
 * Generates a brief AI investment thesis for a ticker on demand.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker: rawTicker } = await params
  const ticker = rawTicker.toUpperCase()

  try {
    const supabase = createServiceClient()

    // Gather context for Claude
    const [signalResult, themeResult, eventsResult] = await Promise.all([
      (supabase
        .from('asset_signals')
        .select('signal, score, rationale')
        .eq('ticker', ticker)
        .single() as unknown as Promise<{ data: { signal: string; score: number; rationale: string } | null }>),
      (supabase
        .from('theme_tickers')
        .select('final_weight, themes!inner(name, timeframe, conviction)')
        .eq('ticker', ticker)
        .eq('themes.is_active', true) as unknown as Promise<{ data: { final_weight: number; themes: { name: string; timeframe: string; conviction: number } }[] | null }>),
      (supabase
        .from('events')
        .select('headline, ai_summary, sentiment_score, impact_score')
        .contains('tickers', [ticker])
        .order('published_at', { ascending: false })
        .limit(5) as unknown as Promise<{ data: { headline: string; ai_summary: string | null; sentiment_score: number | null; impact_score: number | null }[] | null }>),
    ])

    const signal = signalResult.data
    const themes = (themeResult.data ?? []).map(r => r.themes)
    const events = eventsResult.data ?? []

    const contextLines = [
      signal ? `Current signal: ${signal.signal?.toUpperCase()} (score ${signal.score}/100)` : '',
      signal?.rationale ? `Signal rationale: ${signal.rationale}` : '',
      themes.length ? `Active themes: ${themes.map(t => `${t.name} (${t.timeframe}, ${t.conviction} conviction)`).join('; ')}` : '',
      events.length ? `Recent events:\n${events.map(e => `- ${e.ai_summary ?? e.headline}`).join('\n')}` : '',
    ].filter(Boolean).join('\n')

    const prompt = `You are a concise investment analyst. Write a 3-4 sentence investment thesis for ${ticker}.

Context:
${contextLines || 'No recent data available.'}

Rules:
- Be specific about catalysts and risks
- Reference the macro context if themes are present
- No bullet points — flowing prose only
- Maximum 80 words`

    const response = await anthropic.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 200,
      messages:   [{ role: 'user', content: prompt }],
    })

    const thesis = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as any).text)
      .join('')
      .trim()

    return NextResponse.json({ ticker, thesis })
  } catch (e) {
    console.error(`[thesis/${ticker}]`, e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
