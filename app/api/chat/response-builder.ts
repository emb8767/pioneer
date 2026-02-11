// response-builder.ts — DB-first: ActionContext solo tiene DB IDs
//
// Content, imageSpec, platforms, counter — TODO vive en DB.
// ActionContext solo lleva: sessionId, planId, postId.
// El action-handler lee todo de DB usando estos IDs.

import { NextResponse } from 'next/server';
import { COOKIE_NAME } from '@/lib/oauth-cookie';
import type { ConversationResult } from './conversation-loop';
import { detectButtons } from './button-detector';
import type { ButtonConfig, DetectorState } from './button-detector';

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

  // === CONSTRUIR ACTION CONTEXT — Solo DB IDs ===
  let actionContext: Record<string, unknown> | undefined;

  const hasDbIds = !!(state.sessionId || state.activePlanId || state.activePostId);
  const hasImageSpec = !!state.lastImageSpec;

  if (hasDbIds || hasImageSpec) {
    actionContext = {};

    if (state.sessionId) actionContext.sessionId = state.sessionId;
    if (state.activePlanId) actionContext.planId = state.activePlanId;
    if (state.activePostId) actionContext.postId = state.activePostId;

    console.log(`[Pioneer] ActionContext: sessionId=${state.sessionId || 'null'}, planId=${state.activePlanId || 'null'}, postId=${state.activePostId || 'null'}`);
  }

  // === CONSTRUIR RESPUESTA JSON ===
  const jsonResponse = NextResponse.json({
    message: fullText,
    ...(result.lastUsage && { usage: result.lastUsage }),
    ...(buttons && { buttons }),
    ...(actionContext && { actionContext }),
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
