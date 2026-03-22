// src/app/(marketing)/page.tsx
// Landing page — the full HTML is in /public/landing.html
// This route simply renders it via Next.js so it lives at /
// All the design and interactivity is self-contained in the HTML file.

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import LandingPage from '@/components/landing/LandingPage'

export default async function Home() {
  // Redirect authenticated users straight to the dashboard
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect('/dashboard')

  return <LandingPage />
}
