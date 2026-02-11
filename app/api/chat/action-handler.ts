// action-handler.ts — DB-first: Lee TODO de la base de datos
//
// PRINCIPIO: El frontend solo envía sessionId + planId + postId.
// Content, imageSpec, platforms, counter — TODO viene de DB.
// Bug 5 es IMPOSIBLE porque content nunca viaja por el frontend.
//
// RESPONSABILIDADES:
// 1. approve_text: lee post de DB, muestra botones de imagen
// 2. generate_image: genera imagen, guarda URL en DB
// 3. approve_and_publish: lee content+image de DB, publica, incrementa counter en DB
// 4. publish_no_image: igual sin media
// 5. regenerate_image: nueva imagen con spec de DB

import {
  validateAndPrepareDraft,
  createDraftWithRetry,
  activateDraftWithRetry,
} from '@/lib/publish-validator';
import { listAccounts, LateApiError, PR_TIMEZONE } from '@/lib/late-client';
import { generateImage } from '@/lib/replicate-client';
import {
  getPost,
  updatePost,
  getActivePlan,
  getPostsByPlan,
  incrementPostsPublished,
  markPostScheduled,
  getPlanProgress,
} from '@/lib/db';
import type { ButtonConfig } from './button-detector';

// === TIPOS ===

export interface ActionRequest {
  action: string;
  params: {
    // DB IDs — esto es TODO lo que el frontend necesita enviar
    postId?: string;
    planId?: string;
    sessionId?: string;
    // imageUrls solo vive en el flujo generate_image → approve_and_publish (mismo request chain)
    imageUrls?: string[];
    // Scheduling overrides (futuro)
    scheduledFor?: string;
    publishNow?: boolean;
  };
}

export interface ActionResponse {
  success: boolean;
  message: string;
  buttons?: ButtonConfig[];
  actionContext?: Record<string, unknown>;
  error?: string;
}

// === HELPER: Resolver post — DB es la fuente de verdad ===
async function resolvePost(params: ActionRequest['params']) {
  // 1. Directo por postId
  if (params.postId) {
    const post = await getPost(params.postId);
    if (post) {
      console.log(`[Pioneer Action] Post resuelto por postId: ${post.id} (order: ${post.order_num}, status: ${post.status})`);
      return post;
    }
    console.warn(`[Pioneer Action] postId ${params.postId} no encontrado en DB`);
  }

  // 2. Buscar por planId — el post más reciente con content que no ha sido publicado
  if (params.planId) {
    const posts = await getPostsByPlan(params.planId);
    const pending = posts.filter(p =>
      p.content && ['content_ready', 'image_ready'].includes(p.status)
    );
    if (pending.length > 0) {
      const post = pending[pending.length - 1];
      console.log(`[Pioneer Action] Post resuelto por planId fallback: ${post.id} (order: ${post.order_num})`);
      return post;
    }
  }

  // 3. Buscar por sessionId → plan activo → post pendiente
  if (params.sessionId) {
    const plan = await getActivePlan(params.sessionId);
    if (plan) {
      const posts = await getPostsByPlan(plan.id);
      const pending = posts.filter(p =>
        p.content && ['content_ready', 'image_ready'].includes(p.status)
      );
      if (pending.length > 0) {
        const post = pending[pending.length - 1];
        console.log(`[Pioneer Action] Post resuelto por sessionId fallback: ${post.id} (order: ${post.order_num})`);
        return post;
      }
    }
  }

  console.error(`[Pioneer Action] No se pudo resolver post. postId=${params.postId}, planId=${params.planId}, sessionId=${params.sessionId}`);
  return null;
}

// === DISPATCHER ===

export async function handleAction(req: ActionRequest): Promise<ActionResponse> {
  console.log(`[Pioneer Action] Ejecutando: ${req.action} (postId: ${req.params.postId || 'none'}, planId: ${req.params.planId || 'none'}, sessionId: ${req.params.sessionId || 'none'})`);

  switch (req.action) {
    case 'approve_text':
      return handleApproveText(req.params);
    case 'generate_image':
      return handleGenerateImage(req.params);
    case 'approve_and_publish':
      return handleApproveAndPublish(req.params);
    case 'publish_no_image':
      return handleApproveAndPublish({ ...req.params, imageUrls: [] });
    case 'regenerate_image':
      return handleGenerateImage(req.params);
    default:
      return {
        success: false,
        message: `Acción no reconocida: ${req.action}`,
        error: `unknown_action: ${req.action}`,
      };
  }
}

// === APPROVE TEXT ===
// Lee post de DB. Si tiene image_prompt → botones de imagen. Si no → publicar directo.

async function handleApproveText(params: ActionRequest['params']): Promise<ActionResponse> {
  const post = await resolvePost(params);

  if (!post) {
    return { success: false, message: 'Error: no se encontró el post en la base de datos.', error: 'post_not_found' };
  }

  console.log(`[Pioneer Action] approve_text: post=${post.id}, content="${post.content?.substring(0, 60)}...", hasImagePrompt=${!!post.image_prompt}`);

  const ctx = {
    postId: post.id,
    planId: post.plan_id,
    sessionId: params.sessionId,
  };

  if (post.image_prompt) {
    return {
      success: true,
      message: '✅ Texto aprobado. ¿Desea generar una imagen para acompañar el post?',
      buttons: [
        { id: 'gen_image', label: '🎨 Generar imagen', type: 'action', style: 'primary', action: 'generate_image' },
        { id: 'skip_image', label: '⭕ Sin imagen, publicar', type: 'action', style: 'ghost', action: 'publish_no_image' },
      ],
      actionContext: ctx,
    };
  }

  return {
    success: true,
    message: '✅ Texto aprobado.',
    buttons: [
      { id: 'publish_now', label: '👍 Publicar', type: 'action', style: 'primary', action: 'publish_no_image' },
    ],
    actionContext: ctx,
  };
}

// === GENERATE IMAGE ===
// Lee image_prompt de DB. Genera con Replicate. Guarda URL en DB.

async function handleGenerateImage(params: ActionRequest['params']): Promise<ActionResponse> {
  const post = await resolvePost(params);

  if (!post || !post.image_prompt) {
    return { success: false, message: 'Error: no hay prompt de imagen.', error: 'missing_prompt' };
  }

  const model = (post.image_model as 'schnell' | 'pro') || 'schnell';
  const aspect_ratio = (post.image_aspect_ratio as '1:1' | '16:9' | '21:9' | '2:3' | '3:2' | '4:5' | '5:4' | '9:16' | '9:21') || '1:1';

  try {
    const result = await generateImage({
      prompt: post.image_prompt,
      model,
      aspect_ratio,
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

    // Guardar URL en DB
    try {
      await updatePost(post.id, { image_url: imageUrl, status: 'image_ready' });
      console.log(`[Pioneer DB] Post ${post.id} actualizado con image_url`);
    } catch (dbErr) {
      console.error('[Pioneer DB] Error actualizando image_url:', dbErr);
    }

    const imageUrlsText = result.images.map(url => `![Imagen generada](${url})`).join('\n\n');

    return {
      success: true,
      message: `🖼️ Imagen generada:\n\n${imageUrlsText}\n\n¿Le gusta?`,
      buttons: [
        { id: 'approve_image', label: '👍 Aprobar y programar', type: 'action', style: 'primary', action: 'approve_and_publish' },
        { id: 'regenerate', label: '🔄 Otra imagen', type: 'action', style: 'secondary', action: 'regenerate_image' },
        { id: 'skip_image', label: '⭕ Sin imagen', type: 'action', style: 'ghost', action: 'publish_no_image' },
      ],
      actionContext: {
        postId: post.id,
        planId: post.plan_id,
        sessionId: params.sessionId,
        // imageUrls para el siguiente paso (approve_and_publish lee image_url de DB como fallback)
        imageUrls: result.images,
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

// === APPROVE AND PUBLISH ===
// Lee CONTENT de DB. Lee IMAGE_URL de DB. Publica. Incrementa counter en DB.
// Bug 5 IMPOSIBLE — content nunca viaja por el frontend.

async function handleApproveAndPublish(params: ActionRequest['params']): Promise<ActionResponse> {
  const post = await resolvePost(params);

  if (!post || !post.content) {
    console.error(`[Pioneer Action] approve_and_publish FAILED: post no encontrado o sin content. postId=${params.postId}, planId=${params.planId}, sessionId=${params.sessionId}`);
    return { success: false, message: 'Error: no hay contenido para publicar.', error: 'missing_content' };
  }

  const content = post.content;
  // imageUrls: primero de params (viene de generate_image en el mismo flujo), luego de DB
  const imageUrls = (params.imageUrls && params.imageUrls.length > 0)
    ? params.imageUrls
    : (post.image_url ? [post.image_url] : []);

  console.log(`[Pioneer Action] approve_and_publish: post=${post.id}, order=${post.order_num}, content="${content.substring(0, 80)}...", images=${imageUrls.length}`);

  // --- Resolver plataformas (siempre de Late.dev API) ---
  let resolvedPlatforms: Array<{ platform: string; account_id: string }>;
  try {
    const accountsResult = await listAccounts();
    if (accountsResult.accounts.length === 0) {
      return { success: false, message: 'No hay cuentas de redes sociales conectadas.', error: 'no_accounts' };
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

  // --- Crear draft ---
  const draftInput = {
    content,
    platforms: resolvedPlatforms,
    media_urls: imageUrls.length > 0 ? imageUrls : undefined,
  };

  const validation = await validateAndPrepareDraft(draftInput, imageUrls.length > 0);
  if (!validation.success || !validation.data) {
    return { success: false, message: `Error validando post: ${validation.error}`, error: 'validation_error' };
  }

  let draftId: string;
  try {
    const draftResult = await createDraftWithRetry(validation.data);
    if (draftResult.duplicate) {
      return { success: false, message: 'Este contenido ya fue publicado en las últimas 24 horas.', error: 'duplicate' };
    }
    draftId = draftResult.post._id;
    console.log(`[Pioneer Action] Draft creado: ${draftId}`);
  } catch (err) {
    const msg = err instanceof LateApiError
      ? `Error de Late.dev (HTTP ${err.status}): ${err.body}`
      : err instanceof Error ? err.message : 'Error desconocido';
    return { success: false, message: `Error creando borrador: ${msg}`, error: 'draft_error' };
  }

  // --- Activar draft via Queue ---
  const PIONEER_PROFILE_ID = '6984c371b984889d86a8b3d6';
  const activateData: Record<string, unknown> = {};

  if (params.publishNow) {
    activateData.publishNow = true;
  } else if (params.scheduledFor) {
    activateData.scheduledFor = params.scheduledFor;
    activateData.timezone = PR_TIMEZONE;
  } else {
    activateData.queuedFromProfile = PIONEER_PROFILE_ID;
  }

  try {
    await activateDraftWithRetry(draftId, activateData);

    const timeLabel = activateData.publishNow
      ? 'publicado ahora'
      : activateData.scheduledFor
        ? `programado para ${formatScheduledTime(activateData.scheduledFor as string)}`
        : 'agregado a la cola de publicación';

    // --- DB: marcar post como scheduled + incrementar counter ---
    const planId = post.plan_id;
    let postCount: number | null = null;
    let postsPublished: number | null = null;
    let planComplete = false;

    try {
      await markPostScheduled(post.id, draftId);
      console.log(`[Pioneer DB] Post ${post.id} marcado como scheduled`);
    } catch (dbErr) {
      console.error('[Pioneer DB] Error marcando post:', dbErr);
    }

    try {
      const updatedPlan = await incrementPostsPublished(planId);
      postCount = updatedPlan.post_count;
      postsPublished = updatedPlan.posts_published;
      planComplete = updatedPlan.status === 'completed';
      console.log(`[Pioneer DB] Plan counter: ${postsPublished}/${postCount} (complete: ${planComplete})`);
    } catch (dbErr) {
      console.error('[Pioneer DB] Error incrementando counter:', dbErr);
      try {
        const progress = await getPlanProgress(planId);
        if (progress) {
          postCount = progress.postCount;
          postsPublished = progress.postsPublished;
          planComplete = progress.isComplete;
        }
      } catch { /* ignore */ }
    }

    console.log(`[Pioneer Action] ✅ Post ${timeLabel} (draft: ${draftId}) [${postsPublished ?? '?'}/${postCount ?? '?'}]`);

    return {
      success: true,
      message: planComplete
        ? `✅ Post ${timeLabel} en ${resolvedPlatforms.map(p => p.platform).join(', ')}.\n\n🎉 ¡Plan completado! Se publicaron los ${postCount} posts del plan.`
        : `✅ Post ${timeLabel} en ${resolvedPlatforms.map(p => p.platform).join(', ')}. (${postsPublished}/${postCount ?? '?'})`,
      buttons: planComplete ? buildPlanCompleteButtons() : buildNextPostButtons(),
      actionContext: {
        planId,
        sessionId: params.sessionId,
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
    if (!match) return isoString;
    const [, yearStr, monthStr, dayStr, hourStr, minuteStr] = match;
    const prToUtcOffset = 4;
    const utcDate = new Date(Date.UTC(
      parseInt(yearStr), parseInt(monthStr) - 1, parseInt(dayStr),
      parseInt(hourStr) + prToUtcOffset, parseInt(minuteStr)
    ));
    return utcDate.toLocaleString('es-PR', {
      weekday: 'long', day: 'numeric', month: 'long',
      hour: 'numeric', minute: '2-digit', hour12: true,
      timeZone: PR_TIMEZONE,
    });
  } catch {
    return isoString;
  }
}
