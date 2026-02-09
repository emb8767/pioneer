// draft-guardian.ts — Interlock de validación para Draft-First flow
//
// PROPÓSITO: Cerrar en CÓDIGO las 3 zonas grises que el system prompt no puede garantizar.
// Se ejecuta ANTES de cada tool call. Puede BLOQUEAR una tool y devolver un error
// que Claude recibe como tool_result, forzándolo a corregir su flujo.
//
// === 3 PROTECCIONES ===
// ① Si create_draft fue llamado y Claude responde sin publish_post → bloquear end_turn
// ② Si Claude intenta create_draft 2 veces en mismo request → bloquear segundo
// ③ Si Claude llama generate_content sin haber completado publish_post del draft actual → bloquear
//
// ESTILO PLC/LADDER: entrada clara (toolName + state), salida clara (allow/block + reason)

// === ESTADO DEL GUARDIAN (por request HTTP) ===
export interface GuardianState {
  // Draft tracking
  draftCreated: boolean;       // true después de create_draft exitoso
  activeDraftId: string | null; // ID del draft pendiente de publish
  publishCompleted: boolean;   // true después de publish_post exitoso

  // Image tracking (mantener para inyección UX)
  generateImageWasCalled: boolean;
  lastGeneratedImageUrls: string[];

  // OAuth tracking
  shouldClearOAuthCookie: boolean;
  linkedInCachedData: Record<string, unknown> | null;
  cachedConnectionOptions: Array<{ id: string; name: string }> | null;
}

export function createGuardianState(): GuardianState {
  return {
    draftCreated: false,
    activeDraftId: null,
    publishCompleted: false,
    generateImageWasCalled: false,
    lastGeneratedImageUrls: [],
    shouldClearOAuthCookie: false,
    linkedInCachedData: null,
    cachedConnectionOptions: null,
  };
}

// === RESULTADO DE LA VALIDACIÓN ===
export interface GuardianVerdict {
  allowed: boolean;
  blockReason: string | null; // Mensaje que Claude recibe como tool_result de error
}

const ALLOW: GuardianVerdict = { allowed: true, blockReason: null };

function block(reason: string): GuardianVerdict {
  console.log(`[DraftGuardian] ⛔ BLOQUEADO: ${reason}`);
  return { allowed: false, blockReason: reason };
}

// === VALIDACIÓN PRE-EJECUCIÓN ===
// Se llama ANTES de ejecutar cada tool. Decide si la tool puede proceder.

export function validateToolCall(
  toolName: string,
  state: GuardianState
): GuardianVerdict {

  // ───────────────────────────────────────────────
  // PROTECCIÓN ②: create_draft duplicado
  // Si ya hay un draft activo (creado y no publicado), bloquear segundo create_draft
  // ───────────────────────────────────────────────
  if (toolName === 'create_draft') {
    if (state.draftCreated && state.activeDraftId && !state.publishCompleted) {
      return block(
        `ERROR: Ya existe un borrador activo (draft_id: ${state.activeDraftId}). ` +
        `NO puedes crear otro borrador. Tu próxima acción OBLIGATORIA es preguntar al cliente cuándo publicar ` +
        `y luego llamar publish_post con draft_id: "${state.activeDraftId}". ` +
        `El flujo correcto es: create_draft (✅ HECHO) → publish_post (⬅️ PENDIENTE).`
      );
    }
  }

  // ───────────────────────────────────────────────
  // PROTECCIÓN ③: generate_content sin haber publicado draft actual
  // Si hay un draft creado pendiente de publish, bloquear avance al siguiente post
  // ───────────────────────────────────────────────
  if (toolName === 'generate_content') {
    if (state.draftCreated && state.activeDraftId && !state.publishCompleted) {
      return block(
        `ERROR: Hay un borrador pendiente de publicar (draft_id: ${state.activeDraftId}). ` +
        `NO puedes generar contenido del siguiente post hasta publicar el actual. ` +
        `Tu próxima acción OBLIGATORIA es llamar publish_post con draft_id: "${state.activeDraftId}". ` +
        `NUNCA avances al siguiente post sin completar publish_post del actual.`
      );
    }
  }

  // ───────────────────────────────────────────────
  // Todas las demás tools: PERMITIR
  // ───────────────────────────────────────────────
  return ALLOW;
}

// === VALIDACIÓN END_TURN ===
// Se llama cuando Claude quiere terminar su turno (stop_reason === 'end_turn').
// PROTECCIÓN ①: Si hay draft sin publish, inyectar mensaje forzando a Claude a actuar.

export interface EndTurnVerdict {
  allowed: boolean;
  forceMessage: string | null; // Mensaje a inyectar como "user" para forzar continuación
}

export function validateEndTurn(state: GuardianState): EndTurnVerdict {
  // Si hay un draft activo que no fue publicado, NO dejar que Claude termine
  if (state.draftCreated && state.activeDraftId && !state.publishCompleted) {
    console.log(`[DraftGuardian] ⛔ END_TURN BLOQUEADO: draft ${state.activeDraftId} sin publish`);
    return {
      allowed: false,
      forceMessage:
        `SISTEMA: Hay un borrador pendiente (draft_id: ${state.activeDraftId}) que NO ha sido publicado. ` +
        `DEBES preguntar al cliente cuándo desea publicarlo y luego llamar publish_post con ese draft_id. ` +
        `NO puedes terminar tu turno sin resolver el borrador pendiente.`,
    };
  }

  return { allowed: true, forceMessage: null };
}

// === ACTUALIZACIÓN DE ESTADO POST-EJECUCIÓN ===
// Se llama DESPUÉS de ejecutar cada tool exitosamente.
// Actualiza el estado del guardian basado en los resultados.

export function updateStateAfterTool(
  toolName: string,
  toolResultJson: string,
  state: GuardianState
): void {

  // --- create_draft exitoso → registrar draft activo ---
  if (toolName === 'create_draft') {
    try {
      const result = JSON.parse(toolResultJson);
      if (result.success && result.draft_id) {
        state.draftCreated = true;
        state.activeDraftId = result.draft_id;
        state.publishCompleted = false;
        console.log(`[DraftGuardian] ✅ Draft registrado: ${result.draft_id}`);
      }
      // Duplicado también cuenta como "draft existe" si tiene existing_post_id
      if (result.success && result.duplicate && result.existing_post_id) {
        state.draftCreated = true;
        state.activeDraftId = result.existing_post_id;
        state.publishCompleted = false;
        console.log(`[DraftGuardian] ✅ Draft duplicado registrado: ${result.existing_post_id}`);
      }
    } catch {
      // No-op: si no se puede parsear, no actualizamos estado
    }
  }

  // --- publish_post exitoso → liberar estado para siguiente post ---
  if (toolName === 'publish_post') {
    try {
      const result = JSON.parse(toolResultJson);
      if (result.success) {
        state.publishCompleted = true;
        // Reset para el siguiente post del plan
        state.draftCreated = false;
        state.activeDraftId = null;
        state.generateImageWasCalled = false;
        state.lastGeneratedImageUrls = [];
        console.log(`[DraftGuardian] ✅ Publish completado — estado reseteado para siguiente post`);
      }
    } catch {
      // No-op
    }
  }

  // --- generate_image → rastrear URLs para inyección UX ---
  if (toolName === 'generate_image') {
    state.generateImageWasCalled = true;
    try {
      const result = JSON.parse(toolResultJson);
      if (result.success && result.images) {
        state.lastGeneratedImageUrls = result.images;
      } else if (result.success && result.image_url) {
        state.lastGeneratedImageUrls = [result.image_url];
      }
    } catch {
      // No-op
    }
  }
}
