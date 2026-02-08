// OAuth Cookie Utility para Pioneer Agent
// Almacena tokens temporales de OAuth headless en cookies httpOnly encriptadas.
// Los tokens de Late.dev expiran en ~10 minutos, así que las cookies también.

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

// === TIPOS ===

export interface OAuthPendingData {
  platform: string;
  step: string;
  profileId: string;
  tempToken?: string;
  connectToken?: string;
  userProfile?: Record<string, unknown>;
  pendingDataToken?: string; // LinkedIn usa este en vez de tempToken
  publicProfiles?: unknown[]; // Snapchat
  timestamp: number; // Para verificar expiración
}

// === CONFIGURACIÓN ===

const COOKIE_NAME = 'pioneer_oauth_pending';
const COOKIE_MAX_AGE_SECONDS = 600; // 10 minutos (igual que Late.dev tokens)

// Clave de encriptación derivada de LATE_API_KEY (usamos los primeros 32 chars como key)
// Esto es suficiente para proteger tokens temporales de corta duración.
// En producción con Supabase, esto se reemplazará con almacenamiento server-side.
function getEncryptionKey(): string {
  const key = process.env.LATE_API_KEY || process.env.ANTHROPIC_API_KEY || 'pioneer-default-key-for-dev';
  // Usar los primeros 32 caracteres como key base
  return key.substring(0, 32).padEnd(32, '0');
}

// === ENCRIPTACIÓN SIMPLE ===
// XOR-based encoding con base64. No es criptográficamente perfecto,
// pero los tokens son de un solo uso y expiran en 10 minutos.
// La cookie httpOnly + Secure ya previene acceso desde JavaScript del cliente.

function encode(data: string): string {
  const key = getEncryptionKey();
  let encoded = '';
  for (let i = 0; i < data.length; i++) {
    const charCode = data.charCodeAt(i) ^ key.charCodeAt(i % key.length);
    encoded += String.fromCharCode(charCode);
  }
  // Base64 encode para que sea safe para cookies
  return Buffer.from(encoded, 'binary').toString('base64');
}

function decode(encoded: string): string {
  const key = getEncryptionKey();
  const binary = Buffer.from(encoded, 'base64').toString('binary');
  let decoded = '';
  for (let i = 0; i < binary.length; i++) {
    const charCode = binary.charCodeAt(i) ^ key.charCodeAt(i % key.length);
    decoded += String.fromCharCode(charCode);
  }
  return decoded;
}

// === FUNCIONES PÚBLICAS ===

/**
 * Guarda datos de OAuth pendiente en una cookie httpOnly encriptada.
 * Llamada desde el callback de OAuth cuando Late.dev redirige en modo headless.
 */
export function setOAuthCookie(response: NextResponse, data: OAuthPendingData): void {
  const json = JSON.stringify(data);
  const encrypted = encode(json);

  response.cookies.set(COOKIE_NAME, encrypted, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

/**
 * Lee los datos de OAuth pendiente de la cookie.
 * Llamada desde la tool complete_connection en chat/route.ts.
 * Retorna null si no hay cookie, si expiró, o si no se puede decodificar.
 */
export function getOAuthCookie(request: NextRequest): OAuthPendingData | null {
  const cookieValue = request.cookies.get(COOKIE_NAME)?.value;
  
  if (!cookieValue) {
    return null;
  }

  try {
    const json = decode(cookieValue);
    const data: OAuthPendingData = JSON.parse(json);

    // Verificar que no haya expirado (10 minutos)
    const elapsed = Date.now() - data.timestamp;
    if (elapsed > COOKIE_MAX_AGE_SECONDS * 1000) {
      return null;
    }

    return data;
  } catch (error) {
    console.error('[Pioneer] Error decodificando OAuth cookie:', error);
    return null;
  }
}

/**
 * Lee los datos de OAuth pendiente usando la API de cookies de Next.js.
 * Para uso en Server Components y Route Handlers que no reciben NextRequest.
 */
export async function getOAuthCookieFromHeaders(): Promise<OAuthPendingData | null> {
  try {
    const cookieStore = await cookies();
    const cookieValue = cookieStore.get(COOKIE_NAME)?.value;

    if (!cookieValue) {
      return null;
    }

    const json = decode(cookieValue);
    const data: OAuthPendingData = JSON.parse(json);

    // Verificar que no haya expirado (10 minutos)
    const elapsed = Date.now() - data.timestamp;
    if (elapsed > COOKIE_MAX_AGE_SECONDS * 1000) {
      return null;
    }

    return data;
  } catch (error) {
    console.error('[Pioneer] Error leyendo OAuth cookie desde headers:', error);
    return null;
  }
}

/**
 * Borra la cookie de OAuth pendiente.
 * Llamada después de completar exitosamente la conexión.
 */
export function clearOAuthCookie(response: NextResponse): void {
  response.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0, // Borra inmediatamente
  });
}

/**
 * Crea un NextResponse con la cookie de OAuth borrada.
 * Útil para retornar JSON + borrar cookie en un solo response.
 */
export function createResponseWithClearedCookie(
  body: Record<string, unknown>,
  status: number = 200
): NextResponse {
  const response = NextResponse.json(body, { status });
  clearOAuthCookie(response);
  return response;
}

export { COOKIE_NAME };
