// src/app/dashboard/themes/page.tsx
import { createClient } from '@/lib/supabase/server'
import styles from './themes.module.css'
import panelStyles from '@/components/dashboard/ui.module.css'

export const revalidate = 300

export default async function ThemesPage() {
  const supabase = createClient()

  const { data: themes } = await supabase
    .from('themes')
    .select('*')
    .eq('is_active', true)
    .order('conviction', { ascending: false })

  const byTimeframe = {
    '1m': themes?.filter(t => t.timeframe === '1m') ?? [],
    '3m': themes?.filter(t => t.timeframe === '3m') ?? [],
    '6m': themes?.filter(t => t.timeframe === '6m') ?? [],
  }

  const momentumLabel: Record<string, string> = {
    strong_up: '↑ Strong', moderate_up: '↑ Moderate', neutral: '→ Neutral',
    moderate_down: '↓ Moderate', strong_down: '↓ Strong',
  }
  const momentumColor: Record<string, string> = {
    strong_up: '#4eca99', moderate_up: '#4eca99', neutral: '#e09845',
    moderate_down: '#e87070', strong_down: '#e87070',
  }

  function ThemeSection({ tf, list }: { tf: string; list: typeof themes }) {
    const labels = { '1m': '1 Month', '3m': '3 Months', '6m': '6 Months' }
    return (
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>{labels[tf as keyof typeof labels]} Horizon</h2>
        {!list?.length && (
          <div className={panelStyles.empty}>No active themes yet — check back after the next ingest cycle.</div>
        )}
        <div className={styles.themeGrid}>
          {list?.map(t => (
            <div key={t.id} className={styles.themeCard}>
              <div className={styles.themeLabel} style={{ color: momentumColor[t.momentum ?? 'neutral'] }}>
                {t.label}
              </div>
              <div className={styles.themeName}>{t.name}</div>
              <div className={styles.themeConf}>
                <span>{t.conviction}% conviction</span>
                <div className={styles.confBar}>
                  <div className={styles.confFill} style={{ width: `${t.conviction}%`, background: momentumColor[t.momentum ?? 'neutral'] }} />
                </div>
              </div>
              <div className={styles.themeMomentum} style={{
                background: `${momentumColor[t.momentum ?? 'neutral']}22`,
                color: momentumColor[t.momentum ?? 'neutral'],
                border: `1px solid ${momentumColor[t.momentum ?? 'neutral']}44`,
              }}>
                {momentumLabel[t.momentum ?? 'neutral'] ?? '→'}
              </div>
              {t.brief && <p className={styles.themeBrief}>{t.brief}</p>}
              {t.candidate_tickers?.length ? (
                <div className={styles.tickers}>
                  {t.candidate_tickers.map((tick: string) => (
                    <span key={tick} className={styles.ticker}>{tick}</span>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div>
      <ThemeSection tf="1m" list={byTimeframe['1m']} />
      <ThemeSection tf="3m" list={byTimeframe['3m']} />
      <ThemeSection tf="6m" list={byTimeframe['6m']} />
    </div>
  )
}
