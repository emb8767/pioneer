// route.ts — Fase DB-1: Orquestador del chat API con sessionId
//
// Secuencia lineal de 3 pasos:
//   1. parseRequest   → validar input, leer cookies, crear/validar session
//   2. conversationLoop → loop de tool_use con draft-guardian como interlock
//   3. buildResponse   → botones, actionContext con DB IDs, sessionId en JSON
//
// sessionId fluye: request-parser → guardianState → buildResponse → JSON

import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { parseRequest } from './request-parser';
import { runConversationLoop } from './conversation-loop';
import { buildResponse } from './response-builder';

export async function POST(request: NextRequest) {
  try {
    // ═══════════════════════════════════════
    // RUNG 1: Parse del request
    // ═══════════════════════════════════════
    const parsed = await parseRequest(request);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.error },
        { status: parsed.error.status }
      );
    }

    const { messages, pendingOAuthData, guardianState, sessionContext } = parsed.data;

    // ═══════════════════════════════════════
    // RUNG 2: Loop de conversación + guardian
    // ═══════════════════════════════════════
    const result = await runConversationLoop(
      messages,
      pendingOAuthData,
      guardianState,
      sessionContext || undefined
    );

    // ═══════════════════════════════════════
    // RUNG 3: Construir respuesta HTTP
    // (sessionId incluido via guardianState)
    // ═══════════════════════════════════════
    return await buildResponse(result);

  } catch (error) {
    console.error('[Pioneer] Error en POST /api/chat:', error);

    if (error instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: `Error de Claude API: ${error.message}`, status: error.status },
        { status: 502 }
      );
    }

    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}
