// lib/supabase/proxy.ts — Middleware helper for Supabase Auth
//
// Refreshes expired auth tokens automatically on every request.
// Called from middleware.ts (Next.js middleware).

import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: Use getUser() which validates the JWT signature.
  // Never trust getSession() in server code — it doesn't revalidate.
  const { data: { user } } = await supabase.auth.getUser()

  // If not logged in and trying to access protected routes → redirect to login
  if (
    !user &&
    !request.nextUrl.pathname.startsWith('/login') &&
    !request.nextUrl.pathname.startsWith('/auth') &&
    !request.nextUrl.pathname.startsWith('/api/cron') &&
    !request.nextUrl.pathname.startsWith('/_next') &&
    request.nextUrl.pathname !== '/favicon.ico'
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // If logged in and on login page → redirect to chat
  if (user && request.nextUrl.pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/chat'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
