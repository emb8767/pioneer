// response-builder.ts — Construye la respuesta HTTP final
//
// RESPONSABILIDADES:
// 1. Inyectar URLs de imagen si Claude no las incluyó en el texto (UX)
// 2. Detectar botones en texto de Claude + estado del guardian (Fase 1A + 1B)
// 3. Incluir actionContext cuando hay botones de acción (Fase 1B)
// 4. Limpiar cookie OAuth si fue consumida
// 5. Devolver NextResponse con JSON + headers
//
// ESTILO PLC/LADDER: entrada = ConversationResult, salida = NextResponse

import { NextResponse } from 'next/server';
import { COOKIE_NAME } from '@/lib/oauth-cookie';
import type { ConversationResult } from './conversation-loop';
import { detectButtons } from './button-detector';
import type { ButtonConfig, DetectorState } from './button-detector';

// ActionContext — datos que el frontend necesita para ejecutar botones de acción
interface ActionContext {
  content?: string;           // Texto del post (para create_draft)
  imageUrls?: string[];       // URLs permanentes de media.getlate.dev
  imagePrompt?: string;       // Prompt para regenerar imagen
  platforms?: Array<{ platform: string; accountId: string }>;
}

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

  // === DETECTAR BOTONES ===
  const detectorState: DetectorState = {
    generateImageWasCalled: state.generateImageWasCalled,
    lastGeneratedImageUrls: state.lastGeneratedImageUrls,
  };

  const buttons: ButtonConfig[] | undefined = detectButtons(fullText, detectorState);

  if (buttons) {
    console.log(`[Pioneer] Botones detectados: ${buttons.length} (${buttons.map(b => b.id).join(', ')})`);
  }

  // === CONSTRUIR ACTION CONTEXT (solo si hay botones de acción) ===
  let actionContext: ActionContext | undefined;

  if (buttons?.some(b => b.type === 'action')) {
    actionContext = {};

    // Contenido del post (del último generate_content)
    if (state.lastGeneratedContent) {
      actionContext.content = state.lastGeneratedContent;
    }

    // URLs de imagen
    if (state.lastGeneratedImageUrls.length > 0) {
      actionContext.imageUrls = state.lastGeneratedImageUrls;
    }

    // Prompt de imagen (para regenerate)
    if (state.lastImagePrompt) {
      actionContext.imagePrompt = state.lastImagePrompt;
    }

    // Plataformas conectadas
    if (state.connectedPlatforms) {
      actionContext.platforms = state.connectedPlatforms;
    }

    console.log(`[Pioneer] ActionContext incluido: content=${!!actionContext.content}, images=${actionContext.imageUrls?.length || 0}, platforms=${actionContext.platforms?.length || 0}`);
  }

  // === CONSTRUIR RESPUESTA JSON ===
  const jsonResponse = NextResponse.json({
    message: fullText,
    ...(result.lastUsage && { usage: result.lastUsage }),
    ...(buttons && { buttons }),
    ...(actionContext && { actionContext }),
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
