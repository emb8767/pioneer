// draft-guardian.ts — Fase 5 cleanup
//
// Simplified to only what's still needed:
// - Protección ④: If client approves and Claude doesn't use any tool → gentle redirect
//   (No longer references generate_content or setup_queue — those tools don't exist)
// - OAuth state tracking (list_connected_accounts)
// - DB IDs: sessionId, planId, postId
//
// REMOVED: All branches for generate_content, describe_image, setup_queue (tools eliminated in Fase 5)

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

  // Connected platforms (from list_connected_accounts)
  connectedPlatforms: Array<{ platform: string; accountId: string }> | null;

  // DB IDs — fuente de verdad
  sessionId: string | null;
  activePlanId: string | null;
  activePostId: string | null;

  // OAuth tracking
  shouldClearOAuthCookie: boolean;
  linkedInCachedData: Record<string, unknown> | null;
  cachedConnectionOptions: Array<{ id: string; name: string }> | null;

  // Legacy flags kept for button-detector compatibility
  describeImageWasCalled: boolean;
  lastImageSpec: null;
}

export function createGuardianState(sessionId?: string | null): GuardianState {
  return {
    anyToolExecutedInRequest: false,
    connectedPlatforms: null,
    sessionId: sessionId || null,
    activePlanId: null,
    activePostId: null,
    shouldClearOAuthCookie: false,
    linkedInCachedData: null,
    cachedConnectionOptions: null,
    describeImageWasCalled: false,
    lastImageSpec: null,
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
  // Fase 5: Only 4 OAuth tools remain. Nothing to block.
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
  // PROTECCIÓN ④ (FIXED): Cliente aprobó + Claude no usó tools
  //
  // En Fase 5, la aprobación del plan se maneja con botones de acción,
  // NO con tools de Claude. Si el cliente escribe "aprobado" en texto libre
  // (en vez de usar el botón), Claude debe reconocer la aprobación y
  // dejar que el sistema de botones tome el control.
  //
  // ANTES (BUG): Le decía a Claude que llamara generate_content/setup_queue
  // que NO EXISTEN → loop infinito capped a 2 retries.
  //
  // AHORA: Le dice a Claude que reconozca la aprobación y guíe al cliente
  // a usar los botones del sistema.
  // ───────────────────────────────────────────────
  if (!state.anyToolExecutedInRequest && isApprovalMessage(lastUserMessage)) {
    console.log(`[DraftGuardian] ⛔ END_TURN BLOQUEADO (④): cliente aprobó "${lastUserMessage.trim().substring(0, 30)}" pero Claude no usó ninguna tool`);
    return {
      allowed: false,
      forceMessage:
        `SISTEMA — El cliente dijo "${lastUserMessage.trim()}" aprobando algo. ` +
        `Reconoce la aprobación de forma breve y positiva. ` +
        `El sistema mostrará automáticamente los botones de acción correspondientes. ` +
        `NO intentes ejecutar ninguna herramienta — el sistema se encarga de la ejecución.`,
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
  // Marcar que al menos una tool se ejecutó
  state.anyToolExecutedInRequest = true;

  // list_connected_accounts → capturar plataformas
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
