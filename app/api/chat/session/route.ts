// /api/chat/session/route.ts — Verificar sesión existente
//
// GET /api/chat/session?id=uuid
// Devuelve datos de la sesión si existe y tiene business_info
// El frontend usa esto para decidir si mostrar bienvenida de regreso

import { NextRequest, NextResponse } from 'next/server';
import { getSession, getActivePlan, getPlanProgress } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const sessionId = request.nextUrl.searchParams.get('id');

    if (!sessionId) {
      return NextResponse.json({ exists: false });
    }

    const session = await getSession(sessionId);

    if (!session || !session.business_info || Object.keys(session.business_info).length === 0) {
      return NextResponse.json({ exists: false });
    }

    // Sesión existe y tiene datos — buscar plan activo
    let planSummary = null;
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

    return NextResponse.json({
      exists: true,
      sessionId: session.id,
      businessName: session.business_name,
      status: session.status,
      plan: planSummary,
    });

  } catch (error) {
    console.error('[Pioneer Session] Error:', error);
    return NextResponse.json({ exists: false });
  }
}
