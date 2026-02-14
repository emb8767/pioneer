// route.ts — AI SDK 6: streamText + custom data parts
//
// WHAT CHANGED from old route.ts:
//   OLD: Anthropic SDK direct → conversation-loop.ts → response-builder.ts → JSON
//   NEW: AI SDK streamText → tool loop built-in → createUIMessageStream → SSE streaming
//
// WHAT STAYS THE SAME:
//   - button-detector.ts detects buttons from Claude's text
//   - /api/chat/action/* pipeline is completely untouched
//   - system-prompt.ts builds the prompt
//   - All action-handler.ts deterministic execution
//
// ARCHITECTURE:
//   createUIMessageStream (outer wrapper)
//     ├─ writer.write(sessionId) — transient, for localStorage
//     ├─ streamText (LLM call + tool loop)
//     │   ├─ tools: 4 OAuth tools with Zod schemas
//     │   └─ stopWhen: stepCountIs(7)
//     ├─ writer.merge(result.toUIMessageStream()) — streams text to client
//     └─ after merge: detectButtons → writer.write(buttons)

import { NextRequest } from 'next/server';
import {
  streamText,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  UIMessage,
  stepCountIs,
} from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { buildSystemPrompt } from '@/lib/system-prompt';
import { createPioneerTools, ToolRuntimeState } from '@/lib/pioneer-tools';
import { detectButtons } from './button-detector';
import type { DetectorState } from './button-detector';
import { getOAuthCookie } from '@/lib/oauth-cookie';
import type { OAuthPendingData } from '@/lib/oauth-cookie';
import { COOKIE_NAME } from '@/lib/oauth-cookie';
import { createSession, getSession, getActivePlan, getPlanProgress } from '@/lib/db';
import type { PioneerUIMessage } from '@/lib/ai-types';

// Allow streaming responses up to 60 seconds (Vercel serverless)
export const maxDuration = 60;

// === SESSION CONTEXT (same as before) ===
interface SessionContext {
  businessName: string | null;
  businessInfo: Record<string, unknown>;
  status: string;
  planSummary?: { name: string | null; postCount: number; postsPublished: number } | null;
}

export async function POST(request: NextRequest) {
  try {
    // ═══════════════════════════════════════
    // STEP 1: Parse request (session + OAuth)
    // ═══════════════════════════════════════
    const body = await request.json();
    const { messages: rawMessages, sessionId: incomingSessionId } = body as {
      messages?: UIMessage[];
      sessionId?: string;
    };

    if (!rawMessages || !Array.isArray(rawMessages)) {
      return new Response(JSON.stringify({ error: 'Se requiere un array de mensajes' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // --- OAuth cookie ---
    let pendingOAuthData: OAuthPendingData | null = null;
    try {
      pendingOAuthData = getOAuthCookie(request);
    } catch (error) {
      console.warn('[Pioneer] No se pudo leer OAuth cookie:', error);
    }

    // --- Session resolution ---
    let sessionId: string | null = null;
    let sessionContext: SessionContext | null = null;

    try {
      if (incomingSessionId) {
        const session = await getSession(incomingSessionId);
        if (session) {
          sessionId = session.id;
          if (session.business_info && Object.keys(session.business_info).length > 0) {
            sessionContext = {
              businessName: session.business_name,
              businessInfo: session.business_info,
              status: session.status,
            };
            try {
              const plan = await getActivePlan(sessionId);
              if (plan) {
                const progress = await getPlanProgress(plan.id);
                if (progress) {
                  sessionContext.planSummary = {
                    name: plan.plan_name,
                    postCount: plan.post_count,
                    postsPublished: progress.postsPublished,
                  };
                }
              }
            } catch { /* don't block if plan lookup fails */ }
          }
        } else {
          const newSession = await createSession();
          sessionId = newSession.id;
        }
      } else {
        const newSession = await createSession();
        sessionId = newSession.id;
      }
    } catch (dbErr) {
      console.error('[Pioneer] Error con session DB:', dbErr);
    }

    // ═══════════════════════════════════════
    // STEP 2: Create tools with OAuth state
    // ═══════════════════════════════════════
    const toolState: ToolRuntimeState = {
      shouldClearOAuthCookie: false,
      linkedInCachedData: null,
      cachedConnectionOptions: null,
    };

    const tools = createPioneerTools(pendingOAuthData, toolState);
    const systemPrompt = buildSystemPrompt(sessionContext || undefined);
    const modelMessages = await convertToModelMessages(rawMessages);

    // ═══════════════════════════════════════
    // STEP 3: Stream with custom data parts
    // ═══════════════════════════════════════
    //
    // Flow:
    // 1. execute() starts → sends sessionId (transient)
    // 2. streamText() calls Claude API with tools
    // 3. writer.merge() pipes LLM text to client in real-time
    // 4. After merge completes → detect buttons → write data part
    // 5. execute() returns → stream closes

    const stream = createUIMessageStream<PioneerUIMessage>({
      async execute({ writer }) {
        // 1. Send sessionId as transient data part
        //    (only available in onData callback, not in message.parts)
        if (sessionId) {
          writer.write({
            type: 'data-pioneer-session',
            data: { sessionId },
            transient: true,
          });
        }

        // 2. Call Claude via streamText with tool loop
        const result = streamText({
          model: anthropic('claude-sonnet-4-5-20250929'),
          system: systemPrompt,
          messages: modelMessages,
          tools,
          stopWhen: stepCountIs(7),
        });

        // 3. Merge LLM stream into our UI stream (streams text tokens to client)
        //    This awaits until the entire LLM response is complete
        writer.merge(result.toUIMessageStream());

        // 4. After stream completes, get the full text and detect buttons
        //    result.text is a promise that resolves when streaming finishes
        const fullText = await result.text;

        if (fullText) {
          const detectorState: DetectorState = {
            describeImageWasCalled: false,
            hasImageSpec: false,
          };

          const buttons = detectButtons(fullText, detectorState);

          if (buttons && buttons.length > 0) {
            console.log(`[Pioneer] Botones detectados: ${buttons.length} (${buttons.map(b => b.id).join(', ')})`);

            const actionContext: Record<string, string> = {};
            if (sessionId) actionContext.sessionId = sessionId;

            writer.write({
              type: 'data-pioneer-buttons',
              data: {
                buttons,
                actionContext,
              },
            });
          }
        }

        // 5. execute returns → stream closes automatically
      },
      onError: (error) => {
        console.error('[Pioneer] Stream error:', error);
        return 'Error procesando su mensaje. Por favor intente de nuevo.';
      },
    });

    // ═══════════════════════════════════════
    // STEP 4: Create response with cookie cleanup
    // ═══════════════════════════════════════
    const response = createUIMessageStreamResponse({ stream });

    // Clear OAuth cookie if a tool consumed it
    if (toolState.shouldClearOAuthCookie) {
      response.headers.append(
        'Set-Cookie',
        `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; ${process.env.NODE_ENV === 'production' ? 'Secure; ' : ''}SameSite=Lax`
      );
    }

    return response;

  } catch (error) {
    console.error('[Pioneer] Error en POST /api/chat:', error);
    const message = error instanceof Error ? error.message : 'Error interno del servidor';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
