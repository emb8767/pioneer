// conversation-loop.ts — Loop principal de tool_use con Draft Guardian como interlock
//
// RESPONSABILIDADES:
// 1. Llamar a Claude API iterativamente
// 2. ANTES de cada tool: consultar draft-guardian (validateToolCall)
// 3. DESPUÉS de cada tool: actualizar estado del guardian (updateStateAfterTool)
// 4. Cuando Claude quiere terminar (end_turn): consultar guardian (validateEndTurn)
//    - Protección ④: aprobación sin tools → forzar acción (máximo 2 retries)
// 5. Recoger texto acumulado + estado final
//
// Fase 3: Flujo típico: list_accounts → generate_content → describe_image = 3 tools
// Claude no genera imágenes ni publica — solo diseña. El cliente ejecuta acciones.

import Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt } from '@/lib/system-prompt';
import { PIONEER_TOOLS } from '@/lib/tool-definitions';
import { executeTool } from '@/lib/tool-executor';
import type { OAuthPendingData } from '@/lib/oauth-cookie';
import {
  validateToolCall,
  validateEndTurn,
  updateStateAfterTool,
} from './draft-guardian';
import type { GuardianState } from './draft-guardian';

// Inicializar cliente de Anthropic (singleton a nivel módulo)
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Fase 3: Flujo típico: list_accounts → generate_content → describe_image = 3
// Con queue setup: +1. Con guardian retry: +1-2. Margen: 7 total.
const MAX_TOOL_USE_ITERATIONS = 7;

// === RESULTADO DEL LOOP ===
export interface ConversationResult {
  finalText: string;
  guardianState: GuardianState;
  lastUsage: Anthropic.Usage | null;
}

/**
 * Extrae el texto del último mensaje del usuario del array de mensajes.
 * Se usa para la Protección ④ (detectar aprobaciones).
 */
function getLastUserMessage(messages: Anthropic.MessageParam[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user' && typeof messages[i].content === 'string') {
      return messages[i].content as string;
    }
  }
  return '';
}

// === LOOP PRINCIPAL ===
export async function runConversationLoop(
  initialMessages: Anthropic.MessageParam[],
  pendingOAuthData: OAuthPendingData | null,
  guardianState: GuardianState
): Promise<ConversationResult> {

  let currentMessages = [...initialMessages];
  const finalTextParts: string[] = [];
  let lastUsage: Anthropic.Usage | null = null;

  // Protección ④: limitar a 2 retries para evitar loop infinito
  let approvalForceRetryCount = 0;

  const systemPrompt = buildSystemPrompt();

  // Extraer el último mensaje del usuario REAL (no mensajes inyectados por guardian)
  const lastUserMessage = getLastUserMessage(initialMessages);

  for (let iteration = 0; iteration < MAX_TOOL_USE_ITERATIONS; iteration++) {
    console.log(`[Pioneer] === Iteración ${iteration + 1}/${MAX_TOOL_USE_ITERATIONS} ===`);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2048,
      system: systemPrompt,
      tools: PIONEER_TOOLS,
      messages: currentMessages,
    });

    lastUsage = response.usage;

    // Recoger texto de esta iteración
    const textBlocks = response.content.filter(
      (block): block is Anthropic.TextBlock => block.type === 'text'
    );
    if (textBlocks.length > 0) {
      finalTextParts.push(...textBlocks.map((b) => b.text));
    }

    // ═══════════════════════════════════════════════
    // CASO 1: Claude quiere terminar (end_turn)
    // ═══════════════════════════════════════════════
    if (response.stop_reason === 'end_turn') {
      const endVerdict = validateEndTurn(guardianState, lastUserMessage);

      if (!endVerdict.allowed && endVerdict.forceMessage) {
        const isProtection4 = !guardianState.anyToolExecutedInRequest;

        if (isProtection4 && approvalForceRetryCount >= 2) {
          console.log(`[DraftGuardian] Protección ④ agotó ${approvalForceRetryCount} retries — permitiendo end_turn`);
          break;
        }

        if (isProtection4) {
          approvalForceRetryCount++;
          // LIMPIAR texto alucinado: si Claude dijo "programado/guardado" sin tools
          if (textBlocks.length > 0) {
            for (let t = 0; t < textBlocks.length; t++) {
              finalTextParts.pop();
            }
            console.log(`[DraftGuardian] Texto alucinado removido (${textBlocks.length} bloques)`);
          }
        }

        console.log(`[DraftGuardian] Forzando continuación (retry ${approvalForceRetryCount}/2)`);
        currentMessages = [
          ...currentMessages,
          { role: 'assistant' as const, content: response.content },
          { role: 'user' as const, content: endVerdict.forceMessage },
        ];
        continue;
      }

      // end_turn permitido — salir del loop
      break;
    }

    // ═══════════════════════════════════════════════
    // CASO 2: Claude quiere usar tools (tool_use)
    // ═══════════════════════════════════════════════
    if (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
      );

      if (toolUseBlocks.length === 0) {
        finalTextParts.push('Error interno: tool_use sin herramientas.');
        break;
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolBlock of toolUseBlocks) {
        // ─────────────────────────────────────────
        // DRAFT GUARDIAN: Validar ANTES de ejecutar
        // ─────────────────────────────────────────
        const verdict = validateToolCall(toolBlock.name, guardianState);

        if (!verdict.allowed) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: JSON.stringify({
              success: false,
              error: verdict.blockReason,
              blocked_by: 'draft_guardian',
            }),
            is_error: true,
          });
          continue;
        }

        // ─────────────────────────────────────────
        // EJECUTAR TOOL (permitida por guardian)
        // ─────────────────────────────────────────
        console.log(
          `[Pioneer] Ejecutando tool: ${toolBlock.name}`,
          JSON.stringify(toolBlock.input).substring(0, 200)
        );

        const toolResult = await executeTool(
          toolBlock.name,
          toolBlock.input as Record<string, unknown>,
          pendingOAuthData,
          guardianState.linkedInCachedData,
          guardianState.cachedConnectionOptions
        );

        // ─────────────────────────────────────────
        // DRAFT GUARDIAN: Actualizar estado DESPUÉS
        // ─────────────────────────────────────────
        updateStateAfterTool(toolBlock.name, toolResult.result, guardianState);

        // Actualizar estado OAuth del guardian desde tool result
        if (toolResult.shouldClearOAuthCookie) guardianState.shouldClearOAuthCookie = true;
        if (toolResult.linkedInDataToCache) guardianState.linkedInCachedData = toolResult.linkedInDataToCache;
        if (toolResult.connectionOptionsToCache) guardianState.cachedConnectionOptions = toolResult.connectionOptionsToCache;

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          content: toolResult.result,
        });
      }

      // Agregar respuesta de Claude + resultados al historial
      currentMessages = [
        ...currentMessages,
        { role: 'assistant' as const, content: response.content },
        { role: 'user' as const, content: toolResults },
      ];
    }
  }

  // Construir texto final
  const finalText = finalTextParts.join('\n\n') ||
    'Lo siento, la operación tomó demasiados pasos. Por favor intente de nuevo con una solicitud más simple.';

  return {
    finalText,
    guardianState,
    lastUsage,
  };
}
