// src/app/dashboard/layout.tsx — Terminal / Modern Dark
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase'
import DashboardShell from '@/components/dashboard/DashboardShell'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profileData } = await supabase
    .from('profiles')
    .select('email, full_name, plan')
    .eq('id', user.id)
    .single()

  const profile = profileData as { email: string | null; full_name: string | null; plan: string | null } | null

  return (
    <DashboardShell
      user={{
        email:    profile?.email    ?? user.email ?? '',
        fullName: profile?.full_name ?? '',
        plan:     profile?.plan     ?? 'free',
      }}
    >
      {children}
    </DashboardShell>
  )
}
