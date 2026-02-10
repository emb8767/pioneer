// /api/chat/action/route.ts — Endpoint para botones de ACCIÓN
//
// Los botones de acción NO pasan por Claude API.
// Ejecutan código directamente contra Late.dev / Replicate.
//
// POST /api/chat/action
// Body: { action: string, params: { content, imageUrls, platforms, scheduledFor, ... } }
// Response: { success, message, buttons?, error? }

import { NextRequest, NextResponse } from 'next/server';
import { handleAction } from '../action-handler';
import type { ActionRequest } from '../action-handler';

export async function POST(request: NextRequest) {
  try {
    const body: ActionRequest = await request.json();

    if (!body.action) {
      return NextResponse.json(
        { success: false, message: 'Se requiere "action" en el body.', error: 'missing_action' },
        { status: 400 }
      );
    }

    if (!body.params) {
      return NextResponse.json(
        { success: false, message: 'Se requiere "params" en el body.', error: 'missing_params' },
        { status: 400 }
      );
    }

    const result = await handleAction(body);

    return NextResponse.json(result, {
      status: result.success ? 200 : 422,
    });

  } catch (error) {
    console.error('[Pioneer Action] Error no manejado:', error);
    return NextResponse.json(
      {
        success: false,
        message: 'Error interno del servidor.',
        error: error instanceof Error ? error.message : 'unknown',
      },
      { status: 500 }
    );
  }
}
