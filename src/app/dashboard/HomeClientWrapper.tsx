'use client'
// src/app/dashboard/HomeClientWrapper.tsx
// Client-only wrapper — prevents HomeClient from SSR to eliminate #418

import dynamic from 'next/dynamic'
import type { HomeClientProps } from './HomeClient'

const HomeClient = dynamic(() => import('./HomeClient'), { ssr: false })

export default function HomeClientWrapper(props: HomeClientProps) {
  return <HomeClient {...props} />
}
