import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';

// === IMPORTS MODULARES ===
import { buildSystemPrompt } from '@/lib/system-prompt';
import { PIONEER_TOOLS } from '@/lib/tool-definitions';
import { executeTool } from '@/lib/tool-executor';
import { getOAuthCookie, COOKIE_NAME } from '@/lib/oauth-cookie';
import type { OAuthPendingData } from '@/lib/oauth-cookie';

// Inicializar cliente de Anthropic
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// === DRAFT-FIRST: Sin detección de alucinaciones ===
// Con el flujo Draft-First, las alucinaciones de publicación y de imagen
// ya no son un problema porque:
// 1. Claude no puede "publicar" sin draft_id — publish_post requiere uno
// 2. Las imágenes se vinculan al draft en Late.dev, no dependen del texto de Claude
// 3. Duplicados son imposibles porque PUT al mismo draft_id no crea post nuevo

// Flujo típico: list_accounts → generate_content → generate_image → create_draft → publish_post = 5 iteraciones
// Con queue setup: +1. Margen: 8 total.
const MAX_TOOL_USE_ITERATIONS = 8;

export async function POST(request: NextRequest) {
  try {
    const { messages } = await request.json();

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: 'Se requiere un array de mensajes' },
        { status: 400 }
      );
    }

    const formattedMessages: Anthropic.MessageParam[] = messages.map(
      (msg: { role: string; content: string }) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })
    );

    // === LEER COOKIE OAUTH AL INICIO DEL REQUEST ===
    let pendingOAuthData: OAuthPendingData | null = null;
    try {
      const allCookies = request.cookies.getAll();
      console.log(`[Pioneer] Cookies en request (${allCookies.length}):`, allCookies.map(c => c.name));
      pendingOAuthData = getOAuthCookie(request);
      console.log(`[Pioneer] OAuth cookie leída:`, pendingOAuthData ?
        `platform=${pendingOAuthData.platform}, step=${pendingOAuthData.step}` : 'null');
    } catch (error) {
      console.warn('[Pioneer] No se pudo leer OAuth cookie:', error);
    }

    // === TRACKING SIMPLIFICADO (Draft-First) ===
    // Solo necesitamos rastrear imágenes generadas y el draft actual.
    // No hay tracking de alucinaciones, no hay resets complejos.
    let currentMessages = [...formattedMessages];
    let finalTextParts: string[] = [];
    let generateImageWasCalled = false;
    let lastGeneratedImageUrls: string[] = [];
    let shouldClearOAuthCookie = false;
    let linkedInCachedData: Record<string, unknown> | null = null;
    let cachedConnectionOptions: Array<{ id: string; name: string }> | null = null;

    const systemPrompt = buildSystemPrompt();

    // === LOOP DE TOOL_USE ===
    for (let iteration = 0; iteration < MAX_TOOL_USE_ITERATIONS; iteration++) {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 2048,
        system: systemPrompt,
        tools: PIONEER_TOOLS,
        messages: currentMessages,
      });

      // Recoger texto de esta iteración
      const textBlocks = response.content.filter(
        (block): block is Anthropic.TextBlock => block.type === 'text'
      );
      if (textBlocks.length > 0) {
        finalTextParts.push(...textBlocks.map((b) => b.text));
      }

      // === SI CLAUDE TERMINÓ ===
      if (response.stop_reason === 'end_turn') {
        let fullText = finalTextParts.join('\n\n');

        // === INYECCIÓN DE URL DE IMAGEN (mantener para UX) ===
        // Si generate_image fue llamada y la URL NO aparece en el texto,
        // inyectarla para que el chat UI la renderice como imagen visible.
        if (generateImageWasCalled && lastGeneratedImageUrls.length > 0) {
          const hasImageUrl = lastGeneratedImageUrls.some(url => fullText.includes(url));
          if (!hasImageUrl) {
            console.log(`[Pioneer] Inyectando ${lastGeneratedImageUrls.length} URL(s) de imagen en respuesta`);
            const urlBlock = lastGeneratedImageUrls.join('\n\n');
            fullText = fullText + '\n\n' + urlBlock;
          }
        }

        // === RESPUESTA FINAL ===
        const jsonResponse = NextResponse.json({
          message: fullText,
          usage: response.usage,
        });

        if (shouldClearOAuthCookie) {
          jsonResponse.cookies.set(COOKIE_NAME, '', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: 0,
          });
        }

        return jsonResponse;
      }

      // === SI CLAUDE QUIERE USAR TOOLS ===
      if (response.stop_reason === 'tool_use') {
        const toolUseBlocks = response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
        );

        if (toolUseBlocks.length === 0) {
          return NextResponse.json({
            message: finalTextParts.join('\n\n') || 'Error interno: tool_use sin herramientas.',
          });
        }

        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const toolBlock of toolUseBlocks) {
          console.log(
            `[Pioneer] Ejecutando tool: ${toolBlock.name}`,
            JSON.stringify(toolBlock.input).substring(0, 200)
          );

          const toolResult = await executeTool(
            toolBlock.name,
            toolBlock.input as Record<string, unknown>,
            generateImageWasCalled,
            lastGeneratedImageUrls,
            pendingOAuthData,
            linkedInCachedData,
            cachedConnectionOptions
          );

          // === TRACKING: generate_image ===
          if (toolBlock.name === 'generate_image') {
            generateImageWasCalled = true;
            try {
              const imgResult = JSON.parse(toolResult.result);
              if (imgResult.success && imgResult.images) {
                lastGeneratedImageUrls = imgResult.images;
              } else if (imgResult.success && imgResult.image_url) {
                lastGeneratedImageUrls = [imgResult.image_url];
              }
            } catch {
              // No-op
            }
          }

          // === TRACKING: publish_post (draft activado) ===
          if (toolResult.publishPostCalled) {
            // Draft fue activado exitosamente.
            // Resetear imagen tracking para el siguiente post del plan.
            generateImageWasCalled = false;
            lastGeneratedImageUrls = [];
            console.log('[Pioneer] Draft activado — tracking reseteado para siguiente post');
          }

          if (toolResult.shouldClearOAuthCookie) shouldClearOAuthCookie = true;
          if (toolResult.linkedInDataToCache) linkedInCachedData = toolResult.linkedInDataToCache;
          if (toolResult.connectionOptionsToCache) cachedConnectionOptions = toolResult.connectionOptionsToCache;

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: toolResult.result,
          });
        }

        currentMessages = [
          ...currentMessages,
          { role: 'assistant' as const, content: response.content },
          { role: 'user' as const, content: toolResults },
        ];
      }
    }

    // Agotamos iteraciones
    return NextResponse.json({
      message: finalTextParts.join('\n\n') ||
        'Lo siento, la operación tomó demasiados pasos. Por favor intente de nuevo con una solicitud más simple.',
    });
  } catch (error) {
    console.error('[Pioneer] Error en POST /api/chat:', error);

    if (error instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: `Error de Claude API: ${error.message}`, status: error.status },
        { status: 502 }
      );
    }

    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}
