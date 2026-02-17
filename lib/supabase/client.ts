// lib/supabase/client.ts — Browser client for Supabase Auth
//
// Used in Client Components (useEffect, onClick, etc.)
// This client uses the PUBLISHABLE key and respects RLS policies.
// For server-side admin operations, use lib/supabase.ts (secret key).

import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
}
