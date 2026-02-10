// response-builder.ts — Construye la respuesta HTTP final
//
// RESPONSABILIDADES:
// 1. Detectar botones en texto de Claude + estado del guardian (describe_image)
// 2. Incluir actionContext cuando hay datos relevantes (content, platforms, imageSpec)
// 3. Limpiar cookie OAuth si fue consumida
// 4. Devolver NextResponse con JSON + headers
//
// Fase 3 fix: actionContext se incluye SIEMPRE que haya datos relevantes,
// no solo cuando hay botones de acción. Esto permite al frontend persistir
// content/platforms entre requests para cuando los botones de acción aparezcan después.

import { NextResponse } from 'next/server';
import { COOKIE_NAME } from '@/lib/oauth-cookie';
import type { ConversationResult } from './conversation-loop';
import { detectButtons } from './button-detector';
import type { ButtonConfig, DetectorState } from './button-detector';

// ActionContext — datos que el frontend necesita para ejecutar botones de acción
interface ActionContext {
  content?: string;           // Texto del post
  imagePrompt?: string;       // Prompt para generar imagen
  imageModel?: string;        // Modelo (schnell/pro)
  imageAspectRatio?: string;  // Aspect ratio
  imageCount?: number;        // Cantidad de imágenes
  platforms?: Array<{ platform: string; accountId: string }>;
}

export function buildResponse(result: ConversationResult): NextResponse {
  const fullText = result.finalText;
  const state = result.guardianState;

  // === DETECTAR BOTONES ===
  const detectorState: DetectorState = {
    describeImageWasCalled: state.describeImageWasCalled,
    hasImageSpec: !!state.lastImageSpec,
  };

  const buttons: ButtonConfig[] | undefined = detectButtons(fullText, detectorState);

  if (buttons) {
    console.log(`[Pioneer] Botones detectados: ${buttons.length} (${buttons.map(b => b.id).join(', ')})`);
  }

  // === CONSTRUIR ACTION CONTEXT ===
  // Se incluye SIEMPRE que haya datos relevantes (content, platforms, imageSpec).
  // Razón: generate_content y describe_image pueden ocurrir en requests SEPARADOS.
  // El frontend persiste el actionContext entre mensajes y lo merge cuando necesita.
  let actionContext: ActionContext | undefined;

  const hasContent = !!state.lastGeneratedContent;
  const hasImageSpec = !!state.lastImageSpec;
  const hasPlatforms = !!state.connectedPlatforms;

  if (hasContent || hasImageSpec || hasPlatforms) {
    actionContext = {};

    if (state.lastGeneratedContent) {
      actionContext.content = state.lastGeneratedContent;
    }

    if (state.lastImageSpec) {
      actionContext.imagePrompt = state.lastImageSpec.prompt;
      actionContext.imageModel = state.lastImageSpec.model;
      actionContext.imageAspectRatio = state.lastImageSpec.aspect_ratio;
      actionContext.imageCount = state.lastImageSpec.count;
    }

    if (state.connectedPlatforms) {
      actionContext.platforms = state.connectedPlatforms;
    }

    console.log(`[Pioneer] ActionContext incluido: content=${hasContent}, imageSpec=${hasImageSpec}, platforms=${hasPlatforms ? state.connectedPlatforms!.length : 0}`);
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
