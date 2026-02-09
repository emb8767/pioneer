// route.ts — Orquestador del chat API (estilo PLC/Ladder)
//
// ANTES: 216 líneas con parsing, loop, tracking, response builder, todo mezclado.
// AHORA: Secuencia lineal de 3 pasos claros:
//   1. parseRequest   → validar input, leer cookies, init estado
//   2. conversationLoop → loop de tool_use con draft-guardian como interlock
//   3. buildResponse   → inyección imagen, cookie clear, JSON
//
// Cada módulo es un "rung" independiente con entrada/salida clara.
// draft-guardian.ts es el "interlock" que valida EN CÓDIGO las 3 zonas grises.

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

    const { messages, pendingOAuthData, guardianState } = parsed.data;

    // ═══════════════════════════════════════
    // RUNG 2: Loop de conversación + guardian
    // ═══════════════════════════════════════
    const result = await runConversationLoop(
      messages,
      pendingOAuthData,
      guardianState
    );

    // ═══════════════════════════════════════
    // RUNG 3: Construir respuesta HTTP
    // ═══════════════════════════════════════
    return buildResponse(result);

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
