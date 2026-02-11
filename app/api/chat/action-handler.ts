// action-handler.ts — Fase DB-1: Lee content de DB, elimina Bug 5 de raíz
//
// RESPONSABILIDADES:
// 1. approve_text: lee content de DB por postId, muestra botones de imagen
// 2. generate_image: genera imagen con Replicate, actualiza image_url en DB
// 3. approve_and_publish: lee content de DB, crea draft, activa con queue, incrementa counter en DB
// 4. publish_no_image: igual que approve_and_publish sin media
// 5. regenerate_image: genera nueva imagen con mismo spec
//
// PRINCIPIO: Claude DISEÑA. El CLIENTE EJECUTA.
// DB es fuente de verdad para content y counter — Bug 5 IMPOSIBLE.

import {
  validateAndPrepareDraft,
  createDraftWithRetry,
  activateDraftWithRetry,
} from '@/lib/publish-validator';
import { listAccounts, LateApiError, PR_TIMEZONE } from '@/lib/late-client';
import { generateImage } from '@/lib/replicate-client';
import { getPost, updatePost, incrementPostsPublished, markPostScheduled } from '@/lib/db';
import type { ButtonConfig } from './button-detector';

// === TIPOS ===

export interface ActionRequest {
  action: string;
  params: {
    // DB IDs (Fase DB-1) — fuente principal
    postId?: string;
    planId?: string;
    sessionId?: string;
    // Legacy fields (fallback si DB no tiene datos)
    content?: string;
    imageUrls?: string[];
    platforms?: Array<{ platform: string; accountId: string }>;
    scheduledFor?: string;
    publishNow?: boolean;
    // Image spec (from generate_content auto image prompt)
    imagePrompt?: string;
    imageModel?: string;
    imageAspectRatio?: string;
    imageCount?: number;
    // Legacy post counter (fallback)
    planPostCount?: number;
    postsPublished?: number;
  };
}

export interface ActionResponse {
  success: boolean;
  message: string;
  buttons?: ButtonConfig[];
  actionContext?: Record<string, unknown>;
  error?: string;
}

// === HELPER: Resolver content — DB first, fallback a params ===
async function resolveContent(params: ActionRequest['params']): Promise<string | null> {
  // DB first
  if (params.postId) {
    try {
      const post = await getPost(params.postId);
      if (post?.content) {
        console.log(`[Pioneer Action] Content de DB (postId: ${params.postId}): "${post.content.substring(0, 80)}..."`);
        return post.content;
      }
    } catch (err) {
      console.error(`[Pioneer Action] Error leyendo post de DB:`, err);
    }
  }
  // Fallback a params (legacy)
  if (params.content) {
    console.log(`[Pioneer Action] Content de params (legacy): "${params.content.substring(0, 80)}..."`);
    return params.content;
  }
  return null;
}

// === DISPATCHER ===

export async function handleAction(req: ActionRequest): Promise<ActionResponse> {
  console.log(`[Pioneer Action] Ejecutando: ${req.action} (postId: ${req.params.postId || 'none'}, planId: ${req.params.planId || 'none'})`);

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
        // DB IDs propagados
        postId: params.postId,
        planId: params.planId,
        sessionId: params.sessionId,
        // Image spec para generate_image
        imagePrompt: params.imagePrompt,
        imageModel: params.imageModel,
        imageAspectRatio: params.imageAspectRatio,
        imageCount: params.imageCount,
        // Legacy fields (platforms fallback)
        platforms: params.platforms,
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
      postId: params.postId,
      planId: params.planId,
      sessionId: params.sessionId,
      platforms: params.platforms,
    },
  };
}

// === GENERATE IMAGE (nueva acción principal — antes era tool de Claude) ===
// Flujo: Replicate genera → valida URL → sube a Late.dev → URL permanente

async function handleGenerateImage(params: ActionRequest['params']): Promise<ActionResponse> {
  const { imagePrompt, imageModel, imageAspectRatio, imageCount } = params;

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

    // DB: Actualizar image_url en el post
    if (params.postId) {
      try {
        await updatePost(params.postId, {
          image_url: allImages[0], // Primera imagen como principal
          status: 'image_ready',
        });
        console.log(`[Pioneer DB] Post ${params.postId} actualizado con image_url`);
      } catch (dbErr) {
        console.error('[Pioneer DB] Error actualizando image_url:', dbErr);
      }
    }

    // FIX #1: Usar formato markdown explícito ![alt](url) para que el parser
    // de MessageContent siempre reconozca las URLs como imágenes
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
      actionContext: {
        // DB IDs
        postId: params.postId,
        planId: params.planId,
        sessionId: params.sessionId,
        // Image data
        imageUrls: allImages,
        imagePrompt,
        imageModel: model,
        imageAspectRatio: aspect_ratio,
        imageCount: count,
        // Legacy
        platforms: params.platforms,
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
// Flujo: resolve content (DB first) → validate → create_draft → activate → update DB

async function handleApproveAndPublish(params: ActionRequest['params']): Promise<ActionResponse> {
  const { imageUrls, platforms, scheduledFor, publishNow } = params;

  // --- Resolver content de DB (elimina Bug 5) ---
  const content = await resolveContent(params);

  // --- Diagnóstico ---
  console.log(`[Pioneer Action] approve_and_publish content: "${content?.substring(0, 80)}..."`);
  console.log(`[Pioneer Action] approve_and_publish imageUrls: ${imageUrls?.length || 0}`);
  console.log(`[Pioneer Action] approve_and_publish postId: ${params.postId || 'none'}, planId: ${params.planId || 'none'}`);

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
    activateData.scheduledFor = scheduledFor;
    activateData.timezone = PR_TIMEZONE;
  } else {
    activateData.queuedFromProfile = PIONEER_PROFILE_ID;
  }

  try {
    await activateDraftWithRetry(draftId, activateData);

    const timeLabel = activateData.publishNow
      ? 'publicado ahora'
      : activateData.scheduledFor
        ? `programado para ${formatScheduledTime(activateData.scheduledFor)}`
        : 'agregado a la cola de publicación';

    // --- DB: Actualizar post status y incrementar counter ---
    let postCount: number | null = params.planPostCount ?? null;
    let postsPublished: number | null = (params.postsPublished ?? 0) + 1;
    let planComplete = false;

    if (params.planId) {
      try {
        // Incrementar counter en DB (atómico)
        const updatedPlan = await incrementPostsPublished(params.planId);
        postCount = updatedPlan.post_count;
        postsPublished = updatedPlan.posts_published;
        planComplete = updatedPlan.status === 'completed';
        console.log(`[Pioneer DB] Plan counter: ${postsPublished}/${postCount} (complete: ${planComplete})`);
      } catch (dbErr) {
        console.error('[Pioneer DB] Error incrementando counter:', dbErr);
        // Fallback a legacy counter
        planComplete = postCount != null && postsPublished >= postCount;
      }
    } else {
      // Legacy fallback
      planComplete = postCount != null && postsPublished >= postCount;
    }

    // DB: Marcar post como scheduled
    if (params.postId) {
      try {
        await markPostScheduled(params.postId, draftId);
        console.log(`[Pioneer DB] Post ${params.postId} marcado como scheduled`);
      } catch (dbErr) {
        console.error('[Pioneer DB] Error marcando post:', dbErr);
      }
    }

    console.log(`[Pioneer Action] ✅ Post ${timeLabel} (draft: ${draftId}) [${postsPublished}/${postCount ?? '?'}]`);

    return {
      success: true,
      message: planComplete
        ? `✅ Post ${timeLabel} en ${resolvedPlatforms.map(p => p.platform).join(', ')}.\n\n🎉 ¡Plan completado! Se publicaron los ${postCount} posts del plan.`
        : `✅ Post ${timeLabel} en ${resolvedPlatforms.map(p => p.platform).join(', ')}. (${postsPublished}/${postCount ?? '?'})`,
      buttons: planComplete
        ? buildPlanCompleteButtons()
        : buildNextPostButtons(),
      actionContext: {
        // DB IDs para el siguiente post
        planId: params.planId,
        sessionId: params.sessionId,
        // Counter actualizado (legacy compat + display)
        planPostCount: postCount,
        postsPublished: postsPublished,
      },
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

function buildPlanCompleteButtons(): ButtonConfig[] {
  return [
    { id: 'more_posts', label: '➕ Crear más posts', type: 'option', style: 'secondary', chatMessage: 'Quiero crear más posts adicionales' },
    { id: 'done', label: '✅ Listo, terminamos', type: 'option', style: 'primary', chatMessage: 'Listo, terminamos por ahora' },
  ];
}

function formatScheduledTime(isoString: string): string {
  try {
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

    const prToUtcOffset = 4;
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
