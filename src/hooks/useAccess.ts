import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { canAccess, type Feature, type UserTier } from '@/lib/access-control'

interface UseAccessReturn {
  tier: UserTier | null
  loading: boolean
  can: (feature: Feature) => boolean
  isPro: boolean
  isAdmin: boolean
  isFree: boolean
}

/**
 * useAccess — returns the current user's tier and a `can()` checker.
 *
 * Usage:
 *   const { can, isPro, loading } = useAccess()
 *   if (can('portfolio')) { ... }
 */
export function useAccess(): UseAccessReturn {
  const [tier, setTier] = useState<UserTier | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    let cancelled = false

    async function fetchTier() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }

      const { data } = await supabase
        .from('profiles')
        .select('tier')
        .eq('id', user.id)
        .single()

      if (!cancelled) {
        setTier((data?.tier as UserTier) ?? 'free')
        setLoading(false)
      }
    }

    fetchTier()

    // Keep in sync if tier changes (e.g. after upgrade)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      fetchTier()
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  return {
    tier,
    loading,
    can: (feature: Feature) => canAccess(tier, feature),
    isPro: tier === 'pro' || tier === 'admin',
    isAdmin: tier === 'admin',
    isFree: tier === 'free',
  }
}

/**
 * useRequireAccess — redirects if user lacks a required feature.
 * Use at the top of a page component.
 *
 * Usage:
 *   useRequireAccess('portfolio', '/upgrade')
 */
export function useRequireAccess(
  feature: Feature,
  redirectTo: string = '/upgrade'
) {
  const { tier, loading } = useAccess()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !canAccess(tier, feature)) {
      router.replace(redirectTo)
    }
  }, [tier, loading, feature, redirectTo, router])

  return { loading }
}
