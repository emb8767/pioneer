// Validación preventiva y flujo Draft-First para Pioneer Agent
//
// === CAMBIOS Draft-First ===
// - validateAndPrepareDraft(): valida contenido/cuentas para crear draft
// - activateDraftWithRetry(): PUT /v1/posts/{draft_id} con retry inteligente
// - Manejo nativo de Error 409 (duplicados detectados por Late.dev)
// - Eliminado: publishWithRetry() basado en createPost()

import {
  listAccounts,
  createDraftPost,
  activateDraft,
  PR_TIMEZONE,
  LateApiError,
} from '@/lib/late-client';
import type { Platform, LatePlatformTarget, LatePost } from '@/lib/types';

// === CHARACTER LIMITS PER PLATFORM ===
// Moved from content-generator.ts (now deleted) since this is the only consumer
const PLATFORM_CHAR_LIMITS: Record<Platform, number> = {
  twitter: 280,
  instagram: 2200,
  facebook: 63206,
  linkedin: 3000,
  tiktok: 2200,
  youtube: 5000,
  pinterest: 500,
  reddit: 40000,
  bluesky: 300,
  threads: 500,
  googlebusiness: 1500,
  telegram: 4096,
  snapchat: 250,
};

// === LIMPIAR MARKDOWN Y FORMATO PARA REDES SOCIALES ===
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*\*(.*?)\*\*\*/g, '$1')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^"|"$/gm, '')
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/\\"/g, '"');
}

// === INTERFACES ===

export interface ValidatedDraftData {
  content: string;
  platforms: LatePlatformTarget[];
  mediaItems?: Array<{ type: 'image' | 'video'; url: string }>;
  timezone: string;
}

export interface ValidatedActivateData {
  publishNow?: boolean;
  scheduledFor?: string;
  timezone?: string;
  queuedFromProfile?: string;
}

export interface ValidationResult {
  success: boolean;
  data?: ValidatedDraftData;
  error?: string;
  corrections?: string[];
}

// === HELPER: Validar que una URL de media es de origen confiable ===
function isValidMediaOrigin(url: string): boolean {
  return (
    url.startsWith('https://replicate.delivery/') ||
    url.startsWith('https://media.getlate.dev/')
  );
}

// ============================================================
// === VALIDACIÓN PARA CREATE_DRAFT ===
// ============================================================

export async function validateAndPrepareDraft(
  input: {
    content: string;
    platforms: Array<{ platform: string; account_id: string }>;
    media_urls?: string[];
  },
  hasValidImages: boolean
): Promise<ValidationResult> {
  const corrections: string[] = [];

  // --- 0. Validar media_urls vs imagen generada ---
  if (input.media_urls?.length && !hasValidImages) {
    const allFromValidOrigin = input.media_urls.every(url => isValidMediaOrigin(url));
    if (!allFromValidOrigin) {
      return {
        success: false,
        error: 'ERROR: Se incluyeron media_urls con URLs no válidas. Las URLs de imágenes deben ser de replicate.delivery o media.getlate.dev (obtenidas via generación de imagen). Genera la imagen PRIMERO para obtener una URL real.',
        corrections: ['media_urls rechazadas: URLs no son de replicate.delivery ni media.getlate.dev y no se generó imagen en esta sesión'],
      };
    }
    corrections.push('media_urls de origen válido aceptadas de request anterior (imagen no fue generada en este request)');
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
      validatedPlatforms.push({ platform, accountId: exactMatch._id });
      continue;
    }

    const platformMatch = realAccounts.find(
      (acc) => acc.platform === platform
    );

    if (platformMatch) {
      corrections.push(
        `account_id para ${platform} corregido: ${requested.account_id} → ${platformMatch._id} (${platformMatch.username || 'sin username'})`
      );
      validatedPlatforms.push({ platform, accountId: platformMatch._id });
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

  // --- 6. Construir datos del draft ---
  const draftData: ValidatedDraftData = {
    content: finalContent,
    platforms: validatedPlatforms,
    timezone: PR_TIMEZONE,
  };

  if (validMediaUrls.length > 0) {
    draftData.mediaItems = validMediaUrls.map((url) => ({
      type: (url.match(/\.(mp4|mov|avi|webm)$/i) ? 'video' : 'image') as 'image' | 'video',
      url,
    }));
  }

  return {
    success: true,
    data: draftData,
    corrections,
  };
}

// ============================================================
// === CREAR DRAFT CON RETRY ===
// ============================================================

export async function createDraftWithRetry(
  data: ValidatedDraftData
): Promise<{ message: string; post: LatePost; duplicate?: boolean }> {
  try {
    const result = await createDraftPost({
      content: data.content,
      platforms: data.platforms,
      mediaItems: data.mediaItems,
      timezone: data.timezone,
    });
    return result;
  } catch (firstError) {
    console.error('[Pioneer] Primer intento de crear draft falló:', firstError);

    // === MANEJO NATIVO: Error 409 — Duplicado detectado por Late.dev ===
    if (firstError instanceof LateApiError && firstError.status === 409) {
      console.log('[Pioneer] Late.dev detectó contenido duplicado (409). Retornando como éxito parcial.');
      let existingPostId: string | undefined;
      try {
        const body = JSON.parse(firstError.body);
        existingPostId = body.details?.existingPostId;
      } catch { /* body no parseable */ }

      return {
        message: 'Este contenido ya fue publicado en las últimas 24 horas.',
        post: {
          _id: existingPostId || 'unknown',
          content: data.content,
          status: 'published' as const,
          platforms: [],
        },
        duplicate: true,
      };
    }

    // Parsear errorCategory de Late.dev
    if (firstError instanceof LateApiError) {
      const errorInfo = parseLateDevError(firstError);
      if (errorInfo) {
        console.log(`[Pioneer] Late.dev errorCategory: ${errorInfo.category}, source: ${errorInfo.source}`);
        if (errorInfo.source === 'user') {
          throw firstError; // No reintentar errores de usuario
        }
      }
    }

    if (!isTransientError(firstError)) {
      throw firstError;
    }

    const retryAfterMs = getRetryAfterMs(firstError);
    const waitTime = retryAfterMs || 2000;

    console.log(`[Pioneer] Error transitorio creando draft. Reintentando en ${waitTime}ms...`);
    await new Promise((resolve) => setTimeout(resolve, waitTime));

    try {
      return await createDraftPost({
        content: data.content,
        platforms: data.platforms,
        mediaItems: data.mediaItems,
        timezone: data.timezone,
      });
    } catch (retryError) {
      console.error('[Pioneer] Retry de draft falló:', retryError);
      throw retryError;
    }
  }
}

// ============================================================
// === ACTIVAR DRAFT CON RETRY ===
// ============================================================

export async function activateDraftWithRetry(
  draftId: string,
  data: ValidatedActivateData
): Promise<{ message: string; post: LatePost }> {
  try {
    const result = await activateDraft(draftId, data);
    return result;
  } catch (firstError) {
    console.error('[Pioneer] Primer intento de activar draft falló:', firstError);

    // === MANEJO NATIVO: Error 409 en activación ===
    if (firstError instanceof LateApiError && firstError.status === 409) {
      console.log('[Pioneer] Late.dev detectó duplicado en activación (409).');
      let existingPostId: string | undefined;
      try {
        const body = JSON.parse(firstError.body);
        existingPostId = body.details?.existingPostId;
      } catch { /* body no parseable */ }

      return {
        message: 'Este contenido ya fue publicado en las últimas 24 horas.',
        post: {
          _id: existingPostId || draftId,
          content: '',
          status: 'published' as const,
          platforms: [],
        },
      };
    }

    if (firstError instanceof LateApiError) {
      const errorInfo = parseLateDevError(firstError);
      if (errorInfo) {
        console.log(`[Pioneer] Late.dev errorCategory: ${errorInfo.category}, source: ${errorInfo.source}`);
        if (errorInfo.source === 'user') {
          throw firstError;
        }
      }
    }

    if (!isTransientError(firstError)) {
      throw firstError;
    }

    const retryAfterMs = getRetryAfterMs(firstError);
    const waitTime = retryAfterMs || 2000;

    console.log(`[Pioneer] Error transitorio activando draft. Reintentando en ${waitTime}ms...`);
    await new Promise((resolve) => setTimeout(resolve, waitTime));

    try {
      return await activateDraft(draftId, data);
    } catch (retryError) {
      console.error('[Pioneer] Retry de activación falló:', retryError);
      throw retryError;
    }
  }
}

// ============================================================
// === HELPERS DE ERROR (internos) ===
// ============================================================

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

function getRetryAfterMs(error: unknown): number | null {
  if (error instanceof LateApiError) {
    if (error.retryAfterMs) {
      return error.retryAfterMs;
    }
    if (error.status === 429) {
      return 10_000;
    }
  }
  return null;
}
