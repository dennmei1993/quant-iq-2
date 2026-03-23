// src/app/(marketing)/page.tsx
import { createServiceClient } from '@/lib/supabase/server'
import LandingPage from '@/components/landing/LandingPage'

export default async function Home() {
  const supabase = createServiceClient()

  const [{ data: events }, { data: themes }, { data: signals }] = await Promise.all([
    supabase
      .from('events')
      .select('headline, sentiment_score, impact_level, event_type, sectors, published_at')
      .eq('ai_processed', true)
      .order('published_at', { ascending: false })
      .limit(6),
    supabase
      .from('themes')
      .select('name, timeframe, conviction, momentum, candidate_tickers')
      .eq('is_active', true)
      .order('timeframe'),
    supabase
      .from('asset_signals')
      .select('ticker, signal, score, price_usd, change_pct')
      .order('score', { ascending: false })
      .limit(10),
  ])

  return <LandingPage liveEvents={events ?? []} liveThemes={themes ?? []} liveSignals={signals ?? []} />
}