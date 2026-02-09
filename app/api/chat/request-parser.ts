// request-parser.ts — Parse del request HTTP entrante
//
// RESPONSABILIDADES:
// 1. Validar body (messages array)
// 2. Formatear mensajes para Anthropic API
// 3. Leer cookie OAuth (pendingOAuthData)
// 4. Inicializar estado del guardian
//
// ESTILO PLC/LADDER: entrada = NextRequest, salida = ParsedRequest | error

import Anthropic from '@anthropic-ai/sdk';
import { NextRequest } from 'next/server';
import { getOAuthCookie } from '@/lib/oauth-cookie';
import type { OAuthPendingData } from '@/lib/oauth-cookie';
import { createGuardianState } from './draft-guardian';
import type { GuardianState } from './draft-guardian';

// === RESULTADO DEL PARSING ===
export interface ParsedRequest {
  messages: Anthropic.MessageParam[];
  pendingOAuthData: OAuthPendingData | null;
  guardianState: GuardianState;
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
  let body: { messages?: unknown };
  try {
    body = await request.json();
  } catch {
    return {
      success: false,
      error: { error: 'Body inválido: se espera JSON', status: 400 },
    };
  }

  const { messages } = body;

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

  // 4. Inicializar estado del guardian
  const guardianState = createGuardianState();

  return {
    success: true,
    data: {
      messages: formattedMessages,
      pendingOAuthData,
      guardianState,
    },
  };
}
