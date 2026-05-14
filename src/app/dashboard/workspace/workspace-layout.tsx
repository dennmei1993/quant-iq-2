// src/app/dashboard/workspace/layout.tsx
// Workspace needs full height without extra padding — override shell content padding

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {children}
    </div>
  )
}
