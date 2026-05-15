// src/app/dashboard/workspace/layout.tsx

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: 'relative', flex: 1, overflow: 'hidden', height: '100%' }}>
      {children}
    </div>
  )
}
