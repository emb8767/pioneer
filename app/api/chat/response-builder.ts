// response-builder.ts — Construye la respuesta HTTP final
//
// RESPONSABILIDADES:
// 1. Detectar botones en texto de Claude + estado del guardian (describe_image)
// 2. Incluir actionContext cuando hay botones de acción
// 3. Limpiar cookie OAuth si fue consumida
// 4. Devolver NextResponse con JSON + headers
//
// Fase 3: Sin inyección de image URLs — Claude ya no genera imágenes.
// Las imágenes se generan cuando el cliente clickea [🎨 Generar imagen].

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

  // === CONSTRUIR ACTION CONTEXT (solo si hay botones de acción) ===
  let actionContext: ActionContext | undefined;

  if (buttons?.some(b => b.type === 'action')) {
    actionContext = {};

    // Contenido del post
    if (state.lastGeneratedContent) {
      actionContext.content = state.lastGeneratedContent;
    }

    // Image spec (from describe_image)
    if (state.lastImageSpec) {
      actionContext.imagePrompt = state.lastImageSpec.prompt;
      actionContext.imageModel = state.lastImageSpec.model;
      actionContext.imageAspectRatio = state.lastImageSpec.aspect_ratio;
      actionContext.imageCount = state.lastImageSpec.count;
    }

    // Plataformas conectadas
    if (state.connectedPlatforms) {
      actionContext.platforms = state.connectedPlatforms;
    }

    console.log(`[Pioneer] ActionContext incluido: content=${!!actionContext.content}, imageSpec=${!!state.lastImageSpec}, platforms=${actionContext.platforms?.length || 0}`);
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
