// Validación preventiva y retry inteligente para publish_post
// Extraído de app/api/chat/route.ts para modularidad

import {
  listAccounts,
  createPost,
  getNextOptimalTime,
  PR_TIMEZONE,
  LateApiError,
} from '@/lib/late-client';
import { PLATFORM_CHAR_LIMITS } from '@/lib/content-generator';
import type { Platform, LatePlatformTarget } from '@/lib/types';

// === LIMPIAR MARKDOWN Y FORMATO PARA REDES SOCIALES ===
// Facebook, Instagram, etc. no renderizan markdown — los ** se muestran como asteriscos
// También limpia comillas decorativas que Claude añade alrededor de "testimonios"
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*\*(.*?)\*\*\*/g, '$1')   // ***bold italic*** → text
    .replace(/\*\*(.*?)\*\*/g, '$1')        // **bold** → text
    .replace(/\*(.*?)\*/g, '$1')            // *italic* → text
    .replace(/~~(.*?)~~/g, '$1')            // ~~strikethrough~~ → text
    .replace(/`(.*?)`/g, '$1')              // `code` → text
    .replace(/^#{1,6}\s+/gm, '')            // ### headers → text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [link](url) → link text
    .replace(/^"|"$/gm, '')                 // Comillas decorativas al inicio/fin de línea
    .replace(/[""]/g, '"')                  // Comillas tipográficas → rectas
    .replace(/['']/g, "'")                  // Apóstrofes tipográficos → rectos
    .replace(/\\"/g, '"');                  // Comillas escapadas \"...\" → "..."
}

// === INTERFACES ===

export interface ValidatedPublishData {
  content: string;
  platforms: LatePlatformTarget[];
  publishNow?: boolean;
  scheduledFor?: string;
  timezone?: string;
  mediaItems?: Array<{ type: 'image' | 'video'; url: string }>;
  queuedFromProfile?: string;
}

export interface ValidationResult {
  success: boolean;
  data?: ValidatedPublishData;
  error?: string;
  corrections?: string[];
}

// === VALIDACIÓN PREVENTIVA PARA PUBLISH_POST ===

export async function validateAndPreparePublish(
  input: {
    content: string;
    platforms: Array<{ platform: string; account_id: string }>;
    publish_now?: boolean;
    scheduled_for?: string;
    timezone?: string;
    media_urls?: string[];
    use_queue?: boolean;
    queue_profile_id?: string;
  },
  generateImageWasCalled: boolean
): Promise<ValidationResult> {
  const corrections: string[] = [];

  // --- 0. Validar media_urls vs generate_image tracking ---
  if (input.media_urls?.length && !generateImageWasCalled) {
    const allFromReplicate = input.media_urls.every(url =>
      url.startsWith('https://replicate.delivery/')
    );
    if (!allFromReplicate) {
      return {
        success: false,
        error: 'ERROR: Se incluyeron media_urls con URLs no válidas. Las URLs de imágenes deben ser de replicate.delivery (obtenidas via generate_image). Llama la tool generate_image PRIMERO para obtener una URL real.',
        corrections: ['media_urls rechazadas: URLs no son de replicate.delivery y generate_image no fue llamada en esta sesión'],
      };
    }
    corrections.push('media_urls de replicate.delivery aceptadas de request anterior (generate_image no fue llamada en este request)');
  }

  // --- 1. Limpiar markdown del contenido ---
  const cleanContent = stripMarkdown(input.content);

  // --- 2. Obtener cuentas reales de Late.dev ---
  let realAccounts: Array<{ _id: string; platform: string; username?: string }>;
  try {
    const accountsResult = await listAccounts();
    realAccounts = accountsResult.accounts;
  } catch (error) {
    return {
      success: false,
      error: `No se pudieron verificar las cuentas conectadas: ${error instanceof Error ? error.message : 'Error desconocido'}`,
    };
  }

  if (realAccounts.length === 0) {
    return {
      success: false,
      error: 'No hay cuentas de redes sociales conectadas. El cliente debe conectar al menos una cuenta antes de publicar.',
    };
  }

  // --- 3. Validar y auto-corregir cada account_id ---
  const validatedPlatforms: LatePlatformTarget[] = [];

  for (const requested of input.platforms) {
    const platform = requested.platform as Platform;

    const exactMatch = realAccounts.find(
      (acc) => acc._id === requested.account_id && acc.platform === platform
    );

    if (exactMatch) {
      validatedPlatforms.push({
        platform,
        accountId: exactMatch._id,
      });
      continue;
    }

    const platformMatch = realAccounts.find(
      (acc) => acc.platform === platform
    );

    if (platformMatch) {
      corrections.push(
        `account_id para ${platform} corregido: ${requested.account_id} → ${platformMatch._id} (${platformMatch.username || 'sin username'})`
      );
      validatedPlatforms.push({
        platform,
        accountId: platformMatch._id,
      });
      continue;
    }

    corrections.push(
      `No hay cuenta conectada para ${platform} — omitida de la publicación`
    );
  }

  if (validatedPlatforms.length === 0) {
    return {
      success: false,
      error: 'Ninguna de las plataformas solicitadas tiene una cuenta conectada. El cliente debe conectar sus redes sociales primero.',
      corrections,
    };
  }

  // --- 4. Validar límite de caracteres por plataforma ---
  for (const vp of validatedPlatforms) {
    const charLimit = PLATFORM_CHAR_LIMITS[vp.platform];
    if (charLimit && cleanContent.length > charLimit) {
      corrections.push(
        `Contenido excede límite de ${vp.platform} (${cleanContent.length}/${charLimit} chars) — truncado`
      );
    }
  }

  let finalContent = cleanContent;
  const minCharLimit = Math.min(
    ...validatedPlatforms.map((vp) => PLATFORM_CHAR_LIMITS[vp.platform] || Infinity)
  );
  if (finalContent.length > minCharLimit) {
    finalContent = finalContent.substring(0, minCharLimit - 3) + '...';
  }

  // --- 5. Validar media_urls — SOLO permitir http:// y https:// ---
  const validMediaUrls: string[] = [];
  if (input.media_urls?.length) {
    for (const url of input.media_urls) {
      if (url.startsWith('http://') || url.startsWith('https://')) {
        validMediaUrls.push(url);
      } else {
        corrections.push(
          `URL de media inválida descartada (protocolo no soportado): ${url.substring(0, 80)}...`
        );
      }
    }
  }

  // --- 6. Construir datos de publicación ---
  const publishData: ValidatedPublishData = {
    content: finalContent,
    platforms: validatedPlatforms,
  };

  // Modo queue: agregar a la cola de publicación
  if (input.use_queue) {
    publishData.queuedFromProfile = input.queue_profile_id || '6984c371b984889d86a8b3d6';
    // NO agregar publishNow ni scheduledFor — Late.dev asigna el slot
  } else if (input.publish_now) {
    publishData.publishNow = true;
  } else if (input.scheduled_for) {
    publishData.scheduledFor = input.scheduled_for;
    publishData.timezone = input.timezone || PR_TIMEZONE;
  } else {
    publishData.scheduledFor = getNextOptimalTime();
    publishData.timezone = PR_TIMEZONE;
  }

  if (validMediaUrls.length > 0) {
    publishData.mediaItems = validMediaUrls.map((url) => ({
      type: (url.match(/\.(mp4|mov|avi|webm)$/i) ? 'video' : 'image') as 'image' | 'video',
      url,
    }));
  }

  return {
    success: true,
    data: publishData,
    corrections,
  };
}

// === RETRY INTELIGENTE ===

// Parsear error categorizado de Late.dev (changelog Feb 2, 2026)
interface LateErrorInfo {
  category: 'auth_expired' | 'user_content' | 'user_abuse' | 'account_issue' | 'platform_rejected' | 'platform_error' | 'system_error' | 'unknown';
  source: 'user' | 'platform' | 'system' | 'unknown';
  message: string;
}

function parseLateDevError(error: LateApiError): LateErrorInfo | null {
  try {
    const body = JSON.parse(error.body);
    if (body.errorCategory) {
      return {
        category: body.errorCategory,
        source: body.errorSource || 'unknown',
        message: body.errorMessage || error.message,
      };
    }
  } catch {
    // body no es JSON parseable
  }
  return null;
}

// Detectar errores transitorios (entre Pioneer y Late.dev)
function isTransientError(error: unknown): boolean {
  if (error instanceof LateApiError) {
    if (error.status >= 500) {
      const clearErrors = ['invalid', 'not found', 'unauthorized', 'forbidden'];
      const bodyLower = error.body.toLowerCase();
      return !clearErrors.some((msg) => bodyLower.includes(msg));
    }
    if (error.status === 429) return true;
    return false;
  }
  if (error instanceof TypeError && error.message.includes('fetch')) return true;
  return false;
}

// Obtener tiempo de espera del Retry-After header de Late.dev
function getRetryAfterMs(error: unknown): number | null {
  if (error instanceof LateApiError) {
    // Usar retryAfterMs extraído del header en lateRequest()
    if (error.retryAfterMs) {
      return error.retryAfterMs;
    }
    // Fallback para 429 sin header: 10s basado en velocity limit de 15 posts/hora
    if (error.status === 429) {
      return 10_000;
    }
  }
  return null;
}

export async function publishWithRetry(
  data: ValidatedPublishData
): Promise<{ message: string; post: unknown }> {
  try {
    const result = await createPost(data);
    return result;
  } catch (firstError) {
    console.error('[Pioneer] Primer intento de publicación falló:', firstError);

    // Parsear errorCategory de Late.dev si disponible
    if (firstError instanceof LateApiError) {
      const errorInfo = parseLateDevError(firstError);
      if (errorInfo) {
        console.log(`[Pioneer] Late.dev errorCategory: ${errorInfo.category}, source: ${errorInfo.source}`);
        // No reintentar errores de usuario o contenido — el cliente necesita actuar
        if (errorInfo.source === 'user') {
          throw firstError;
        }
      }
    }

    if (!isTransientError(firstError)) {
      throw firstError;
    }

    // Leer Retry-After header si disponible (Late.dev lo envía en 429)
    const retryAfterMs = getRetryAfterMs(firstError);
    const waitTime = retryAfterMs || 2000;

    console.log(`[Pioneer] Error transitorio. Reintentando en ${waitTime}ms...`);
    await new Promise((resolve) => setTimeout(resolve, waitTime));

    try {
      return await createPost(data);
    } catch (retryError) {
      console.error('[Pioneer] Retry falló:', retryError);
      throw retryError;
    }
  }
}
