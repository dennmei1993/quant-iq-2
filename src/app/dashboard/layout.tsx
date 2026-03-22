// src/app/dashboard/layout.tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import DashboardShell from '@/components/dashboard/DashboardShell'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, email, plan')
    .eq('id', user.id)
    .single()

  return (
    <DashboardShell
      user={{ email: profile?.email ?? user.email ?? '', fullName: profile?.full_name ?? '', plan: profile?.plan ?? 'free' }}
    >
      {children}
    </DashboardShell>
  )
}
