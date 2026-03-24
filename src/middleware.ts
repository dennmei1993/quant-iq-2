import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { canAccess, type Feature, type UserTier } from '@/lib/access-control'

/**
 * Route → feature mapping.
 * Add new protected routes here — no other changes needed.
 */
const PROTECTED_ROUTES: Array<{ pattern: RegExp; feature: Feature }> = [
  { pattern: /^\/portfolio/,        feature: 'portfolio' },
  { pattern: /^\/live/,             feature: 'live_feed' },
  { pattern: /^\/events\/[^/]+$/,   feature: 'event_details' },
  { pattern: /^\/themes\/[^/]+$/,   feature: 'theme_details' },
  { pattern: /^\/tickers\/[^/]+$/, feature: 'ticker_details' },
  { pattern: /^\/memos/,            feature: 'ai_memos' },
  { pattern: /^\/admin/,            feature: 'admin_panel' },
]

const REDIRECT_URL = '/upgrade'   // Where to send users without access
const LOGIN_URL    = '/login'     // Where to send unauthenticated users

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Build Supabase SSR client
  let response = NextResponse.next({ request })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet: { name: string; value: string; options: Record<string, unknown> }[]) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value)
            response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2])
          })
        }
      }
    }
  )

  // Refresh session
  const { data: { user } } = await supabase.auth.getUser()

  // Check each protected route
  for (const { pattern, feature } of PROTECTED_ROUTES) {
    if (!pattern.test(pathname)) continue

    // Not logged in → send to login
    if (!user) {
      const loginUrl = new URL(LOGIN_URL, request.url)
      loginUrl.searchParams.set('redirectTo', pathname)
      return NextResponse.redirect(loginUrl)
    }

    // Fetch tier
    const { data: profile } = await supabase
      .from('profiles')
      .select('tier')
      .eq('id', user.id)
      .single()

    const tier = (profile?.tier ?? 'free') as UserTier

    // Insufficient tier → send to upgrade
    if (!canAccess(tier, feature)) {
      const upgradeUrl = new URL(REDIRECT_URL, request.url)
      upgradeUrl.searchParams.set('feature', feature)
      return NextResponse.redirect(upgradeUrl)
    }

    break
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/|auth/).*)',
  ],
}
