// request-parser.ts — Fase DB-1: Parse del request HTTP con sessionId
//
// RESPONSABILIDADES:
// 1. Validar body (messages array + optional sessionId)
// 2. Formatear mensajes para Anthropic API
// 3. Leer cookie OAuth (pendingOAuthData)
// 4. Inicializar estado del guardian con sessionId
// 5. Crear session en DB si no existe
//
// ESTILO PLC/LADDER: entrada = NextRequest, salida = ParsedRequest | error

import Anthropic from '@anthropic-ai/sdk';
import { NextRequest } from 'next/server';
import { getOAuthCookie } from '@/lib/oauth-cookie';
import type { OAuthPendingData } from '@/lib/oauth-cookie';
import { createGuardianState } from './draft-guardian';
import type { GuardianState } from './draft-guardian';
import { createSession, getSession, getActivePlan, getPlanProgress } from '@/lib/db';

// === RESULTADO DEL PARSING ===
export interface SessionContext {
  businessName: string | null;
  businessInfo: Record<string, unknown>;
  status: string;
  planSummary?: { name: string | null; postCount: number; postsPublished: number } | null;
}

export interface ParsedRequest {
  messages: Anthropic.MessageParam[];
  pendingOAuthData: OAuthPendingData | null;
  guardianState: GuardianState;
  sessionId: string | null;
  sessionContext?: SessionContext | null;
}

export interface ParseError {
  error: string;
  status: number;
}

export type ParseResult =
  | { success: true; data: ParsedRequest }
  | { success: false; error: ParseError };

// === PARSER PRINCIPAL ===
export async function parseRequest(request: NextRequest): Promise<ParseResult> {

  // 1. Leer y validar body
  let body: { messages?: unknown; sessionId?: string };
  try {
    body = await request.json();
  } catch {
    return {
      success: false,
      error: { error: 'Body inválido: se espera JSON', status: 400 },
    };
  }

  const { messages, sessionId: incomingSessionId } = body;

  if (!messages || !Array.isArray(messages)) {
    return {
      success: false,
      error: { error: 'Se requiere un array de mensajes', status: 400 },
    };
  }

  // 2. Formatear mensajes para Anthropic
  const formattedMessages: Anthropic.MessageParam[] = messages.map(
    (msg: { role: string; content: string }) => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    })
  );

  // 3. Leer cookie OAuth
  let pendingOAuthData: OAuthPendingData | null = null;
  try {
    const allCookies = request.cookies.getAll();
    console.log(`[Pioneer] Cookies en request (${allCookies.length}):`, allCookies.map(c => c.name));
    pendingOAuthData = getOAuthCookie(request);
    console.log(`[Pioneer] OAuth cookie leída:`, pendingOAuthData ?
      `platform=${pendingOAuthData.platform}, step=${pendingOAuthData.step}` : 'null');
  } catch (error) {
    console.warn('[Pioneer] No se pudo leer OAuth cookie:', error);
  }

  // 4. Resolver sessionId — validar existente o crear nuevo
  let sessionId: string | null = null;
  let sessionContext: SessionContext | null = null;
  try {
    if (incomingSessionId) {
      // Validar que el sessionId existe en DB
      const session = await getSession(incomingSessionId);
      if (session) {
        sessionId = session.id;
        console.log(`[Pioneer] Session existente: ${sessionId}`);

        // Cargar contexto si tiene business_info
        if (session.business_info && Object.keys(session.business_info).length > 0) {
          sessionContext = {
            businessName: session.business_name,
            businessInfo: session.business_info,
            status: session.status,
          };

          // Buscar plan activo
          try {
            const plan = await getActivePlan(sessionId);
            if (plan) {
              const progress = await getPlanProgress(plan.id);
              if (progress) {
                sessionContext.planSummary = {
                  name: plan.plan_name,
                  postCount: plan.post_count,
                  postsPublished: progress.postsPublished,
                };
              }
            }
          } catch {
            // No bloquear si falla la búsqueda del plan
          }

          console.log(`[Pioneer] Session con business_info cargado: ${session.business_name}`);
        }
      } else {
        console.warn(`[Pioneer] SessionId inválido: ${incomingSessionId} — creando nuevo`);
        const newSession = await createSession();
        sessionId = newSession.id;
        console.log(`[Pioneer] Session nueva creada: ${sessionId}`);
      }
    } else {
      // Crear nueva session
      const newSession = await createSession();
      sessionId = newSession.id;
      console.log(`[Pioneer] Session nueva creada: ${sessionId}`);
    }
  } catch (dbErr) {
    console.error('[Pioneer] Error con session DB:', dbErr);
    // No bloquear el flujo — funciona sin DB
  }

  // 5. Inicializar estado del guardian con sessionId
  const guardianState = createGuardianState(sessionId);

  return {
    success: true,
    data: {
      messages: formattedMessages,
      pendingOAuthData,
      guardianState,
      sessionId,
      sessionContext,
    },
  };
}
