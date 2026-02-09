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

// === DETECCIÓN DE ALUCINACIÓN DE PUBLICACIÓN ===
// Detecta cuando Claude dice "publicado" o "programado" sin haber llamado publish_post
const PUBLISH_HALLUCINATION_PATTERNS = [
  // === "publicado" variants ===
  /publicado exitosamente/i,
  /publicado con éxito/i,
  /publicación exitosa/i,
  /✅.*publicado/i,
  /post publicado/i,
  /se ha publicado/i,
  /fue publicado/i,
  /publicamos exitosamente/i,
  /published successfully/i,
  // === "programado" variants (Bug 10.2 fix) ===
  /programado exitosamente/i,
  /programado con éxito/i,
  /programación exitosa/i,
  /✅.*programado/i,
  /post programado para/i,
  /se ha programado/i,
  /fue programado/i,
  /scheduled successfully/i,
];

function detectPublishHallucination(text: string, publishPostCount: number): boolean {
  if (publishPostCount > 0) return false;
  return PUBLISH_HALLUCINATION_PATTERNS.some((pattern) => pattern.test(text));
}

// === DETECCIÓN DE ALUCINACIÓN DE IMAGEN ===
// Detecta cuando Claude incluye URLs de imagen en su texto sin haber llamado generate_image
const IMAGE_URL_PATTERNS = [
  /https:\/\/media\.getlate\.dev\/[^\s)]+/,
  /https:\/\/replicate\.delivery\/[^\s)]+/,
];

function detectImageHallucination(text: string, generateImageWasCalled: boolean): boolean {
  if (generateImageWasCalled) return false;
  return IMAGE_URL_PATTERNS.some((pattern) => pattern.test(text));
}

const MAX_TOOL_USE_ITERATIONS = 10;

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

    // === TRACKING ===
    let currentMessages = [...formattedMessages];
    let finalTextParts: string[] = [];
    let generateImageWasCalled = false;
    let lastGeneratedImageUrls: string[] = [];
    let publishPostCount = 0;
    let hallucinationRetryUsed = false;
    let imageHallucinationRetryUsed = false;
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

        // === INYECCIÓN AUTOMÁTICA DE URL DE IMAGEN ===
        // Si generate_image fue llamada en este request y la URL NO aparece en el texto,
        // inyectarla automáticamente. Esto elimina la dependencia de que Claude pegue la URL.
        if (generateImageWasCalled && lastGeneratedImageUrls.length > 0) {
          const hasImageUrl = lastGeneratedImageUrls.some(url => fullText.includes(url));
          if (!hasImageUrl) {
            console.log(`[Pioneer] Inyectando ${lastGeneratedImageUrls.length} URL(s) de imagen en respuesta (Claude no las incluyó)`);
            const urlBlock = lastGeneratedImageUrls.join('\n\n');
            fullText = fullText + '\n\n' + urlBlock;
            // Reemplazar finalTextParts para que los checks posteriores usen el texto actualizado
            finalTextParts = [fullText];
          }
        }

        // Detección de alucinación de publicación/programación
        if (detectPublishHallucination(fullText, publishPostCount) && !hallucinationRetryUsed) {
          console.warn('[Pioneer] ⚠️ ALUCINACIÓN DETECTADA: Claude dijo "publicado/programado" sin llamar publish_post. Forzando retry.');
          hallucinationRetryUsed = true;

          let correctiveMessage = 'ERROR DEL SISTEMA: No se ejecutó la publicación ni programación. Debes llamar la tool publish_post para publicar o programar el post. El cliente ya aprobó. Llama publish_post ahora con el contenido que generaste anteriormente. NO respondas con texto — usa la tool publish_post.';

          if (lastGeneratedImageUrls.length > 0) {
            correctiveMessage += ` IMPORTANTE: NO generes nuevas imágenes. Usa estas URLs que ya generaste: ${JSON.stringify(lastGeneratedImageUrls)}`;
          }

          currentMessages = [
            ...currentMessages,
            { role: 'assistant' as const, content: response.content },
            { role: 'user' as const, content: correctiveMessage },
          ];
          finalTextParts = [];
          continue;
        }

        // Detección de alucinación de imagen — Claude muestra URL sin llamar generate_image
        if (detectImageHallucination(fullText, generateImageWasCalled) && !imageHallucinationRetryUsed) {
          console.warn('[Pioneer] ⚠️ ALUCINACIÓN DE IMAGEN DETECTADA: Claude incluyó URL de imagen sin llamar generate_image. Forzando retry.');
          imageHallucinationRetryUsed = true;

          const correctiveMessage = 'ERROR DEL SISTEMA: Incluiste una URL de imagen en tu respuesta sin haber llamado la tool generate_image. Cada imagen NUEVA requiere llamar generate_image — NUNCA reutilices URLs de posts anteriores ni de tu memoria. El cliente pidió una imagen. Llama generate_image ahora con un prompt apropiado para este post. NO respondas con texto — usa la tool generate_image.';

          currentMessages = [
            ...currentMessages,
            { role: 'assistant' as const, content: response.content },
            { role: 'user' as const, content: correctiveMessage },
          ];
          finalTextParts = [];
          continue;
        }

        // Construir respuesta con cookie clearing si necesario
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
            publishPostCount,
            hallucinationRetryUsed,
            lastGeneratedImageUrls,
            pendingOAuthData,
            linkedInCachedData,
            cachedConnectionOptions
          );

          // Actualizar tracking
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

          if (toolResult.publishPostCalled) {
            publishPostCount += 1;
            // === RESET para siguiente post: limpiar tracking de imagen ===
            // Cada post es un ciclo independiente. Después de publicar exitosamente,
            // resetear para que el siguiente post no reutilice datos del anterior.
            generateImageWasCalled = false;
            lastGeneratedImageUrls = [];
            hallucinationRetryUsed = false;
            imageHallucinationRetryUsed = false;
            console.log('[Pioneer] Post publicado — tracking de imagen reseteado para siguiente post');
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
