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

import { getAnthropicClient, MODEL } from '@/lib/anthropic';
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
  getPostsByPlan,
  createPlan,
  createPost,
  incrementPostsPublished,
  markPostScheduled,
  getPlanProgress,
  getSession,
} from '@/lib/db';
import type { ButtonConfig } from './button-detector';

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
    console.log(`[Pioneer Action] Plan extraído: ${planData.posts.length} posts, slots: ${JSON.stringify(planData.slots)}`);

    // 2. Setup queue en Late.dev
    const formattedSlots = planData.slots.map(s => ({
      dayOfWeek: s.day_of_week,
      time: s.time,
    }));

    await setupQueueSlots(PIONEER_PROFILE_ID, PR_TIMEZONE, formattedSlots, true);
    console.log(`[Pioneer Action] Queue configurado: ${formattedSlots.length} slots`);

    // 3. Crear plan en DB
    const dbPlan = await createPlan(params.sessionId, {
      plan_name: planData.plan_name,
      description: planData.description,
      post_count: planData.posts.length,
      queue_slots: formattedSlots,
    });
    console.log(`[Pioneer DB] Plan creado: ${dbPlan.id} (${planData.posts.length} posts)`);

    // 4. Crear todos los posts en DB con status 'pending'
    for (let i = 0; i < planData.posts.length; i++) {
      const postInfo = planData.posts[i];
      await createPost(dbPlan.id, {
        order_num: i + 1,
        title: postInfo.title,
        content: '', // Se llena cuando se genera el texto
      });
    }
    console.log(`[Pioneer DB] ${planData.posts.length} posts creados en DB (pending)`);

    // 5. Calcular próximas fechas para mostrar al cliente
    const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const slotDesc = formattedSlots.map(s => `${days[s.dayOfWeek]} a las ${s.time}`).join(', ');

    return {
      success: true,
      message: `✅ ¡Plan aprobado! ${planData.posts.length} posts programados.\n\n📅 Horarios de publicación: ${slotDesc}\n\n¿Listo para crear el primer post?`,
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

  try {
    // Llamada Claude API aislada para generar contenido
    const result = await generatePostContent({
      postTitle: nextPost.title || `Post #${postNum}`,
      postNumber: postNum,
      totalPosts,
      conversationContext: params.conversationContext || '',
      sessionId: params.sessionId,
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

  // Activar via Queue
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
        ? `programado`
        : 'agregado a la cola de publicación';

    // DB: marcar post + incrementar counter
    const planId = post.plan_id;
    let postCount: number | null = null;
    let postsPublished: number | null = null;
    let planComplete = false;

    try {
      await markPostScheduled(post.id, draftId);
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

    return {
      success: true,
      message: planComplete
        ? `✅ Post ${timeLabel} en ${platformNames}.\n\n🎉 ¡Plan completado! Se publicaron los ${postCount} posts del plan.`
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
  slots: Array<{ day_of_week: number; time: string }>;
  posts: Array<{ title: string; post_type: string; details: string }>;
}

async function extractPlanData(planText: string): Promise<PlanData> {
  const anthropic = getAnthropicClient();

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1000,
    system: `Extract structured data from a marketing plan. Return ONLY valid JSON, no markdown, no explanation.

The JSON must have this exact structure:
{
  "plan_name": "short name of the plan",
  "description": "one sentence description",
  "slots": [{"day_of_week": 1, "time": "12:00"}, ...],
  "posts": [{"title": "Post title/theme", "post_type": "offer|educational|testimonial|behind-scenes|urgency|cta|branding|interactive", "details": "what this post should be about"}, ...]
}

Rules for slots:
- day_of_week: 0=sunday, 1=monday, 2=tuesday, 3=wednesday, 4=thursday, 5=friday, 6=saturday
- Extract the unique day+time combinations from the post schedule
- time format: "HH:MM" in 24h (e.g., "19:00" for 7:00 PM, "12:00" for 12:00 PM)

Rules for posts:
- Extract each post in order
- post_type should match the theme (promotional=offer, educational=educational, brand story=branding, etc.)
- details should describe what the post is about including any specific promotions, topics, or angles mentioned`,
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
  if (!parsed.slots || parsed.slots.length === 0) throw new Error('Plan sin horarios');

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
  sessionId?: string;
}): Promise<PostContent> {
  const anthropic = getAnthropicClient();

  // === BUSINESS CONTEXT FROM DB ===
  // Read business_info and interview_data from session to give the copywriter
  // real data about the business. This prevents placeholder text and invented data.
  let businessContext = '';
  if (input.sessionId) {
    try {
      const session = await getSession(input.sessionId);
      if (session) {
        const info = session.business_info || {};
        const interview = session.interview_data || {};
        const parts: string[] = [];

        if (session.business_name) parts.push(`Negocio: ${session.business_name}`);
        if (info.business_type) parts.push(`Tipo: ${info.business_type}`);
        if (info.location) parts.push(`Ubicación: ${info.location}`);
        if (info.phone) parts.push(`Teléfono: ${info.phone}`);
        if (info.hours) parts.push(`Horario: ${info.hours}`);
        if (info.services) parts.push(`Servicios: ${info.services}`);
        if (info.target_audience) parts.push(`Público objetivo: ${info.target_audience}`);
        if (info.differentiator) parts.push(`Diferenciador: ${info.differentiator}`);
        if (info.goals) parts.push(`Objetivos: ${info.goals}`);

        // Include raw interview Q&A if available
        if (Object.keys(interview).length > 0) {
          parts.push(`\nDatos de la entrevista:\n${JSON.stringify(interview, null, 2)}`);
        }

        if (session.strategies && session.strategies.length > 0) {
          parts.push(`Estrategias seleccionadas: ${session.strategies.join(', ')}`);
        }

        if (parts.length > 0) {
          businessContext = parts.join('\n');
          console.log(`[Pioneer Action] Business context loaded from DB (${businessContext.length} chars)`);
        }
      }
    } catch (err) {
      console.warn('[Pioneer Action] Could not load business context from DB:', err);
    }
  }

  // Combine DB business context with conversation context as fallback
  const fullContext = businessContext
    ? `=== DATOS DEL NEGOCIO (fuente: base de datos) ===\n${businessContext}\n\n=== CONTEXTO ADICIONAL ===\n${input.conversationContext}`
    : input.conversationContext;

  // Generar texto del post
  const textResponse = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 500,
    system: `Eres un copywriter profesional de marketing para pequeños negocios en Puerto Rico.
Escribe en español. Tono: profesional pero cercano.

REGLAS DE CALIDAD — OBLIGATORIO:
- Máximo 4-6 líneas de texto real + CTA + hashtags.
- NUNCA listes más de 2-3 items.
- Fórmula: Hook (1 línea) + Beneficio/Info (2-3 líneas) + CTA con contacto (1-2 líneas) + hashtags.
- Incluye datos de contacto REALES si están en el contexto.
- NUNCA inventes testimonios, marcas, precios, o datos no proporcionados.
- NUNCA uses placeholders como [dirección] o [teléfono].
- Escribe el post LISTO PARA PUBLICAR — no incluyas explicación ni título.
- NO incluyas "Post #N" ni "---" ni nada que no sea el post.`,
    messages: [{
      role: 'user',
      content: `Contexto del negocio y plan:\n${fullContext}\n\nGenera el Post #${input.postNumber} de ${input.totalPosts}: "${input.postTitle}"\n\nEscribe SOLO el texto del post, listo para publicar.`,
    }],
  });

  const textBlock = textResponse.content[0];
  if (textBlock.type !== 'text') throw new Error('Claude no devolvió texto');
  const text = textBlock.text.trim();

  // Generar image prompt
  let imagePrompt: string | null = null;
  try {
    const imgResponse = await anthropic.messages.create({
      model: MODEL,
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
