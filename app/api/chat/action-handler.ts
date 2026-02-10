// action-handler.ts — Ejecuta acciones de botones directamente (sin Claude API)
//
// RESPONSABILIDADES:
// 1. approve_and_publish: create_draft + activate en cadena → publicado
// 2. publish_no_image: create_draft sin media + activate → publicado
// 3. regenerate_image: genera nueva imagen con Replicate → retorna URL
//
// PRINCIPIO: Reutiliza funciones de publish-validator.ts y replicate-client.ts
// CERO código nuevo de Late.dev — todo ya existe.

import {
  validateAndPrepareDraft,
  createDraftWithRetry,
  activateDraftWithRetry,
} from '@/lib/publish-validator';
import { listAccounts, LateApiError, PR_TIMEZONE, getNextOptimalTime } from '@/lib/late-client';
import { generateImage } from '@/lib/replicate-client';
import type { ButtonConfig } from './button-detector';

// === TIPOS ===

export interface ActionRequest {
  action: string;
  params: {
    content?: string;
    imageUrls?: string[];
    platforms?: Array<{ platform: string; accountId: string }>;
    scheduledFor?: string;
    publishNow?: boolean;
    imagePrompt?: string;
  };
}

export interface ActionResponse {
  success: boolean;
  message: string;
  buttons?: ButtonConfig[];
  error?: string;
}

// === DISPATCHER ===

export async function handleAction(req: ActionRequest): Promise<ActionResponse> {
  console.log(`[Pioneer Action] Ejecutando: ${req.action}`);

  switch (req.action) {
    case 'approve_and_publish':
      return handleApproveAndPublish(req.params);

    case 'publish_no_image':
      return handleApproveAndPublish({ ...req.params, imageUrls: [] });

    case 'regenerate_image':
      return handleRegenerateImage(req.params);

    default:
      return {
        success: false,
        message: `Acción no reconocida: ${req.action}`,
        error: `unknown_action: ${req.action}`,
      };
  }
}

// === APPROVE AND PUBLISH (la acción más crítica) ===
// Flujo: validate → create_draft → activate → confirmación + botones siguiente

async function handleApproveAndPublish(params: ActionRequest['params']): Promise<ActionResponse> {
  const { content, imageUrls, platforms, scheduledFor, publishNow } = params;

  // --- Validaciones ---
  if (!content) {
    return { success: false, message: 'Error: no hay contenido para publicar.', error: 'missing_content' };
  }

  // --- Resolver plataformas ---
  // Si el frontend no envía platforms, buscar automáticamente
  let resolvedPlatforms: Array<{ platform: string; account_id: string }>;

  if (platforms && platforms.length > 0) {
    resolvedPlatforms = platforms.map(p => ({
      platform: p.platform,
      account_id: p.accountId,
    }));
  } else {
    // Auto-detectar: usar todas las cuentas conectadas
    try {
      const accountsResult = await listAccounts();
      if (accountsResult.accounts.length === 0) {
        return {
          success: false,
          message: 'No hay cuentas de redes sociales conectadas. Conecte una cuenta primero.',
          error: 'no_accounts',
        };
      }
      resolvedPlatforms = accountsResult.accounts.map((acc: { _id: string; platform: string }) => ({
        platform: acc.platform,
        account_id: acc._id,
      }));
    } catch (err) {
      return {
        success: false,
        message: `Error verificando cuentas: ${err instanceof Error ? err.message : 'Error desconocido'}`,
        error: 'accounts_error',
      };
    }
  }

  // --- Paso 1: Crear draft ---
  const draftInput = {
    content: content,
    platforms: resolvedPlatforms,
    media_urls: imageUrls && imageUrls.length > 0 ? imageUrls : undefined,
  };

  const validation = await validateAndPrepareDraft(draftInput, !!(imageUrls && imageUrls.length > 0));

  if (!validation.success || !validation.data) {
    return {
      success: false,
      message: `Error validando post: ${validation.error}`,
      error: 'validation_error',
    };
  }

  let draftId: string;
  try {
    const draftResult = await createDraftWithRetry(validation.data);

    if (draftResult.duplicate) {
      return {
        success: false,
        message: 'Este contenido ya fue publicado en las últimas 24 horas.',
        error: 'duplicate',
      };
    }

    draftId = draftResult.post._id;
    console.log(`[Pioneer Action] Draft creado: ${draftId}`);
  } catch (err) {
    const msg = err instanceof LateApiError
      ? `Error de Late.dev (HTTP ${err.status}): ${err.body}`
      : err instanceof Error ? err.message : 'Error desconocido';
    return { success: false, message: `Error creando borrador: ${msg}`, error: 'draft_error' };
  }

  // --- Paso 2: Activar draft (publicar/programar) ---
  const activateData: {
    publishNow?: boolean;
    scheduledFor?: string;
    timezone?: string;
  } = {};

  if (publishNow) {
    activateData.publishNow = true;
  } else if (scheduledFor) {
    activateData.scheduledFor = scheduledFor;
    activateData.timezone = PR_TIMEZONE;
  } else {
    // Sin fecha específica → próximo horario óptimo
    activateData.scheduledFor = getNextOptimalTime();
    activateData.timezone = PR_TIMEZONE;
  }

  try {
    await activateDraftWithRetry(draftId, activateData);

    const timeLabel = activateData.publishNow
      ? 'publicado ahora'
      : `programado para ${formatScheduledTime(activateData.scheduledFor!)}`;

    console.log(`[Pioneer Action] ✅ Post ${timeLabel} (draft: ${draftId})`);

    return {
      success: true,
      message: `✅ Post ${timeLabel} en ${resolvedPlatforms.map(p => p.platform).join(', ')}.`,
      buttons: buildNextPostButtons(),
    };
  } catch (err) {
    const msg = err instanceof LateApiError
      ? `Error de Late.dev (HTTP ${err.status}): ${err.body}`
      : err instanceof Error ? err.message : 'Error desconocido';

    // El draft fue creado pero no se activó — informar con opción de reintentar
    return {
      success: false,
      message: `El borrador se creó pero no se pudo publicar: ${msg}. Puede intentar de nuevo.`,
      error: 'activate_error',
    };
  }
}

// === REGENERATE IMAGE ===

async function handleRegenerateImage(params: ActionRequest['params']): Promise<ActionResponse> {
  const { imagePrompt } = params;

  if (!imagePrompt) {
    return { success: false, message: 'Error: no hay prompt de imagen.', error: 'missing_prompt' };
  }

  try {
    const result = await generateImage({
      prompt: imagePrompt,
      model: 'schnell',
      aspect_ratio: '1:1',
      num_outputs: 1,
    });

    if (!result.success || !result.images || result.images.length === 0) {
      return {
        success: false,
        message: `Error generando imagen: ${result.error || 'Sin resultado'}`,
        error: 'image_error',
      };
    }

    const imageUrl = result.images[0];

    return {
      success: true,
      message: `🖼️ Nueva imagen generada:\n\n${imageUrl}\n\n¿Le gusta esta imagen?`,
      // Retornar botones de aprobación de imagen (type: action para publicar directo)
      buttons: [
        {
          id: 'approve_image',
          label: '👍 Aprobar y programar',
          type: 'action',
          style: 'primary',
          action: 'approve_and_publish',
        },
        {
          id: 'regenerate',
          label: '🔄 Otra imagen',
          type: 'action',
          style: 'secondary',
          action: 'regenerate_image',
        },
        {
          id: 'skip_image',
          label: '⭕ Sin imagen',
          type: 'action',
          style: 'ghost',
          action: 'publish_no_image',
        },
      ],
    };
  } catch (err) {
    return {
      success: false,
      message: `Error generando imagen: ${err instanceof Error ? err.message : 'Error desconocido'}`,
      error: 'image_error',
    };
  }
}

// === HELPERS ===

function buildNextPostButtons(): ButtonConfig[] {
  return [
    { id: 'next_post', label: '▶️ Siguiente post', type: 'option', style: 'primary', chatMessage: 'Continuemos con el siguiente post' },
    { id: 'pause', label: '⏸️ Terminar por hoy', type: 'option', style: 'ghost', chatMessage: 'Pausar el plan por ahora' },
  ];
}

function formatScheduledTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleString('es-PR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: PR_TIMEZONE,
    });
  } catch {
    return isoString;
  }
}
