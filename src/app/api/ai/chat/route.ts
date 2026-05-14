// src/app/api/ai/chat/route.ts
// Proxies chat requests to Anthropic API using the user's stored API key
// Keeps the API key server-side, avoids CSP issues with direct browser calls

import { NextRequest, NextResponse } from 'next/server'
import { requireUser, createServiceClient } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireUser()

    // Get user's API key from profile
    const supabase = createServiceClient()
    const { data: profile } = await supabase
      .from('profiles')
      .select('anthropic_api_key')
      .eq('id', user.id)
      .single() as { data: { anthropic_api_key: string | null } | null }

    const apiKey = (profile as any)?.anthropic_api_key
    if (!apiKey) {
      return NextResponse.json({ error: 'No API key configured. Add your Anthropic API key in Settings.' }, { status: 400 })
    }

    const body = await req.json()

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      body.model      ?? 'claude-sonnet-4-20250514',
        max_tokens: body.max_tokens ?? 1024,
        system:     body.system,
        messages:   body.messages,
      }),
    })

    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
