// action-handler.ts — Fase 5: Pipeline 100% determinístico
//
// Claude = pensar, analizar, diseñar
// Action-handler = ejecutar TODO
//
// ACCIONES:
// 1. approve_plan    → parsear plan de Claude, setup_queue, crear plan+posts en DB
// 2. next_post       → generar texto via Claude API aislado, guardar en DB, mostrar
// 3. approve_text    → mostrar opciones de imagen
// 4. generate_image  → Replicate genera, guarda URL en DB
// 5. approve_and_publish → create_draft + activate + incrementar counter
// 6. publish_no_image    → igual sin media
// 7. regenerate_image    → nueva imagen con spec de DB

import Anthropic from '@anthropic-ai/sdk';
import {
  validateAndPrepareDraft,
  createDraftWithRetry,
  activateDraftWithRetry,
} from '@/lib/publish-validator';
import { listAccounts, setupQueueSlots, LateApiError, PR_TIMEZONE } from '@/lib/late-client';
import { generateImage } from '@/lib/replicate-client';
import {
  getPost,
  updatePost,
  getActivePlan,
  getPlan,
  getPostsByPlan,
  createPlan,
  createPost,
  incrementPostsPublished,
  markPostScheduled,
  getPlanProgress,
  updateSession,
  getSession,
} from '@/lib/db';
import type { ButtonConfig } from './button-detector';
import { sendPlanCompleteEmail } from '@/lib/brevo-client';

// === TIPOS ===

export interface ActionRequest {
  action: string;
  params: {
    postId?: string;
    planId?: string;
    sessionId?: string;
    imageUrls?: string[];
    scheduledFor?: string;
    publishNow?: boolean;
    // Para approve_plan: el texto completo de Claude con el plan
    planText?: string;
    // Para approve_plan: historial de mensajes para contexto
    conversationContext?: string;
  };
}

export interface ActionResponse {
  success: boolean;
  message: string;
  buttons?: ButtonConfig[];
  actionContext?: Record<string, unknown>;
  error?: string;
}

const PIONEER_PROFILE_ID = '6984c371b984889d86a8b3d6';

// === DISPATCHER ===

export async function handleAction(req: ActionRequest): Promise<ActionResponse> {
  console.log(`[Pioneer Action] Ejecutando: ${req.action} (postId: ${req.params.postId || 'none'}, planId: ${req.params.planId || 'none'}, sessionId: ${req.params.sessionId || 'none'})`);

  switch (req.action) {
    case 'approve_plan':
      return handleApprovePlan(req.params);
    case 'next_post':
      return handleNextPost(req.params);
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
      return { success: false, message: `Acción no reconocida: ${req.action}`, error: `unknown_action: ${req.action}` };
  }
}

// ═══════════════════════════════════════════════════════
// APPROVE PLAN — Parsear plan, setup queue, crear DB
// ═══════════════════════════════════════════════════════

async function handleApprovePlan(params: ActionRequest['params']): Promise<ActionResponse> {
  if (!params.sessionId) {
    return { success: false, message: 'Error: no hay sesión activa.', error: 'no_session' };
  }

  if (!params.planText) {
    return { success: false, message: 'Error: no se encontró el plan.', error: 'no_plan_text' };
  }

  try {
    // 1. Llamar Claude API aislado para extraer datos estructurados del plan
    console.log(`[Pioneer Action] approve_plan: Extrayendo datos del plan con Claude API...`);
    const planData = await extractPlanData(params.planText);
    console.log(`[Pioneer Action] Plan extraído: ${planData.posts.length} posts`);

    // 2. Calculate optimal slots based on post count
    const optimalSlots = calculateOptimalSlots(planData.posts.length);

    // 3. Setup queue en Late.dev
    await setupQueueSlots(PIONEER_PROFILE_ID, PR_TIMEZONE, optimalSlots, true);
    console.log(`[Pioneer Action] Queue configurado: ${optimalSlots.length} slots`);

    // 4. Calculate real publish dates for each post
    const postSchedule = await calculatePostSchedule(planData.posts, optimalSlots);
    console.log(`[Pioneer Action] Fechas calculadas: ${postSchedule.map(s => s.date).join(', ')}`);

    // 5. Crear plan en DB
    const dbPlan = await createPlan(params.sessionId, {
      plan_name: planData.plan_name,
      description: planData.description,
      post_count: planData.posts.length,
      queue_slots: optimalSlots,
    });
    console.log(`[Pioneer DB] Plan creado: ${dbPlan.id} (${planData.posts.length} posts)`);

    // 6. Crear todos los posts en DB con status 'pending' y scheduled_for
    for (let i = 0; i < planData.posts.length; i++) {
      const postInfo = planData.posts[i];
      const schedule = postSchedule[i];
      await createPost(dbPlan.id, {
        order_num: i + 1,
        title: postInfo.title,
        content: '',
        scheduled_for: schedule?.date || undefined,
      });
    }
    console.log(`[Pioneer DB] ${planData.posts.length} posts creados en DB (pending)`);

    // 7. Extraer y guardar business_info de la conversación
    if (params.conversationContext) {
      try {
        await extractAndSaveBusinessInfo(params.sessionId, params.conversationContext);
      } catch (bizErr) {
        console.warn('[Pioneer Action] No se pudo guardar business_info (no-fatal):', bizErr);
      }
    }

    // 8. Guardar estrategia del plan en sessions (determinístico)
    try {
      const strategyDesc = planData.description || '';
      if (strategyDesc) {
        await updateSession(params.sessionId, {
          strategies: [strategyDesc],
        });
        console.log(`[Pioneer DB] Estrategia guardada: "${strategyDesc.substring(0, 100)}..."`);
      }
    } catch (stratErr) {
      console.warn('[Pioneer Action] No se pudo guardar estrategia (no-fatal):', stratErr);
    }

    // 9. Build schedule description for client
    const scheduleDesc = postSchedule.map((s, i) => {
      const postTitle = planData.posts[i]?.title || `Post ${i + 1}`;
      return `${i + 1}. ${postTitle} — ${s.displayDate}`;
    }).join('\n');

    return {
      success: true,
      message: `✅ ¡Plan aprobado! ${planData.posts.length} posts programados.\n\n📅 Calendario de publicación:\n${scheduleDesc}\n\n¿Listo para crear el primer post?`,
      buttons: [
        { id: 'first_post', label: '▶️ Crear primer post', type: 'action', style: 'primary', action: 'next_post' },
      ],
      actionContext: {
        planId: dbPlan.id,
        sessionId: params.sessionId,
      },
    };
  } catch (err) {
    console.error(`[Pioneer Action] Error en approve_plan:`, err);
    const msg = err instanceof LateApiError
      ? `Error de Late.dev (HTTP ${err.status}): ${err.body}`
      : err instanceof Error ? err.message : 'Error desconocido';
    return { success: false, message: `Error configurando el plan: ${msg}`, error: 'plan_error' };
  }
}

// ═══════════════════════════════════════════════════════
// NEXT POST — Generar texto via Claude API aislado
// ═══════════════════════════════════════════════════════

async function handleNextPost(params: ActionRequest['params']): Promise<ActionResponse> {
  // Resolver plan
  let planId = params.planId;
  if (!planId && params.sessionId) {
    const plan = await getActivePlan(params.sessionId);
    if (plan) planId = plan.id;
  }

  if (!planId) {
    return { success: false, message: 'Error: no hay plan activo.', error: 'no_plan' };
  }

  // Buscar el siguiente post pendiente (sin content)
  const posts = await getPostsByPlan(planId);
  const nextPost = posts.find(p => !p.content || p.content === '');

  if (!nextPost) {
    return {
      success: true,
      message: '🎉 ¡Todos los posts del plan ya tienen contenido!',
      buttons: [],
    };
  }

  // Leer contexto del plan y negocio para la llamada Claude
  const plan = await getActivePlan(params.sessionId || '');
  const postNum = nextPost.order_num;
  const totalPosts = posts.length;

  console.log(`[Pioneer Action] next_post: Generando post ${postNum}/${totalPosts} (title: "${nextPost.title || 'sin título'}")`);

  // Enriquecer contexto con business_info de DB (si existe)
  let enrichedContext = params.conversationContext || '';
  if (params.sessionId) {
    try {
      const session = await getSession(params.sessionId);
      if (session && session.business_info && Object.keys(session.business_info).length > 0) {
        const bizInfo = Object.entries(session.business_info)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n');
        // Import contact info helper
        const { getContactInfo } = await import('@/lib/system-prompt');
        const contactRules = getContactInfo(session.business_info as Record<string, unknown>);
        enrichedContext = `=== DATOS DEL NEGOCIO (base de datos) ===\n${bizInfo}\n\n=== REGLAS DE CONTACTO ===\n${contactRules}\n\n${enrichedContext}`;
        console.log(`[Pioneer Action] Business context inyectado desde DB (${bizInfo.length} chars)`);
      }
    } catch (dbErr) {
      console.warn('[Pioneer Action] No se pudo leer business_info de DB:', dbErr);
    }
  }

  try {
    // Llamada Claude API aislada para generar contenido
    const result = await generatePostContent({
      postTitle: nextPost.title || `Post #${postNum}`,
      postNumber: postNum,
      totalPosts,
      conversationContext: enrichedContext,
    });

    // Guardar en DB
    await updatePost(nextPost.id, {
      content: result.text,
      image_prompt: result.imagePrompt,
      image_model: 'schnell',
      image_aspect_ratio: '1:1',
      status: 'content_ready',
    });
    console.log(`[Pioneer DB] Post ${nextPost.id} actualizado con content (${result.text.length} chars) + imagePrompt: ${!!result.imagePrompt}`);

    return {
      success: true,
      message: `**Post #${postNum} — ${nextPost.title || ''}:**\n\n---\n\n${result.text}\n\n---\n\n¿Le gusta este texto o prefiere algún cambio?`,
      buttons: [
        { id: 'approve_text', label: '✅ Me gusta', type: 'action', style: 'primary', action: 'approve_text' },
        { id: 'change_text', label: '✏️ Pedir cambios', type: 'option', style: 'ghost', chatMessage: '' },
      ],
      actionContext: {
        postId: nextPost.id,
        planId,
        sessionId: params.sessionId,
      },
    };
  } catch (err) {
    console.error(`[Pioneer Action] Error generando post:`, err);
    return { success: false, message: `Error generando el post: ${err instanceof Error ? err.message : 'Error desconocido'}`, error: 'content_error' };
  }
}

// ═══════════════════════════════════════════════════════
// APPROVE TEXT — Mostrar opciones de imagen
// ═══════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════
// GENERATE IMAGE
// ═══════════════════════════════════════════════════════

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
      return { success: false, message: `Error generando imagen: ${result.error || 'Sin resultado'}`, error: 'image_error' };
    }

    const imageUrl = result.images[0];

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
        imageUrls: result.images,
      },
    };
  } catch (err) {
    return { success: false, message: `Error generando imagen: ${err instanceof Error ? err.message : 'Error desconocido'}`, error: 'image_error' };
  }
}

// ═══════════════════════════════════════════════════════
// APPROVE AND PUBLISH
// ═══════════════════════════════════════════════════════

async function handleApproveAndPublish(params: ActionRequest['params']): Promise<ActionResponse> {
  const post = await resolvePost(params);

  if (!post || !post.content) {
    console.error(`[Pioneer Action] approve_and_publish FAILED: no post/content. postId=${params.postId}, planId=${params.planId}`);
    return { success: false, message: 'Error: no hay contenido para publicar.', error: 'missing_content' };
  }

  const content = post.content;
  const imageUrls = (params.imageUrls && params.imageUrls.length > 0)
    ? params.imageUrls
    : (post.image_url ? [post.image_url] : []);

  console.log(`[Pioneer Action] approve_and_publish: post=${post.id}, order=${post.order_num}, content="${content.substring(0, 80)}...", images=${imageUrls.length}`);

  // Plataformas de Late.dev API
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
    return { success: false, message: `Error verificando cuentas: ${err instanceof Error ? err.message : 'Error desconocido'}`, error: 'accounts_error' };
  }

  // Crear draft
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

  // Activar via Queue or scheduledFor
  const activateData: Record<string, unknown> = {};
  if (params.publishNow) {
    activateData.publishNow = true;
  } else if (params.scheduledFor) {
    activateData.scheduledFor = params.scheduledFor;
    activateData.timezone = PR_TIMEZONE;
  } else if (post.scheduled_for) {
    // Use pre-calculated date from plan approval
    activateData.scheduledFor = post.scheduled_for;
    activateData.timezone = PR_TIMEZONE;
  } else {
    activateData.queuedFromProfile = PIONEER_PROFILE_ID;
  }

  try {
    const activateResult = await activateDraftWithRetry(draftId, activateData);

    // Save the activated post ID (may differ from draft ID)
    const activatedPostId = activateResult.post?._id || draftId;

    const timeLabel = activateData.publishNow
      ? 'publicado ahora'
      : activateData.scheduledFor
        ? `programado`
        : 'agregado a la cola de publicación';

    // DB: marcar post + incrementar counter
    const planId = post.plan_id;
    let postCount: number | null = null;
    let postsPublished: number | null = null;
    let planComplete = false;

    try {
      await markPostScheduled(post.id, draftId);
      // Also save the activated post ID for analytics correlation
      if (activatedPostId && activatedPostId !== draftId) {
        await updatePost(post.id, { late_post_id: activatedPostId });
        console.log(`[Pioneer DB] late_post_id guardado: ${activatedPostId} (draft: ${draftId})`);
      } else {
        // Same ID — save it as late_post_id too for metrics sync
        await updatePost(post.id, { late_post_id: draftId });
      }
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

    const platformNames = resolvedPlatforms.map(p => p.platform).join(', ');

    // Build completion summary for the last post
    let completionSummary = '';
    if (planComplete && planId) {
      try {
        const allPosts = await getPostsByPlan(planId);
        const plan = await getPlan(planId);
        const publishedTitles = allPosts
          .filter(p => p.status === 'scheduled')
          .sort((a, b) => a.order_num - b.order_num)
          .map((p, i) => `${i + 1}. ${p.title || `Post #${p.order_num}`}`)
          .join('\n');

        completionSummary = `\n\n📋 **Resumen del plan "${plan?.plan_name || 'completado'}":**\n${publishedTitles}\n\n📱 Plataformas: ${platformNames}\n\n¿Qué le gustaría hacer ahora?`;

        // Send plan completion email if client has email
        if (params.sessionId) {
          try {
            const session = await getSession(params.sessionId);
            if (session?.email) {
              await sendPlanCompleteEmail(
                session.business_name || 'Su negocio',
                session.email,
                plan?.plan_name || 'Campaña completada',
                postCount || allPosts.length
              );
              console.log(`[Pioneer] Plan completion email sent to ${session.email}`);
            }
          } catch (emailErr) {
            console.warn('[Pioneer] Could not send plan completion email:', emailErr);
          }
        }
      } catch {
        completionSummary = '\n\n¿Qué le gustaría hacer ahora?';
      }
    }

    return {
      success: true,
      message: planComplete
        ? `✅ Post ${timeLabel} en ${platformNames}.\n\n🎉 ¡Plan completado! Se publicaron los ${postCount} posts del plan.${completionSummary}`
        : `✅ Post ${timeLabel} en ${platformNames}. (${postsPublished}/${postCount ?? '?'})`,
      buttons: planComplete
        ? [
            { id: 'more_posts', label: '➕ Crear más posts', type: 'option', style: 'secondary', chatMessage: 'Quiero crear más posts adicionales' },
            { id: 'done', label: '✅ Listo, terminamos', type: 'option', style: 'primary', chatMessage: 'Listo, terminamos por ahora' },
          ]
        : [
            { id: 'next_post', label: '▶️ Siguiente post', type: 'action', style: 'primary', action: 'next_post' },
            { id: 'pause', label: '⏸️ Terminar por hoy', type: 'option', style: 'ghost', chatMessage: 'Pausar el plan por ahora' },
          ],
      actionContext: {
        planId,
        sessionId: params.sessionId,
      },
    };
  } catch (err) {
    const msg = err instanceof LateApiError
      ? `Error de Late.dev (HTTP ${err.status}): ${err.body}`
      : err instanceof Error ? err.message : 'Error desconocido';
    return { success: false, message: `El borrador se creó pero no se pudo publicar: ${msg}`, error: 'activate_error' };
  }
}

// ═══════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════

// --- Resolver post de DB ---
async function resolvePost(params: ActionRequest['params']) {
  if (params.postId) {
    const post = await getPost(params.postId);
    if (post) {
      console.log(`[Pioneer Action] Post resuelto: ${post.id} (order: ${post.order_num}, status: ${post.status})`);
      return post;
    }
  }

  if (params.planId) {
    const posts = await getPostsByPlan(params.planId);
    const pending = posts.filter(p => p.content && ['content_ready', 'image_ready'].includes(p.status));
    if (pending.length > 0) {
      const post = pending[pending.length - 1];
      console.log(`[Pioneer Action] Post resuelto por planId: ${post.id} (order: ${post.order_num})`);
      return post;
    }
  }

  if (params.sessionId) {
    const plan = await getActivePlan(params.sessionId);
    if (plan) {
      const posts = await getPostsByPlan(plan.id);
      const pending = posts.filter(p => p.content && ['content_ready', 'image_ready'].includes(p.status));
      if (pending.length > 0) {
        const post = pending[pending.length - 1];
        console.log(`[Pioneer Action] Post resuelto por sessionId: ${post.id} (order: ${post.order_num})`);
        return post;
      }
    }
  }

  console.error(`[Pioneer Action] No se pudo resolver post. postId=${params.postId}, planId=${params.planId}, sessionId=${params.sessionId}`);
  return null;
}

// --- Extraer datos estructurados del plan via Claude API ---
interface PlanData {
  plan_name: string;
  description: string;
  posts: Array<{ title: string; post_type: string; details: string; target_date?: string }>;
}

async function extractPlanData(planText: string): Promise<PlanData> {
  const anthropic = new Anthropic();

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1000,
    system: `Extract structured data from a marketing plan. Return ONLY valid JSON, no markdown, no explanation.

The JSON must have this exact structure:
{
  "plan_name": "short name of the plan",
  "description": "one sentence description",
  "posts": [{"title": "Post title/theme", "post_type": "offer|educational|testimonial|behind-scenes|urgency|cta|branding|interactive", "details": "what this post should be about", "target_date": "YYYY-MM-DD or null"}, ...]
}

Rules for posts:
- Extract each post in order
- post_type should match the theme
- details should describe what the post is about
- target_date: If the post is tied to a specific calendar date (e.g., "Día de la Mujer" = March 8), set the target date as YYYY-MM-DD. The post should be published ON or BEFORE this date. If the post has no specific date, set target_date to null.
- Examples: "Campaña Día de la Mujer (8 de marzo)" → target_date: "2026-03-08". "Lanzamiento del negocio" → target_date: null`,
    messages: [{
      role: 'user',
      content: planText,
    }],
  });

  const block = response.content[0];
  if (block.type !== 'text') throw new Error('Claude no devolvió texto');

  // Limpiar JSON (puede venir con ```json ... ```)
  let jsonStr = block.text.trim();
  jsonStr = jsonStr.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

  const parsed = JSON.parse(jsonStr) as PlanData;

  // Validación básica
  if (!parsed.posts || parsed.posts.length === 0) throw new Error('Plan sin posts');

  return parsed;
}

// --- Generar contenido de post via Claude API aislada ---
interface PostContent {
  text: string;
  imagePrompt: string | null;
}

async function generatePostContent(input: {
  postTitle: string;
  postNumber: number;
  totalPosts: number;
  conversationContext: string;
}): Promise<PostContent> {
  const anthropic = new Anthropic();

  // Generar texto del post
  const textResponse = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 500,
    system: `Eres un copywriter profesional de marketing para pequeños negocios en Puerto Rico.
Escribe en español. Tono: profesional pero cercano.

REGLAS DE CALIDAD — OBLIGATORIO:
- Máximo 4-6 líneas de texto real + CTA + hashtags.
- NUNCA listes más de 2-3 items.
- Fórmula: Hook (1 línea) + Beneficio/Info (2-3 líneas) + CTA con contacto (1-2 líneas) + hashtags.
- Escribe el post LISTO PARA PUBLICAR — no incluyas explicación ni título.
- NO incluyas "Post #N" ni "---" ni nada que no sea el post.

⚠️ REGLA CRÍTICA — TÍTULO DEL POST:
- El título del post define el TEMA EXACTO. Respétalo al 100%.
- Si el título dice "Día de la Mujer", escribe sobre el Día de la Mujer. NUNCA lo cambies a "Día de la Madre" ni otro evento.
- NUNCA sustituyas un evento/fecha por otro diferente.

⚠️ REGLA CRÍTICA — DATOS DE CONTACTO:
- SOLO usa datos de contacto que aparecen en "REGLAS DE CONTACTO" del contexto.
- Si dice "Teléfono: NO DISPONIBLE" → NO menciones teléfono. NO inventes número. NO escribas "787-[tu número]" ni ningún placeholder.
- Si dice "Email: NO USAR en posts" → NO incluyas ese email en el post. Es el email personal del dueño.
- Si dice "Email: NO DISPONIBLE" → NO menciones email.
- Si NO hay teléfono NI email de negocio disponible, usa solo ubicación y nombre del negocio como contacto.
- NUNCA inventes testimonios, marcas, precios, o datos no proporcionados.
- NUNCA uses placeholders como [dirección], [teléfono], [tu número].`,
    messages: [{
      role: 'user',
      content: `Contexto del negocio y plan:\n${input.conversationContext}\n\nGenera el Post #${input.postNumber} de ${input.totalPosts}: "${input.postTitle}"\n\nEscribe SOLO el texto del post, listo para publicar.`,
    }],
  });

  const textBlock = textResponse.content[0];
  if (textBlock.type !== 'text') throw new Error('Claude no devolvió texto');
  const text = textBlock.text.trim();

  // Generar image prompt
  let imagePrompt: string | null = null;
  try {
    const imgResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 200,
      system: `You generate image prompts for FLUX (Replicate) to create social media marketing images.
Rules:
- Output ONLY the prompt, nothing else. No quotes, no explanation.
- Always in English.
- Always end with "no text overlay" (FLUX is bad at text).
- Style: professional, vibrant, high quality, social media ready.
- Keep it under 100 words.`,
      messages: [{
        role: 'user',
        content: `Generate an image prompt for this social media post:\n\n${text}`,
      }],
    });

    const imgBlock = imgResponse.content[0];
    if (imgBlock.type === 'text') {
      imagePrompt = imgBlock.text.trim();
      console.log(`[Pioneer Action] Image prompt: "${imagePrompt.substring(0, 60)}..."`);
    }
  } catch (err) {
    console.warn(`[Pioneer Action] No se pudo generar image prompt:`, err);
  }

  return { text, imagePrompt };
}

// --- Extraer business_info de la conversación y guardar en DB ---
async function extractAndSaveBusinessInfo(sessionId: string, conversationContext: string): Promise<void> {
  const anthropic = new Anthropic();

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 500,
    system: `You extract structured data from conversations. You ONLY output valid JSON. No preamble, no "Entendido", no explanation, no markdown. Just the JSON object.

Extract business information and marketing strategies from this conversation:
{
  "business_name": "name of the business",
  "business_type": "type/industry",
  "location": "city, area, or address",
  "phone": "phone number",
  "hours": "business hours",
  "email": "business email if mentioned",
  "years_in_business": "how long they've been operating",
  "how_clients_arrive": "how customers find them",
  "goal": "what they want to achieve with marketing",
  "differentiator": "what makes them unique or what clients value most",
  "has_done_marketing": "yes/no and what type",
  "current_promotion": "any active promotions",
  "services": "main services offered",
  "target_audience": "who their customers are",
  "additional_info": "any other relevant details"
}

Rules:
- Output ONLY the JSON object, nothing else
- Omit business fields not mentioned in the conversation`,
    messages: [
      {
        role: 'user',
        content: `Here is a transcript of a conversation between a marketing agent (Pioneer) and a client. Extract the business data as JSON.\n\n${conversationContext}`,
      },
      {
        role: 'assistant',
        content: '{',
      },
    ],
  });

  const block = response.content[0];
  if (block.type !== 'text') return;

  // Prefill started with '{', so prepend it back
  let jsonStr = '{' + block.text.trim();
  jsonStr = jsonStr.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

  let businessInfo;
  try {
    businessInfo = JSON.parse(jsonStr);
  } catch {
    // Fallback: Claude respondió con texto + JSON adentro — extraer el objeto
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(`[Pioneer Action] No se encontró JSON en respuesta de Claude: ${jsonStr.substring(0, 100)}...`);
      return;
    }
    businessInfo = JSON.parse(jsonMatch[0]);
  }

  // MERGE: leer business_info existente (del onboarding form) y combinar
  // Los datos del form tienen prioridad para campos como phone, hours que
  // el usuario llenó explícitamente. Claude solo agrega campos nuevos.
  let mergedInfo = businessInfo;
  try {
    const existingSession = await getSession(sessionId);
    if (existingSession?.business_info && typeof existingSession.business_info === 'object') {
      const existing = existingSession.business_info as Record<string, unknown>;
      // Start with Claude's extracted data, then overlay existing non-null values
      // This preserves form data (phone, hours) while adding conversation insights
      mergedInfo = { ...businessInfo };
      for (const [key, value] of Object.entries(existing)) {
        if (value !== null && value !== undefined && value !== '') {
          // Keep existing value if Claude didn't extract anything meaningful for this field
          if (!mergedInfo[key] || mergedInfo[key] === null || mergedInfo[key] === '') {
            mergedInfo[key] = value;
          }
          // For phone and hours specifically, ALWAYS prefer form data (user typed it)
          if ((key === 'phone' || key === 'hours') && value) {
            mergedInfo[key] = value;
          }
        }
      }
      // Preserve source marker
      if (existing.source === 'onboarding_form') {
        mergedInfo.source = 'onboarding_form+conversation';
      }
      console.log(`[Pioneer DB] Merged business_info (form + conversation) for session ${sessionId}`);
    }
  } catch (mergeErr) {
    console.warn('[Pioneer Action] Could not merge business_info, using extracted only:', mergeErr);
  }

  await updateSession(sessionId, {
    business_name: mergedInfo.business_name || null,
    business_info: mergedInfo,
    email: mergedInfo.email || null,
    status: 'active',
  });

  console.log(`[Pioneer DB] Business info guardado para session ${sessionId}: ${JSON.stringify(mergedInfo).substring(0, 200)}...`);
}

// --- Convert 24h time to 12h AM/PM for client display ---
function formatTime12h(time24: string): string {
  const [hourStr, minute] = time24.split(':');
  const hour = parseInt(hourStr, 10);
  if (isNaN(hour)) return time24;
  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${hour12}:${minute} ${period}`;
}

// --- Calculate optimal queue slots based on post count ---
function calculateOptimalSlots(postCount: number): Array<{ dayOfWeek: number; time: string }> {
  // Optimal posting times for PR (America/Puerto_Rico)
  const allSlots = [
    { dayOfWeek: 1, time: '19:00' }, // Lunes 7PM
    { dayOfWeek: 3, time: '12:00' }, // Miércoles 12PM
    { dayOfWeek: 5, time: '19:00' }, // Viernes 7PM
    { dayOfWeek: 0, time: '13:00' }, // Domingo 1PM
    { dayOfWeek: 2, time: '19:00' }, // Martes 7PM
    { dayOfWeek: 4, time: '12:00' }, // Jueves 12PM
    { dayOfWeek: 6, time: '10:00' }, // Sábado 10AM
  ];

  // Use enough slots to cover posts without spreading too thin
  // 1-3 posts → 2 slots/week, 4-7 → 3 slots, 8+ → 4 slots
  const slotsNeeded = postCount <= 3 ? 2 : postCount <= 7 ? 3 : 4;
  return allSlots.slice(0, Math.min(slotsNeeded, allSlots.length));
}

// --- Calculate real publish dates for each post ---
interface PostScheduleEntry {
  date: string;       // ISO date for scheduledFor
  displayDate: string; // Human-readable for client
}

async function calculatePostSchedule(
  posts: Array<{ title: string; target_date?: string }>,
  slots: Array<{ dayOfWeek: number; time: string }>
): Promise<PostScheduleEntry[]> {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Puerto_Rico' }));
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  // Separate seasonal (has target_date) and normal posts
  const schedule: PostScheduleEntry[] = new Array(posts.length);
  const usedDates = new Set<string>(); // Track dates to avoid double-posting

  // First pass: assign seasonal posts to their target dates or closest slot before
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    if (post.target_date) {
      const targetDate = new Date(post.target_date + 'T00:00:00');
      // Find the closest slot on or before the target date
      const slotDate = findClosestSlotOnOrBefore(targetDate, slots, today, usedDates);
      if (slotDate) {
        const dateKey = slotDate.toISOString().split('T')[0];
        usedDates.add(dateKey);
        schedule[i] = formatScheduleEntry(slotDate);
      }
    }
  }

  // Second pass: assign normal posts to next available slots
  let nextSlotDate = getNextSlotDate(today, slots, usedDates);
  for (let i = 0; i < posts.length; i++) {
    if (schedule[i]) continue; // Already assigned (seasonal)

    // Find next available slot that's not taken
    while (nextSlotDate && usedDates.has(nextSlotDate.toISOString().split('T')[0])) {
      nextSlotDate = getNextSlotDate(nextSlotDate, slots, usedDates, true);
    }

    if (nextSlotDate) {
      const dateKey = nextSlotDate.toISOString().split('T')[0];
      usedDates.add(dateKey);
      schedule[i] = formatScheduleEntry(nextSlotDate);
      nextSlotDate = getNextSlotDate(nextSlotDate, slots, usedDates, true);
    } else {
      // Fallback: just use tomorrow
      const fallback = new Date(today);
      fallback.setDate(fallback.getDate() + i + 1);
      schedule[i] = formatScheduleEntry(fallback);
    }
  }

  return schedule;
}

function findClosestSlotOnOrBefore(
  targetDate: Date,
  slots: Array<{ dayOfWeek: number; time: string }>,
  today: Date,
  usedDates: Set<string>
): Date | null {
  // Try the target date first, then go backwards to find a slot day
  for (let daysBack = 0; daysBack <= 14; daysBack++) {
    const candidateDate = new Date(targetDate);
    candidateDate.setDate(candidateDate.getDate() - daysBack);

    if (candidateDate < today) break; // Don't go before today

    const dayOfWeek = candidateDate.getDay();
    const matchingSlot = slots.find(s => s.dayOfWeek === dayOfWeek);

    if (matchingSlot) {
      const dateKey = candidateDate.toISOString().split('T')[0];
      if (!usedDates.has(dateKey)) {
        // Set the time from the slot
        const [hour, minute] = matchingSlot.time.split(':');
        candidateDate.setHours(parseInt(hour, 10), parseInt(minute, 10), 0, 0);
        return candidateDate;
      }
    }
  }

  // If no slot found before target, use the target date itself at a default time
  if (targetDate >= today) {
    const dateKey = targetDate.toISOString().split('T')[0];
    if (!usedDates.has(dateKey)) {
      targetDate.setHours(10, 0, 0, 0);
      return targetDate;
    }
  }

  return null;
}

function getNextSlotDate(
  fromDate: Date,
  slots: Array<{ dayOfWeek: number; time: string }>,
  usedDates: Set<string>,
  skipCurrentDay = false
): Date | null {
  const startOffset = skipCurrentDay ? 1 : 0;

  // Look up to 30 days ahead
  for (let daysAhead = startOffset; daysAhead <= 30; daysAhead++) {
    const candidateDate = new Date(fromDate);
    candidateDate.setDate(candidateDate.getDate() + daysAhead);

    const dayOfWeek = candidateDate.getDay();
    const matchingSlot = slots.find(s => s.dayOfWeek === dayOfWeek);

    if (matchingSlot) {
      const dateKey = candidateDate.toISOString().split('T')[0];
      if (!usedDates.has(dateKey)) {
        const [hour, minute] = matchingSlot.time.split(':');
        candidateDate.setHours(parseInt(hour, 10), parseInt(minute, 10), 0, 0);
        return candidateDate;
      }
    }
  }
  return null;
}

function formatScheduleEntry(date: Date): PostScheduleEntry {
  const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  const dayName = days[date.getDay()];
  const dayNum = date.getDate();
  const monthName = months[date.getMonth()];
  const hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const period = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;

  return {
    date: date.toISOString(),
    displayDate: `${dayName} ${dayNum} de ${monthName} a las ${hour12}:${minutes} ${period}`,
  };
}
