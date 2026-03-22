// src/lib/ai.ts
// Wrapper around Anthropic SDK for all LLM calls
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── Event classification ──────────────────────────────────────
export async function classifyEvent(headline: string, summary?: string) {
  const prompt = `You are a financial intelligence analyst. Classify this market event and return ONLY valid JSON.

Event: "${headline}"
${summary ? `Detail: "${summary}"` : ''}

Return this exact JSON structure:
{
  "event_type": "monetary_policy|geopolitical|corporate|economic_data|regulatory",
  "sectors": ["technology","energy","financials","healthcare","defence","utilities","industrials","consumer","real_estate","materials"],
  "sentiment_score": <number from -1.0 to +1.0>,
  "impact_level": "low|medium|high",
  "tickers": ["TICKER1","TICKER2"],
  "ai_summary": "<one sentence investment-relevant summary>"
}

Rules:
- sectors: include only directly affected sectors (max 3)
- tickers: only well-known US-listed tickers directly mentioned or obviously affected (max 5, empty array if none)
- sentiment_score: -1.0 = very bearish for US markets, +1.0 = very bullish
- impact_level: high = likely to move individual assets >2%, medium = sector-level, low = background noise`

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.content[0].type === 'text' ? message.content[0].text : ''
  return JSON.parse(text.replace(/```json|```/g, '').trim())
}

// ── Theme generation ──────────────────────────────────────────
export async function generateTheme(
  events: Array<{ headline: string; sectors: string[]; sentiment_score: number }>,
  timeframe: '1m' | '3m' | '6m'
) {
  const eventList = events.map((e, i) => `${i + 1}. ${e.headline} (sentiment: ${e.sentiment_score})`).join('\n')

  const prompt = `You are a senior portfolio strategist. Based on these recent market events, identify the most coherent investment theme for a ${timeframe} horizon and return ONLY valid JSON.

Events:
${eventList}

Return this exact JSON:
{
  "name": "<concise theme name, max 5 words>",
  "label": "<single category: Technology|Defence|Energy|Macro|Crypto|Healthcare|Financials|Commodities>",
  "conviction": <integer 0-100>,
  "momentum": "strong_up|moderate_up|neutral|moderate_down|strong_down",
  "brief": "<3-4 sentence investment thesis explaining why this theme is compelling for ${timeframe} and what macro/geopolitical forces support it>",
  "candidate_tickers": ["TICKER1","TICKER2","TICKER3","TICKER4","TICKER5"]
}

Focus on US-listed assets only. candidate_tickers should include a mix of stocks, ETFs where appropriate.`

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.content[0].type === 'text' ? message.content[0].text : ''
  return JSON.parse(text.replace(/```json|```/g, '').trim())
}

// ── Portfolio advisory memo ───────────────────────────────────
export async function generateAdvisoryMemo(
  holdings: Array<{ ticker: string; name: string }>,
  recentEvents: Array<{ headline: string; sentiment_score: number; impact_level: string }>,
  macroEnvironment: string
) {
  const holdingsList = holdings.map(h => `- ${h.ticker} (${h.name})`).join('\n')
  const eventsList = recentEvents.slice(0, 5).map(e =>
    `- ${e.headline} [sentiment: ${e.sentiment_score}, impact: ${e.impact_level}]`
  ).join('\n')

  const prompt = `You are a quantitative investment advisor. Write a concise portfolio advisory memo based on the user's holdings and today's market intelligence.

Holdings:
${holdingsList}

Key recent events:
${eventsList}

Macro environment: ${macroEnvironment}

Write a 3-4 sentence advisory memo that:
1. Identifies which holdings are positively/negatively exposed to current events
2. Gives one specific actionable recommendation
3. Notes the key risk to watch

Tone: professional but clear, like a morning note from a quant fund PM. No bullet points, flowing prose only.`

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  })

  return message.content[0].type === 'text' ? message.content[0].text : ''
}
