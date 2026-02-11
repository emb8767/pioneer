// supabase.ts — Cliente Supabase para Pioneer (server-side only)
//
// Usa el secret key (reemplaza service_role) para acceso completo a DB.
// NUNCA exponer en frontend — solo se usa en API routes y action handlers.
//
// Docs: https://supabase.com/docs/guides/api/api-keys

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
}

if (!supabaseSecretKey) {
  throw new Error('SUPABASE_SECRET_KEY is not set');
}

// Server-side admin client — bypasses RLS, full DB access
export const supabase = createClient(supabaseUrl, supabaseSecretKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
