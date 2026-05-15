'use client'
// src/app/dashboard/workspace/page.tsx
// Wraps WorkspaceClient with dynamic import to avoid SSR initialization errors

import dynamic from 'next/dynamic'

const WorkspaceClient = dynamic(
  () => import('./WorkspaceClient'),
  { ssr: false, loading: () => <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-4)', fontSize: 'var(--fs-sm)' }}>Loading workspace…</div> }
)

export default function WorkspacePage() {
  return <WorkspaceClient />
}
