// action-handler.ts — Ejecuta acciones de botones directamente (sin Claude API)
//
// RESPONSABILIDADES:
// 1. generate_image: genera imagen con Replicate desde imageSpec → retorna URL
// 2. approve_and_publish: create_draft + activate en cadena → publicado
// 3. publish_no_image: create_draft sin media + activate → publicado
// 4. regenerate_image: genera nueva imagen con mismo spec → retorna URL
//
// PRINCIPIO: Claude DISEÑA (describe_image). El CLIENTE EJECUTA (generate_image, publish).
// Reutiliza funciones existentes de publish-validator.ts y replicate-client.ts.

import {
  validateAndPrepareDraft,
  createDraftWithRetry,
  activateDraftWithRetry,
} from '@/lib/publish-validator';
import { listAccounts, LateApiError, PR_TIMEZONE } from '@/lib/late-client';
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
    // Image spec (from describe_image tool)
    imagePrompt?: string;
    imageModel?: string;
    imageAspectRatio?: string;
    imageCount?: number;
  };
}

export interface ActionResponse {
  success: boolean;
  message: string;
  buttons?: ButtonConfig[];
  actionContext?: Record<string, unknown>;
  error?: string;
}

// === DISPATCHER ===

export async function handleAction(req: ActionRequest): Promise<ActionResponse> {
  console.log(`[Pioneer Action] Ejecutando: ${req.action}`);

  switch (req.action) {
    case 'generate_image':
      return handleGenerateImage(req.params);

    case 'approve_and_publish':
      return handleApproveAndPublish(req.params);

    case 'publish_no_image':
      return handleApproveAndPublish({ ...req.params, imageUrls: [] });

    case 'regenerate_image':
      return handleGenerateImage(req.params);

    case 'approve_text':
      return handleApproveText(req.params);

    default:
      return {
        success: false,
        message: `Acción no reconocida: ${req.action}`,
        error: `unknown_action: ${req.action}`,
      };
  }
}

// === APPROVE TEXT (texto aprobado → mostrar botones de imagen) ===
// No pasa por Claude. Directamente muestra opciones de imagen.

async function handleApproveText(params: ActionRequest['params']): Promise<ActionResponse> {
  const hasImageSpec = !!(params.imagePrompt);

  if (hasImageSpec) {
    return {
      success: true,
      message: '✅ Texto aprobado. ¿Desea generar una imagen para acompañar el post?',
      buttons: [
        {
          id: 'gen_image',
          label: '🎨 Generar imagen',
          type: 'action',
          style: 'primary',
          action: 'generate_image',
        },
        {
          id: 'skip_image',
          label: '⭕ Sin imagen, publicar',
          type: 'action',
          style: 'ghost',
          action: 'publish_no_image',
        },
      ],
      actionContext: {
        content: params.content,
        platforms: params.platforms,
        imagePrompt: params.imagePrompt,
        imageModel: params.imageModel,
        imageAspectRatio: params.imageAspectRatio,
        imageCount: params.imageCount,
      },
    };
  }

  // Sin imageSpec — publicar directamente sin imagen
  return {
    success: true,
    message: '✅ Texto aprobado.',
    buttons: [
      {
        id: 'publish_now',
        label: '👍 Publicar',
        type: 'action',
        style: 'primary',
        action: 'publish_no_image',
      },
    ],
    actionContext: {
      content: params.content,
      platforms: params.platforms,
    },
  };
}

// === GENERATE IMAGE (nueva acción principal — antes era tool de Claude) ===
// Flujo: Replicate genera → valida URL → sube a Late.dev → URL permanente

async function handleGenerateImage(params: ActionRequest['params']): Promise<ActionResponse> {
  const { imagePrompt, imageModel, imageAspectRatio, imageCount, content, platforms } = params;

  if (!imagePrompt) {
    return { success: false, message: 'Error: no hay prompt de imagen.', error: 'missing_prompt' };
  }

  const model = (imageModel as 'schnell' | 'pro') || 'schnell';
  const aspect_ratio = (imageAspectRatio as '1:1' | '16:9' | '21:9' | '2:3' | '3:2' | '4:5' | '5:4' | '9:16' | '9:21') || '1:1';
  const count = imageCount || 1;

  try {
    // Para carruseles (count > 1), generar secuencialmente con delay (Replicate free plan)
    const allImages: string[] = [];
    const errors: string[] = [];

    for (let i = 0; i < count; i++) {
      if (i > 0) {
        console.log(`[Pioneer Action] Esperando 10s antes de generar imagen ${i + 1}/${count}...`);
        await new Promise(resolve => setTimeout(resolve, 10_000));
      }

      const result = await generateImage({
        prompt: imagePrompt,
        model,
        aspect_ratio,
        num_outputs: 1,
      });

      if (result.success && result.images && result.images.length > 0) {
        allImages.push(...result.images);
      } else {
        errors.push(`Imagen ${i + 1}: ${result.error || 'Error desconocido'}`);
      }
    }

    if (allImages.length === 0) {
      return {
        success: false,
        message: `Error generando imagen: ${errors[0] || 'Sin resultado'}`,
        error: 'image_error',
      };
    }

    // FIX #1: Usar formato markdown explícito ![alt](url) para que el parser
    // de MessageContent siempre reconozca las URLs como imágenes,
    // sin depender del regex de bare URLs que puede fallar con paths inesperados.
    const imageUrlsText = allImages
      .map(url => `![Imagen generada](${url})`)
      .join('\n\n');

    return {
      success: true,
      message: `🖼️ ${allImages.length > 1 ? `${allImages.length} imágenes generadas` : 'Imagen generada'}:\n\n${imageUrlsText}\n\n¿Le gusta?`,
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
      // Pasar actionContext actualizado con las nuevas imageUrls
      actionContext: {
        content,
        imageUrls: allImages,
        platforms,
        imagePrompt,
        imageModel: model,
        imageAspectRatio: aspect_ratio,
        imageCount: count,
      },
    };
  } catch (err) {
    return {
      success: false,
      message: `Error generando imagen: ${err instanceof Error ? err.message : 'Error desconocido'}`,
      error: 'image_error',
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
  let resolvedPlatforms: Array<{ platform: string; account_id: string }>;

  if (platforms && platforms.length > 0) {
    resolvedPlatforms = platforms.map(p => ({
      platform: p.platform,
      account_id: p.accountId,
    }));
  } else {
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

  // --- Paso 2: Activar draft (publicar/programar via Queue) ---
  // PROFILE_ID de Pioneer en Late.dev
  const PIONEER_PROFILE_ID = '6984c371b984889d86a8b3d6';

  const activateData: {
    publishNow?: boolean;
    scheduledFor?: string;
    timezone?: string;
    queuedFromProfile?: string;
  } = {};

  if (publishNow) {
    activateData.publishNow = true;
  } else if (scheduledFor) {
    // Si se pasó una fecha específica (ej: fecha crítica como San Valentín), usarla
    activateData.scheduledFor = scheduledFor;
    activateData.timezone = PR_TIMEZONE;
  } else {
    // Por defecto: usar Queue de Late.dev para asignar automáticamente el próximo slot
    // Late.dev maneja distributed locking para evitar race conditions
    activateData.queuedFromProfile = PIONEER_PROFILE_ID;
  }

  try {
    await activateDraftWithRetry(draftId, activateData);

    const timeLabel = activateData.publishNow
      ? 'publicado ahora'
      : activateData.scheduledFor
        ? `programado para ${formatScheduledTime(activateData.scheduledFor)}`
        : 'agregado a la cola de publicación';

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

    return {
      success: false,
      message: `El borrador se creó pero no se pudo publicar: ${msg}. Puede intentar de nuevo.`,
      error: 'activate_error',
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
    // isoString from getNextOptimalTime is a bare datetime like "2026-02-10T12:00:00"
    // representing PR time. On Vercel (UTC), new Date() would interpret it as UTC.
    // Since we KNOW it's PR time, we parse the components directly.
    const match = isoString.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!match) {
      return isoString;
    }

    const [, yearStr, monthStr, dayStr, hourStr, minuteStr] = match;
    const year = parseInt(yearStr);
    const month = parseInt(monthStr);
    const day = parseInt(dayStr);
    const hour = parseInt(hourStr);
    const minute = parseInt(minuteStr);

    // Build a Date that represents this PR time correctly
    // Create in UTC but offset by +4h (PR is UTC-4, no DST)
    const prToUtcOffset = 4; // hours
    const utcDate = new Date(Date.UTC(year, month - 1, day, hour + prToUtcOffset, minute));

    return utcDate.toLocaleString('es-PR', {
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
