// src/app/dashboard/themes/page.tsx
// Server component — delegates data fetching to shared @/lib/themes

import { fetchAllThemes } from '@/lib/themes'
import ThemesClient from './ThemesClient'

export const dynamic    = 'force-dynamic'
export const revalidate = 0

// Re-export types so ThemesClient can import from './page' as before
export type { TickerWeight, ThemeWithTickers as Theme, Regime, SignalMap } from '@/lib/themes'

export default async function ThemesPage() {
  const { themes, regime, signalMap } = await fetchAllThemes()

  return (
    <ThemesClient
      themes={themes}
      regime={regime}
      signalMap={signalMap}
    />
  )
}
