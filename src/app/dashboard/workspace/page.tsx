'use client'
// src/app/dashboard/workspace/page.tsx

import { useEffect, useState } from 'react'
import WorkspaceClient from './WorkspaceClient'

export default function WorkspacePage() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  
  if (!mounted) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-4)', fontSize: 'var(--fs-sm)' }}>
      Loading workspace…
    </div>
  )
  
  return <WorkspaceClient />
}
