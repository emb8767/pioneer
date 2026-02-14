// /api/chat/session/route.ts — Verificar sesión existente
//
// GET /api/chat/session?id=uuid
// Devuelve datos de la sesión si existe en DB.
// Una sesión es válida desde que se crea (incluso durante entrevista).
// business_info y plan son datos opcionales que se llenan después.
//
// FIX (Fase 6.5): Antes requería business_info para devolver exists:true,
// lo que causaba que refresh durante entrevista creara sesión nueva.

import { NextRequest, NextResponse } from 'next/server';
import { getSession, getActivePlan, getPlanProgress } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get('id');

    if (!sessionId) {
      return NextResponse.json({ exists: false });
    }

    const session = await getSession(sessionId);

    if (!session) {
      return NextResponse.json({ exists: false });
    }

    // Session exists in DB — always valid
    const hasBusinessInfo = session.business_info && Object.keys(session.business_info).length > 0;

    // Look for active plan only if we have business info
    let planSummary = null;
    if (hasBusinessInfo) {
      try {
        const plan = await getActivePlan(sessionId);
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
    }

    return NextResponse.json({
      exists: true,
      sessionId: session.id,
      businessName: session.business_name,
      status: session.status,
      hasBusinessInfo,
      plan: planSummary,
    });

  } catch (error) {
    console.error('[Pioneer Session] Error:', error);
    return NextResponse.json({ exists: false });
  }
}
