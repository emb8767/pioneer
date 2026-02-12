// draft-guardian.ts — Fase DB-1: Tracking de IDs de DB
//
// Con generate_image movido a action buttons, ya no hay image tracking en el loop.
// Lo que queda:
// - Protección ④: Si el cliente aprueba y Claude no usa NINGUNA tool → forzar generate_content
// - Tracking de estado: content text, imageSpec, platforms → para actionContext de botones
// - DB IDs: sessionId, planId, postId → para que action-handler lea de DB
//
// ESTILO PLC/LADDER: entrada clara, salida clara

// === PATRONES DE APROBACIÓN DEL CLIENTE ===
const APPROVAL_PATTERNS = [
  /^s[ií]$/i,
  /^dale$/i,
  /^ok$/i,
  /^aprobado$/i,
  /^perfecto$/i,
  /^adelante$/i,
  /^me gusta$/i,
  /^está bien$/i,
  /^esta bien$/i,
  /^ok[,.]?\s*dale$/i,
  /^s[ií][,.]?\s*dale$/i,
  /^s[ií][,.]?\s*aprobado$/i,
];

export function isApprovalMessage(text: string): boolean {
  const trimmed = text.trim();
  return APPROVAL_PATTERNS.some(pattern => pattern.test(trimmed));
}

// === ESTADO DEL GUARDIAN (por request HTTP) ===
export interface GuardianState {
  // Tool tracking para Protección ④
  anyToolExecutedInRequest: boolean;

  // Action context tracking — datos para botones de acción
  lastGeneratedContent: string | null;
  connectedPlatforms: Array<{ platform: string; accountId: string }> | null;

  // Image spec tracking (from generate_content auto image prompt)
  describeImageWasCalled: boolean;
  lastImageSpec: {
    prompt: string;
    model: string;
    aspect_ratio: string;
    count: number;
  } | null;

  // DB IDs (Fase DB-1) — fuente de verdad para content y counter
  sessionId: string | null;
  activePlanId: string | null;
  activePostId: string | null;

  // Post counter — legacy (de setup_queue, se mantiene para backward compat)
  planPostCount: number | null;

  // OAuth tracking
  shouldClearOAuthCookie: boolean;
  linkedInCachedData: Record<string, unknown> | null;
  cachedConnectionOptions: Array<{ id: string; name: string }> | null;
}

export function createGuardianState(sessionId?: string | null): GuardianState {
  return {
    anyToolExecutedInRequest: false,
    lastGeneratedContent: null,
    connectedPlatforms: null,
    describeImageWasCalled: false,
    lastImageSpec: null,
    sessionId: sessionId || null,
    activePlanId: null,
    activePostId: null,
    planPostCount: null,
    shouldClearOAuthCookie: false,
    linkedInCachedData: null,
    cachedConnectionOptions: null,
  };
}

// === VALIDACIÓN PRE-EJECUCIÓN ===
export interface GuardianVerdict {
  allowed: boolean;
  blockReason: string | null;
}

const ALLOW: GuardianVerdict = { allowed: true, blockReason: null };

export function validateToolCall(
  _toolName: string,
  _state: GuardianState
): GuardianVerdict {
  // Fase 3: Sin create_draft, publish_post, ni generate_image. Nada que bloquear.
  return ALLOW;
}

// === VALIDACIÓN END_TURN ===
export interface EndTurnVerdict {
  allowed: boolean;
  forceMessage: string | null;
}

export function validateEndTurn(
  state: GuardianState,
  lastUserMessage: string
): EndTurnVerdict {
  // ───────────────────────────────────────────────
  // PROTECCIÓN ④: Cliente aprobó + Claude no usó tools
  // Si el cliente dijo "aprobado"/"dale" y Claude solo respondió texto,
  // forzar a Claude a ejecutar generate_content o describe_image.
  // ───────────────────────────────────────────────
  if (!state.anyToolExecutedInRequest && isApprovalMessage(lastUserMessage)) {
    console.log(`[DraftGuardian] ⛔ END_TURN BLOQUEADO (④): cliente aprobó "${lastUserMessage.trim().substring(0, 30)}" pero Claude no usó ninguna tool`);
    return {
      allowed: false,
      forceMessage:
        `SISTEMA — ACCIÓN OBLIGATORIA: El cliente dijo "${lastUserMessage.trim()}" aprobando algo. ` +
        `Respondiste SOLO con texto. Eso es INCORRECTO — debes ejecutar herramientas.\n\n` +
        `INSTRUCCIONES:\n` +
        `• Si el cliente aprobó el plan → llama generate_content para el primer post\n` +
        `• Si el cliente aprobó las estrategias → llama setup_queue y luego diseña el plan\n` +
        `• NO necesitas hacer nada con imágenes — el sistema lo maneja automáticamente\n\n` +
        `RESPONDE USANDO tool_use. NO respondas con texto solamente.`,
    };
  }

  return { allowed: true, forceMessage: null };
}

// === ACTUALIZACIÓN DE ESTADO POST-EJECUCIÓN ===

export function updateStateAfterTool(
  toolName: string,
  toolResultJson: string,
  state: GuardianState
): void {
  // --- Marcar que al menos una tool se ejecutó ---
  state.anyToolExecutedInRequest = true;

  // --- generate_content → capturar texto + imageSpec + postId para actionContext ---
  if (toolName === 'generate_content') {
    try {
      const result = JSON.parse(toolResultJson);
      if (result.content?.text) {
        state.lastGeneratedContent = result.content.text;
        console.log(`[DraftGuardian] Content capturado: "${result.content.text.substring(0, 60)}..."`);
      }
      // generate_content ahora también devuelve imageSpec
      if (result.imageSpec) {
        state.describeImageWasCalled = true; // Reutilizar flag para que button-detector sepa
        state.lastImageSpec = result.imageSpec;
        console.log(`[DraftGuardian] ImageSpec capturado (auto): prompt="${result.imageSpec.prompt.substring(0, 60)}...", model=${result.imageSpec.model}`);
      }
      // DB: capturar postId
      if (result.postId) {
        state.activePostId = result.postId;
        console.log(`[DraftGuardian] PostId capturado: ${result.postId}`);
      }
    } catch {
      // No-op
    }
  }

  // --- describe_image → capturar spec para actionContext (legacy, no debería ocurrir en Fase 4) ---
  if (toolName === 'describe_image') {
    state.describeImageWasCalled = true;
    try {
      const result = JSON.parse(toolResultJson);
      if (result.image_spec) {
        state.lastImageSpec = result.image_spec;
        console.log(`[DraftGuardian] ImageSpec capturado: prompt="${result.image_spec.prompt.substring(0, 60)}...", model=${result.image_spec.model}`);
      }
    } catch {
      // No-op
    }
  }

  // --- list_connected_accounts → capturar plataformas para actionContext ---
  if (toolName === 'list_connected_accounts') {
    try {
      const result = JSON.parse(toolResultJson);
      if (result.success && result.accounts) {
        state.connectedPlatforms = result.accounts.map(
          (acc: { _id: string; platform: string }) => ({
            platform: acc.platform,
            accountId: acc._id,
          })
        );
      }
    } catch {
      // No-op
    }
  }

  // --- setup_queue → capturar planPostCount + planId ---
  if (toolName === 'setup_queue') {
    try {
      const result = JSON.parse(toolResultJson);
      if (result.success && result.upcoming_dates) {
        state.planPostCount = result.upcoming_dates.length;
        console.log(`[DraftGuardian] planPostCount capturado: ${state.planPostCount}`);
      }
      // DB: capturar planId
      if (result.planId) {
        state.activePlanId = result.planId;
        console.log(`[DraftGuardian] PlanId capturado: ${result.planId}`);
      }
    } catch {
      // No-op
    }
  }
}
