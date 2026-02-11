// response-builder.ts — DB-first con safety net
//
// Si Claude genera texto de post SIN llamar generate_content (no obedece system prompt),
// el response-builder lo detecta y guarda el contenido en DB automáticamente.
// Esto garantiza que approve_text SIEMPRE tendrá un postId válido.

import { NextResponse } from 'next/server';
import { COOKIE_NAME } from '@/lib/oauth-cookie';
import type { ConversationResult } from './conversation-loop';
import { detectButtons } from './button-detector';
import type { ButtonConfig, DetectorState } from './button-detector';
import { createPost, getActivePlan, getPostsByPlan } from '@/lib/db';

// Extraer contenido del post del texto de Claude
// Patrón: texto entre --- separadores, o todo el texto antes de "¿Le gusta"
function extractPostContent(text: string): string | null {
  // Intentar extraer entre --- separadores
  const separatorMatch = text.match(/---\s*\n([\s\S]+?)\n\s*---/);
  if (separatorMatch) {
    const content = separatorMatch[1].trim();
    if (content.length > 20) return content;
  }

  // Fallback: extraer desde el primer emoji/texto hasta "¿Le gusta" o "¿Qué le parece"
  const beforeQuestion = text.split(/¿(?:le gusta|qué le parece|prefiere algún cambio)/i)[0];
  if (beforeQuestion) {
    // Remover la intro de Claude ("Aquí está el Post #N...")
    const lines = beforeQuestion.split('\n');
    const contentStart = lines.findIndex(l => /^[^\s*#]/.test(l.trim()) && l.trim().length > 10 && !l.includes('Post #') && !l.includes('---'));
    if (contentStart >= 0) {
      const content = lines.slice(contentStart).join('\n').replace(/---\s*$/g, '').trim();
      if (content.length > 20) return content;
    }
  }

  return null;
}

export async function buildResponse(result: ConversationResult): Promise<NextResponse> {
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

  // === SAFETY NET: Si hay botón approve_text pero no hay postId, guardar en DB ===
  const hasApproveTextButton = buttons?.some(b => b.action === 'approve_text');

  if (hasApproveTextButton && !state.activePostId && state.sessionId) {
    console.warn(`[Pioneer] ⚠️ SAFETY NET: Claude generó texto sin llamar generate_content. Guardando en DB...`);

    const postContent = extractPostContent(fullText);

    if (postContent) {
      try {
        // Buscar plan activo
        const plan = await getActivePlan(state.sessionId);
        if (plan) {
          const existingPosts = await getPostsByPlan(plan.id);
          const orderNum = existingPosts.length + 1;

          const dbPost = await createPost(plan.id, {
            order_num: orderNum,
            content: postContent,
            // No hay imageSpec porque Claude no llamó generate_content
          });

          state.activePostId = dbPost.id;
          state.activePlanId = plan.id;
          console.log(`[Pioneer] ✅ SAFETY NET: Post guardado en DB: ${dbPost.id} (order: ${orderNum}, content: "${postContent.substring(0, 60)}...")`);
        } else {
          console.error(`[Pioneer] SAFETY NET: No hay plan activo para sessionId=${state.sessionId}`);
        }
      } catch (err) {
        console.error(`[Pioneer] SAFETY NET error:`, err);
      }
    } else {
      console.error(`[Pioneer] SAFETY NET: No se pudo extraer contenido del texto de Claude`);
    }
  }

  // === CONSTRUIR ACTION CONTEXT — Solo DB IDs ===
  let actionContext: Record<string, unknown> | undefined;

  const hasDbIds = !!(state.sessionId || state.activePlanId || state.activePostId);

  if (hasDbIds) {
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
