// app/auth/callback/route.ts — Auth callback handler
//
// When user clicks the magic link in their email, Supabase redirects here.
// This route exchanges the auth code for a session cookie and redirects to /chat.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/chat'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // If no code or error, redirect to login with error
  return NextResponse.redirect(`${origin}/login?error=auth_failed`)
}
