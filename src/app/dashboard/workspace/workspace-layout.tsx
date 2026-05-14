// src/app/dashboard/workspace/layout.tsx
// Forces the workspace to fill the shell content area exactly

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: 'relative', flex: 1, overflow: 'hidden', height: '100%' }}>
      {children}
    </div>
  )
}
