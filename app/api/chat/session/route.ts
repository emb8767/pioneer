// /api/chat/session/route.ts — Verificar sesión existente
//
// GET /api/chat/session?id=uuid  → busca por sessionId (legacy)
// GET /api/chat/session           → busca por user_id (auth)
//
// Si el usuario está autenticado, busca su sesión por user_id.
// Si no tiene sesión con business_info → devuelve needsOnboarding: true

import { NextRequest, NextResponse } from 'next/server';
import { getSession, getActivePlan, getPlanProgress } from '@/lib/db';
import { createClient } from '@/lib/supabase/server';
import { supabase as adminSupabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get('id');
    let session = null;

    if (sessionId) {
      // Legacy: buscar por sessionId directo
      session = await getSession(sessionId);
    } else {
      // Auth: buscar por user_id
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (user) {
        const { data } = await adminSupabase
          .from('sessions')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        session = data;
      }
    }

    if (!session) {
      return NextResponse.json({ exists: false, needsOnboarding: true });
    }

    // Session exists in DB — check if it has business info
    const hasBusinessInfo = session.business_info && Object.keys(session.business_info).length > 0;

    if (!hasBusinessInfo) {
      return NextResponse.json({ exists: true, sessionId: session.id, needsOnboarding: true });
    }

    // Look for active plan
    let planSummary = null;
    try {
      const plan = await getActivePlan(session.id);
      if (plan) {
        const progress = await getPlanProgress(plan.id);
        if (progress) {
          planSummary = {
            id: plan.id,
            name: plan.plan_name,
            postCount: plan.post_count,
            postsPublished: progress.postsPublished,
            status: plan.status,
          };
        }
      }
    } catch {
      // No bloquear si falla la búsqueda del plan
    }

    return NextResponse.json({
      exists: true,
      sessionId: session.id,
      businessName: session.business_name,
      status: session.status,
      hasBusinessInfo,
      needsOnboarding: false,
      plan: planSummary,
    });

  } catch (error) {
    console.error('[Pioneer Session] Error:', error);
    return NextResponse.json({ exists: false, needsOnboarding: true });
  }
}
