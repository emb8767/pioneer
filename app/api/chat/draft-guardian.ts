// draft-guardian.ts — Fase 2: Simplificado
//
// Con create_draft y publish_post removidos de Claude, las protecciones ①②③ ya no aplican.
// Lo que queda:
// - Protección ④: Si el cliente aprueba y Claude no usa NINGUNA tool → forzar generate_content
// - Tracking de estado: image URLs, content text, platforms → para actionContext de botones
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
  // Image tracking (para inyección UX + actionContext)
  generateImageWasCalled: boolean;
  lastGeneratedImageUrls: string[];

  // Tool tracking para Protección ④
  anyToolExecutedInRequest: boolean;

  // Action context tracking (Fase 1B — datos para botones de acción)
  lastGeneratedContent: string | null;
  lastImagePrompt: string | null;
  connectedPlatforms: Array<{ platform: string; accountId: string }> | null;

  // OAuth tracking
  shouldClearOAuthCookie: boolean;
  linkedInCachedData: Record<string, unknown> | null;
  cachedConnectionOptions: Array<{ id: string; name: string }> | null;
}

export function createGuardianState(): GuardianState {
  return {
    generateImageWasCalled: false,
    lastGeneratedImageUrls: [],
    anyToolExecutedInRequest: false,
    lastGeneratedContent: null,
    lastImagePrompt: null,
    connectedPlatforms: null,
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
  // Fase 2: Sin create_draft ni publish_post, no hay nada que bloquear
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
  // forzar a Claude a ejecutar generate_content o generate_image.
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
        `• Si el cliente pidió imagen → llama generate_image\n` +
        `• NO necesitas publicar — el sistema lo hace automáticamente cuando el cliente aprueba la imagen\n\n` +
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

  // --- generate_image → rastrear URLs para inyección UX + actionContext ---
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

  // --- generate_content → capturar texto para actionContext ---
  if (toolName === 'generate_content') {
    try {
      const result = JSON.parse(toolResultJson);
      // result.content es un objeto { text, hashtags, platform_versions }
      if (result.content?.text) {
        state.lastGeneratedContent = result.content.text;
        console.log(`[DraftGuardian] Content capturado: "${result.content.text.substring(0, 60)}..."`);
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
}
