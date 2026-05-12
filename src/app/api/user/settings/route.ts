// src/app/api/user/settings/route.ts
// GET  /api/user/settings  — fetch user profile + moomoo account
// PATCH /api/user/settings — update profile fields including moomoo credentials

import { NextRequest, NextResponse } from 'next/server'
import { requireUser, errorResponse } from '@/lib/supabase'

const ALLOWED = new Set([
  'display_name',
  'full_name',
  'risk_appetite',
  'investment_horizon',
  'preferred_assets',
  'benchmark',
  'target_holdings',
  'cash_pct',
  'moomoo_account',
  'moomoo_password',
])

export async function GET() {
  try {
    const { supabase, user } = await requireUser()

    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, display_name, plan, tier, risk_appetite, investment_horizon, preferred_assets, benchmark, target_holdings, cash_pct, moomoo_account, created_at')
      .eq('id', user.id)
      .single()

    if (error) throw error

    // Also fetch which portfolio is linked to Moomoo
    const { data: linkedPortfolio } = await supabase
      .from('portfolios')
      .select('id, name')
      .eq('user_id', user.id)
      .eq('moomoo_linked', true)
      .single()

    return NextResponse.json({
      profile:          data,
      moomoo_linked_portfolio: linkedPortfolio ?? null,
    })
  } catch (e) {
    const { body, status } = errorResponse(e)
    return NextResponse.json(body, { status })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const body = await req.json()

    // Extract moomoo_linked_portfolio_id separately
    const { moomoo_linked_portfolio_id, ...prefs } = body

    // Update profile
    const update = Object.fromEntries(
      Object.entries(prefs).filter(([k]) => ALLOWED.has(k))
    )

    if (Object.keys(update).length > 0) {
      update.updated_at = new Date().toISOString()
      const { error } = await supabase
        .from('profiles')
        .update(update)
        .eq('id', user.id)
      if (error) throw error
    }

    // Update moomoo_linked portfolio — unlink all first then link the selected one
    if (moomoo_linked_portfolio_id !== undefined) {
      // Unlink all portfolios for this user
      await supabase
        .from('portfolios')
        .update({ moomoo_linked: false })
        .eq('user_id', user.id)

      // Link the selected portfolio (if not null)
      if (moomoo_linked_portfolio_id) {
        const { error } = await supabase
          .from('portfolios')
          .update({ moomoo_linked: true })
          .eq('id', moomoo_linked_portfolio_id)
          .eq('user_id', user.id)
        if (error) throw error
      }
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    const { body, status } = errorResponse(e)
    return NextResponse.json(body, { status })
  }
}
