// src/app/dashboard/events/page.tsx
import { createClient } from '@/lib/supabase/server'
import { EventFeedPreview } from '@/components/dashboard/widgets'
import styles from '../dashboard.module.css'

export const revalidate = 30

export default async function EventsPage() {
  const supabase = await createClient()

  const { data: events } = await supabase
    .from('events')
    .select('id, headline, ai_summary, published_at, event_type, sectors, sentiment_score, impact_level')
    .eq('ai_processed', true)
    .order('published_at', { ascending: false })
    .limit(30)

  return (
    <div>
      <EventFeedPreview events={events ?? []} />
    </div>
  )
}
