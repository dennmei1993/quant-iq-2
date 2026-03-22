// src/components/dashboard/KpiCard.tsx
import Link from 'next/link'
import styles from './ui.module.css'

interface Props {
  title: string
  value: string
  sub: string
  delta: string
  deltaType: 'up' | 'down' | 'neutral'
  href?: string
}

export function KpiCard({ title, value, sub, delta, deltaType, href }: Props) {
  const deltaClass = deltaType === 'up' ? styles.up : deltaType === 'down' ? styles.down : styles.neutral
  return (
    <div className={styles.panel}>
      <div className={styles.panelTitle}>{title}</div>
      <div className={styles.kpiVal}>{value}</div>
      <div className={styles.kpiSub}>{sub}</div>
      {href ? (
        <Link href={href} className={`${styles.kpiDelta} ${deltaClass}`}>{delta}</Link>
      ) : (
        <div className={`${styles.kpiDelta} ${deltaClass}`}>{delta}</div>
      )}
    </div>
  )
}
