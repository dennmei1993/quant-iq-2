// src/lib/supabase.ts
// Re-exports from the original supabase clients for compatibility
// with new API routes added in Phase 1.

export { createClient as createServerSupabaseClient } from '@/lib/supabase/server'
export { createServiceClient } from '@/lib/supabase/server'

// requireUser — used by new API routes
import { createClient } from '@/lib/supabase/server'

export async function requireUser() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) throw new Error('Unauthorized')
  return { supabase, user }
}

// errorResponse — consistent API error shape
export function errorResponse(err: unknown) {
  const msg = err instanceof Error ? err.message : 'Internal error'
  if (msg === 'Unauthorized')
    return { body: { error: 'Unauthorized' }, status: 401 }
  if (msg.startsWith('upgrade_required')) {
    const plan = msg.split(':')[1]
    return { body: { error: `${plan} plan required`, upgrade_url: '/pricing' }, status: 403 }
  }
  return { body: { error: msg }, status: 500 }
}