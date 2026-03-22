// src/app/api/themes/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const timeframe = searchParams.get('timeframe') as '1m' | '3m' | '6m' | null

  let query = supabase
    .from('themes')
    .select('*')
    .eq('is_active', true)
    .order('conviction', { ascending: false })

  if (timeframe) query = query.eq('timeframe', timeframe)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ themes: data })
}
