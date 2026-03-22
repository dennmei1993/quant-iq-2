// src/app/dashboard/page.tsx
import { createClient } from '@/lib/supabase/server'
import { KpiCard } from '@/components/dashboard/KpiCard'
import { EventFeedPreview, MacroGauges, SectorHeatmap } from '@/components/dashboard/widgets'
import styles from './dashboard.module.css'

export const revalidate = 60 // revalidate every 60 seconds

export default async function DashboardPage() {
  const supabase = createClient()

  // Fetch recent events
  const { data: events } = await supabase
    .from('events')
    .select('id, headline, ai_summary, published_at, event_type, sectors, sentiment_score, impact_level')
    .eq('ai_processed', true)
    .order('published_at', { ascending: false })
    .limit(5)

  // Fetch active themes count
  const { count: themeCount } = await supabase
    .from('themes')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)

  // Aggregate sentiment from last 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data: sentimentData } = await supabase
    .from('events')
    .select('sentiment_score')
    .eq('ai_processed', true)
    .gte('published_at', sevenDaysAgo)
    .not('sentiment_score', 'is', null)

  const avgSentiment = sentimentData?.length
    ? sentimentData.reduce((sum, e) => sum + (e.sentiment_score ?? 0), 0) / sentimentData.length
    : 0

  // Sector signal aggregation
  const { data: sectorEvents } = await supabase
    .from('events')
    .select('sectors, sentiment_score')
    .eq('ai_processed', true)
    .gte('published_at', sevenDaysAgo)
    .not('sentiment_score', 'is', null)

  // Build sector scores map
  const sectorScores: Record<string, number[]> = {}
  sectorEvents?.forEach(e => {
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
      {/* Alert strip for high-impact events */}
      {events?.some(e => e.impact_level === 'high') && (
        <div className={styles.alertStrip}>
          <span>⚠️</span>
          <span>
            <strong>High-impact signal:</strong>{' '}
            {events.find(e => e.impact_level === 'high')?.headline}
          </span>
        </div>
      )}

      {/* KPI row */}
      <div className={styles.kpiRow}>
        <KpiCard
          title="Market Sentiment"
          value={avgSentiment.toFixed(2)}
          sub="7-day aggregate (−1 to +1)"
          delta={avgSentiment >= 0 ? `↑ Risk-on bias` : `↓ Risk-off bias`}
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
          value={String(events?.filter(e => {
            const d = new Date(e.published_at)
            return d.toDateString() === new Date().toDateString()
          }).length ?? 0)}
          sub="Processed & scored"
          delta="See full feed →"
          deltaType="neutral"
          href="/dashboard/events"
        />
      </div>

      {/* Two-column: event feed + macro gauges */}
      <div className={styles.twoCol}>
        <EventFeedPreview events={events ?? []} />
        <MacroGauges />
      </div>

      {/* Sector heatmap */}
      <SectorHeatmap sectors={sectorAverages} />
    </div>
  )
}
