// response-builder.ts — Fase DB-1: ActionContext con DB IDs
//
// RESPONSABILIDADES:
// 1. Detectar botones en texto de Claude + estado del guardian
// 2. Incluir actionContext con DB IDs (sessionId, planId, postId) + legacy data
// 3. Limpiar cookie OAuth si fue consumida
// 4. Devolver NextResponse con JSON + headers
//
// Fase DB-1: actionContext incluye DB IDs como fuente principal.
// Content ya NO se propaga en actionContext — se lee de DB por postId.

import { NextResponse } from 'next/server';
import { COOKIE_NAME } from '@/lib/oauth-cookie';
import type { ConversationResult } from './conversation-loop';
import { detectButtons } from './button-detector';
import type { ButtonConfig, DetectorState } from './button-detector';

// ActionContext — datos que el frontend necesita para ejecutar botones de acción
interface ActionContext {
  // DB IDs (Fase DB-1) — fuente de verdad
  sessionId?: string;
  planId?: string;
  postId?: string;
  // Legacy: content se mantiene TEMPORALMENTE para fallback
  // Una vez confirmado que DB funciona, se puede eliminar
  content?: string;
  // Image spec
  imagePrompt?: string;
  imageModel?: string;
  imageAspectRatio?: string;
  imageCount?: number;
  // Platforms
  platforms?: Array<{ platform: string; accountId: string }>;
  // Counter (legacy — DB es fuente de verdad via planId)
  planPostCount?: number;
  postsPublished?: number;
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
  let actionContext: ActionContext | undefined;

  const hasContent = !!state.lastGeneratedContent;
  const hasImageSpec = !!state.lastImageSpec;
  const hasPlatforms = !!state.connectedPlatforms;
  const hasPlanPostCount = state.planPostCount !== null;
  const hasDbIds = !!(state.sessionId || state.activePlanId || state.activePostId);

  if (hasContent || hasImageSpec || hasPlatforms || hasPlanPostCount || hasDbIds) {
    actionContext = {};

    // DB IDs — siempre incluir si existen
    if (state.sessionId) {
      actionContext.sessionId = state.sessionId;
    }
    if (state.activePlanId) {
      actionContext.planId = state.activePlanId;
    }
    if (state.activePostId) {
      actionContext.postId = state.activePostId;
    }

    // Content — incluir como fallback (DB es fuente de verdad via postId)
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

    if (state.planPostCount !== null) {
      actionContext.planPostCount = state.planPostCount;
    }

    console.log(`[Pioneer] ActionContext: sessionId=${state.sessionId || 'null'}, planId=${state.activePlanId || 'null'}, postId=${state.activePostId || 'null'}, content=${hasContent}, imageSpec=${hasImageSpec}, platforms=${hasPlatforms ? state.connectedPlatforms!.length : 0}`);
  }

  // === CONSTRUIR RESPUESTA JSON ===
  const jsonResponse = NextResponse.json({
    message: fullText,
    ...(result.lastUsage && { usage: result.lastUsage }),
    ...(buttons && { buttons }),
    ...(actionContext && { actionContext }),
    // Fase DB-1: sessionId para que el frontend lo persista
    ...(state.sessionId && { sessionId: state.sessionId }),
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
