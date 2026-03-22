// src/app/dashboard/page.tsx
import { createClient } from '@/lib/supabase/server'
import { KpiCard } from '@/components/dashboard/KpiCard'
import { EventFeedPreview, MacroGauges, SectorHeatmap } from '@/components/dashboard/widgets'
import styles from './dashboard.module.css'

export const revalidate = 60

type EventRow = {
  id: string
  headline: string
  ai_summary: string | null
  published_at: string
  event_type: string | null
  sectors: string[] | null
  sentiment_score: number | null
  impact_level: string | null
}

type SentimentRow = { sentiment_score: number | null }
type SectorRow = { sectors: string[] | null; sentiment_score: number | null }

export default async function DashboardPage() {
  const supabase = await createClient()

  const { data: eventsRaw } = await supabase
    .from('events')
    .select('id, headline, ai_summary, published_at, event_type, sectors, sentiment_score, impact_level')
    .eq('ai_processed', true)
    .order('published_at', { ascending: false })
    .limit(5)

  const events = (eventsRaw ?? []) as EventRow[]

  const { count: themeCount } = await supabase
    .from('themes')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data: sentimentRaw } = await supabase
    .from('events')
    .select('sentiment_score')
    .eq('ai_processed', true)
    .gte('published_at', sevenDaysAgo)
    .not('sentiment_score', 'is', null)

  const sentimentData = (sentimentRaw ?? []) as SentimentRow[]

  const avgSentiment = sentimentData.length
    ? sentimentData.reduce((sum, e) => sum + (e.sentiment_score ?? 0), 0) / sentimentData.length
    : 0

  const { data: sectorRaw } = await supabase
    .from('events')
    .select('sectors, sentiment_score')
    .eq('ai_processed', true)
    .gte('published_at', sevenDaysAgo)
    .not('sentiment_score', 'is', null)

  const sectorEvents = (sectorRaw ?? []) as SectorRow[]

  const sectorScores: Record<string, number[]> = {}
  sectorEvents.forEach(e => {
    e.sectors?.forEach((s: string) => {
      if (!sectorScores[s]) sectorScores[s] = []
      sectorScores[s].push(e.sentiment_score ?? 0)
    })
  })

  const sectorAverages = Object.entries(sectorScores)
    .map(([sector, scores]) => ({
      sector,
      score: scores.reduce((a, b) => a + b, 0) / scores.length,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)

  return (
    <div>
      {events.some(e => e.impact_level === 'high') && (
        <div className={styles.alertStrip}>
          <span>⚠️</span>
          <span>
            <strong>High-impact signal:</strong>{' '}
            {events.find(e => e.impact_level === 'high')?.headline}
          </span>
        </div>
      )}

      <div className={styles.kpiRow}>
        <KpiCard
          title="Market Sentiment"
          value={avgSentiment.toFixed(2)}
          sub="7-day aggregate (−1 to +1)"
          delta={avgSentiment >= 0 ? '↑ Risk-on bias' : '↓ Risk-off bias'}
          deltaType={avgSentiment >= 0 ? 'up' : 'down'}
        />
        <KpiCard
          title="Active Themes"
          value={String(themeCount ?? 0)}
          sub="Across 1 / 3 / 6m horizons"
          delta="View all themes →"
          deltaType="neutral"
          href="/dashboard/themes"
        />
        <KpiCard
          title="Events Today"
          value={String(
            events.filter(e => new Date(e.published_at).toDateString() === new Date().toDateString()).length
          )}
          sub="Processed & scored"
          delta="See full feed →"
          deltaType="neutral"
          href="/dashboard/events"
        />
      </div>

      <div className={styles.twoCol}>
        <EventFeedPreview events={events} />
        <MacroGauges />
      </div>

      <SectorHeatmap sectors={sectorAverages} />
    </div>
  )
}
