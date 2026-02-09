// response-builder.ts — Construye la respuesta HTTP final
//
// RESPONSABILIDADES:
// 1. Inyectar URLs de imagen si Claude no las incluyó en el texto (UX)
// 2. Limpiar cookie OAuth si fue consumida
// 3. Devolver NextResponse con JSON + headers
//
// ESTILO PLC/LADDER: entrada = ConversationResult, salida = NextResponse

import { NextResponse } from 'next/server';
import { COOKIE_NAME } from '@/lib/oauth-cookie';
import type { GuardianState } from './draft-guardian';
import type { ConversationResult } from './conversation-loop';

export function buildResponse(result: ConversationResult): NextResponse {
  let fullText = result.finalText;
  const state = result.guardianState;

  // === INYECCIÓN DE URL DE IMAGEN (para UX del chat) ===
  // Si generate_image fue llamada y la URL NO aparece en el texto,
  // inyectarla para que el chat UI la renderice como imagen visible.
  if (state.generateImageWasCalled && state.lastGeneratedImageUrls.length > 0) {
    const hasImageUrl = state.lastGeneratedImageUrls.some(url => fullText.includes(url));
    if (!hasImageUrl) {
      console.log(`[Pioneer] Inyectando ${state.lastGeneratedImageUrls.length} URL(s) de imagen en respuesta`);
      const urlBlock = state.lastGeneratedImageUrls.join('\n\n');
      fullText = fullText + '\n\n' + urlBlock;
    }
  }

  // === CONSTRUIR RESPUESTA JSON ===
  const jsonResponse = NextResponse.json({
    message: fullText,
    ...(result.lastUsage && { usage: result.lastUsage }),
  });

  // === LIMPIAR COOKIE OAUTH SI FUE CONSUMIDA ===
  if (state.shouldClearOAuthCookie) {
    jsonResponse.cookies.set(COOKIE_NAME, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
  }

  return jsonResponse;
}
