'use client';

// page.tsx — AI SDK 6: useChat hook + Pioneer custom components
//
// WHAT CHANGED:
//   OLD: useState + manual fetch to /api/chat → JSON response → setMessages
//   NEW: useChat hook → SSE streaming → automatic message state
//
// SESSION ID FIX (Fase 6.5):
//   OLD: transient data part via onData → BROKEN (onData never fired)
//   NEW: X-Pioneer-Session-Id response header → read via custom fetch wrapper
//   The custom fetch wraps the native fetch, reads the header from the
//   response, and saves sessionId to localStorage + React state.
//   This is 100% reliable because headers are always available.
//
// WHAT STAYS THE SAME:
//   - MessageContent (markdown parsing, images, links, bold)
//   - ImageWithRetry (CDN delay handling)
//   - ActionButtons (visual component)
//   - /api/chat/action calls for deterministic execution
//   - ?pending_connection OAuth callback handling

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { PioneerUIMessage, ButtonConfig, ActionContext } from '@/lib/ai-types';

// ════════════════════════════════════════
// RENDERIZAR CONTENIDO DEL MENSAJE
// ════════════════════════════════════════
// Parsea:
// 1. Markdown images: ![alt](url) → <img>
// 2. Bare replicate/late.dev/image URLs → <img>
// 3. Markdown links: [text](url) → <a>
// 4. Bare URLs (https://...) → <a> clickable
// 5. Bold: **text** → <strong>

function MessageContent({ content }: { content: string }) {
  const parts: React.ReactNode[] = [];
  const lines = content.split('\n');

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];

    if (lineIdx > 0) {
      parts.push(<br key={`br-${lineIdx}`} />);
    }

    const combinedRegex = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)|(https:\/\/replicate\.delivery\/[^\s)]+|https:\/\/media\.getlate\.dev\/[^\s)]+|https?:\/\/[^\s)]+\.(?:webp|png|jpg|jpeg|gif))|\[([^\]]+)\]\((https?:\/\/[^)]+)\)|(https?:\/\/[^\s)]+)|\*\*([^*]+)\*\*/g;

    let lastIndex = 0;
    let match;

    while ((match = combinedRegex.exec(line)) !== null) {
      if (match.index > lastIndex) {
        parts.push(
          <span key={`text-${lineIdx}-${lastIndex}`}>
            {line.slice(lastIndex, match.index)}
          </span>
        );
      }

      if (match[1] !== undefined && match[2]) {
        const url = match[2];
        const alt = match[1] || 'Imagen generada';
        parts.push(
          <ImageWithRetry key={`img-${lineIdx}-${match.index}`} url={url} alt={alt} />
        );
      } else if (match[3]) {
        const url = match[3];
        parts.push(
          <ImageWithRetry key={`bareimg-${lineIdx}-${match.index}`} url={url} alt="Imagen generada" />
        );
      } else if (match[4] && match[5]) {
        parts.push(
          <a
            key={`mdlink-${lineIdx}-${match.index}`}
            href={match[5]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 underline hover:text-blue-800 break-all"
          >
            {match[4]}
          </a>
        );
      } else if (match[6]) {
        const url = match[6];
        parts.push(
          <a
            key={`link-${lineIdx}-${match.index}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 underline hover:text-blue-800 break-all"
          >
            {url}
          </a>
        );
      } else if (match[7]) {
        parts.push(
          <strong key={`bold-${lineIdx}-${match.index}`}>{match[7]}</strong>
        );
      }

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < line.length) {
      parts.push(
        <span key={`text-${lineIdx}-${lastIndex}`}>
          {line.slice(lastIndex)}
        </span>
      );
    }
  }

  return <div className="whitespace-pre-wrap">{parts}</div>;
}

// ════════════════════════════════════════
// IMAGEN CON RETRY AUTOMÁTICO
// ════════════════════════════════════════

function ImageWithRetry({ url, alt }: { url: string; alt: string }) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'retrying' | 'error'>('loading');
  const [imgSrc, setImgSrc] = useState(url);
  const retryCount = useRef(0);
  const maxRetries = 3;

  return (
    <span className="block my-3">
      {status === 'error' ? (
        <p className="text-amber-600 text-sm mt-1">
          ⚠️ No se pudo cargar la imagen. La URL puede haber expirado.
        </p>
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imgSrc}
            alt={alt}
            className={`max-w-full rounded-lg shadow-md transition-opacity duration-300 ${
              status === 'loaded' ? 'opacity-100' : 'opacity-0'
            }`}
            style={{ maxHeight: '400px', objectFit: 'contain' }}
            onLoad={() => setStatus('loaded')}
            onError={() => {
              if (retryCount.current < maxRetries) {
                retryCount.current += 1;
                setStatus('retrying');
                const delays = [3000, 5000, 8000];
                const delay = delays[retryCount.current - 1] || 5000;
                setTimeout(() => {
                  const separator = url.includes('?') ? '&' : '?';
                  setImgSrc(`${url}${separator}_retry=${Date.now()}`);
                }, delay);
              } else {
                setStatus('error');
              }
            }}
          />
          {(status === 'loading' || status === 'retrying') && (
            <div className="flex items-center gap-2 text-gray-400 text-sm py-4">
              <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
              {status === 'retrying' ? `Cargando imagen (intento ${retryCount.current + 1})...` : 'Cargando imagen...'}
            </div>
          )}
        </>
      )}
    </span>
  );
}

// ════════════════════════════════════════
// COMPONENTE DE BOTONES
// ════════════════════════════════════════

function ActionButtons({
  buttons,
  disabled,
  loading,
  onButtonClick,
}: {
  buttons: ButtonConfig[];
  disabled: boolean;
  loading: boolean;
  onButtonClick: (button: ButtonConfig) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 mt-3">
      {loading ? (
        <div className="flex items-center gap-2 px-4 py-2 text-sm text-blue-600">
          <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          Procesando...
        </div>
      ) : (
        buttons.map((button) => {
          const baseStyles = 'px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 border';

          let styleClasses: string;
          if (disabled) {
            styleClasses = 'opacity-50 cursor-not-allowed border-gray-200 text-gray-400 bg-gray-50';
          } else if (button.style === 'primary') {
            styleClasses = 'border-blue-500 text-blue-700 bg-white hover:bg-blue-50 cursor-pointer';
          } else if (button.style === 'ghost') {
            styleClasses = 'border-dashed border-gray-300 text-gray-500 bg-white hover:bg-gray-50 cursor-pointer';
          } else {
            styleClasses = 'border-gray-300 text-gray-700 bg-white hover:bg-gray-50 cursor-pointer';
          }

          return (
            <button
              key={button.id}
              onClick={() => !disabled && onButtonClick(button)}
              disabled={disabled}
              className={`${baseStyles} ${styleClasses}`}
            >
              {button.label}
            </button>
          );
        })
      )}
    </div>
  );
}

// ════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ════════════════════════════════════════

export default function ChatPage() {
  // --- Pioneer state (not managed by useChat) ---
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null); // message ID with action in progress
  const [disabledMessages, setDisabledMessages] = useState<Set<string>>(new Set());
  const [pendingConnectionHandled, setPendingConnectionHandled] = useState(false);
  const [actionResults, setActionResults] = useState<Map<string, {
    content: string;
    buttons?: ButtonConfig[];
    actionContext?: ActionContext;
  }>>(new Map());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [chatInput, setChatInput] = useState('');

  // --- Ref to hold latest sessionId for the fetch wrapper ---
  // Using a ref so the custom fetch always has the current value
  // without needing to recreate the transport on every sessionId change.
  const sessionIdRef = useRef<string | null>(null);

  // Keep ref in sync with state
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // --- Custom fetch that reads X-Pioneer-Session-Id header ---
  // This is the FIX for the broken transient data part approach.
  // The backend sends sessionId as a response header, which is
  // always readable regardless of streaming protocol quirks.
  const pioneerFetch = useCallback(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await fetch(input, init);

    // Read sessionId from response header
    const headerSessionId = response.headers.get('X-Pioneer-Session-Id');
    if (headerSessionId && !sessionIdRef.current) {
      // First time receiving sessionId — save it
      sessionIdRef.current = headerSessionId;
      setSessionId(headerSessionId);
      localStorage.setItem('pioneer_session_id', headerSessionId);
      console.log(`[Pioneer] SessionId recibido via header: ${headerSessionId}`);
    }

    return response;
  }, []);

  // --- Transport with custom fetch (stable — no sessionId dependency) ---
  // body uses a function so it always reads the latest sessionIdRef.current
  const transport = useMemo(
    () => new DefaultChatTransport({
      api: '/api/chat',
      body: () => ({ sessionId: sessionIdRef.current }),
      fetch: pioneerFetch,
    }),
    [pioneerFetch]
  );

  // --- useChat hook (manages conversation state + streaming) ---
  const {
    messages,
    status,
    sendMessage,
    error,
  } = useChat<PioneerUIMessage>({
    transport,
    onError: (err) => {
      console.error('[Pioneer] Chat error:', err);
    },
  });

  const isLoading = status === 'submitted' || status === 'streaming';

  // --- Auto-scroll ---
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, actionResults]);

  // --- Check saved session on mount ---
  useEffect(() => {
    if (sessionChecked) return;
    setSessionChecked(true);

    const savedSessionId = localStorage.getItem('pioneer_session_id');
    if (savedSessionId) {
      setSessionId(savedSessionId);
      sessionIdRef.current = savedSessionId;
      // Verify session exists in DB
      fetch(`/api/chat/session?id=${savedSessionId}`)
        .then(res => res.json())
        .then(data => {
          if (data.exists) {
            console.log(`[Pioneer] Sesión restaurada: ${data.sessionId} (${data.businessName})`);
            // Send welcome-back as first message to trigger streaming
            let welcomeBack = `Soy un cliente que regresa. Mi negocio es ${data.businessName}.`;
            if (data.plan) {
              welcomeBack += ` Mi plan "${data.plan.name}" tiene ${data.plan.postsPublished}/${data.plan.postCount} posts publicados.`;
            }
            welcomeBack += ' ¿Qué puedo hacer hoy?';
            // We'll let the user interact naturally instead of auto-sending
          } else {
            localStorage.removeItem('pioneer_session_id');
            setSessionId(null);
            sessionIdRef.current = null;
          }
        })
        .catch(() => {
          // Network error — continue without session
        });
    }
  }, [sessionChecked]);

  // --- Detect ?pending_connection in URL ---
  useEffect(() => {
    if (pendingConnectionHandled) return;

    const urlParams = new URLSearchParams(window.location.search);
    const pendingPlatform = urlParams.get('pending_connection');

    if (pendingPlatform) {
      setPendingConnectionHandled(true);
      window.history.replaceState({}, '', window.location.pathname);

      const platformName = getPlatformDisplayName(pendingPlatform);
      const autoMessage = `Acabo de autorizar ${platformName}.\nNecesito completar la conexión.`;

      setTimeout(() => {
        sendMessage({ text: autoMessage });
      }, 500);
    }
  }, [pendingConnectionHandled, sendMessage]);

  // ════════════════════════════════════════
  // EXTRACT BUTTONS FROM MESSAGE PARTS
  // ════════════════════════════════════════
  const getButtonsFromMessage = useCallback((message: PioneerUIMessage): {
    buttons: ButtonConfig[];
    actionContext?: ActionContext;
  } | null => {
    if (message.role !== 'assistant') return null;

    // Check for data-pioneer-buttons parts
    for (const part of message.parts) {
      if (part.type === 'data-pioneer-buttons') {
        const data = part.data as { buttons: ButtonConfig[]; actionContext?: ActionContext };
        if (data.buttons && data.buttons.length > 0) {
          return data;
        }
      }
    }
    return null;
  }, []);

  // ════════════════════════════════════════
  // EXTRACT TEXT FROM MESSAGE PARTS
  // ════════════════════════════════════════
  const getTextFromMessage = useCallback((message: PioneerUIMessage): string => {
    return message.parts
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map(part => part.text)
      .join('\n\n');
  }, []);

  // ════════════════════════════════════════
  // HANDLE SEND MESSAGE
  // ════════════════════════════════════════
  const handleSend = useCallback(() => {
    if (!chatInput.trim() || isLoading) return;
    const text = chatInput.trim();
    setChatInput('');
    sendMessage({ text });
  }, [chatInput, isLoading, setChatInput, sendMessage]);

  // ════════════════════════════════════════
  // EXECUTE ACTION (deterministic pipeline)
  // ════════════════════════════════════════
  const executeAction = useCallback(async (
    button: ButtonConfig,
    messageId: string,
    actionContext?: ActionContext
  ) => {
    setActionLoading(messageId);

    // Merge actionContext: inherit sessionId from state
    const mergedContext: ActionContext = { ...actionContext };
    if (!mergedContext.sessionId && sessionId) {
      mergedContext.sessionId = sessionId;
    }

    // Find planId from previous messages if missing
    if (!mergedContext.planId) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role !== 'assistant') continue;
        for (const part of msg.parts) {
          if (part.type === 'data-pioneer-buttons') {
            const data = part.data as { actionContext?: ActionContext };
            if (data.actionContext?.planId) {
              mergedContext.planId = data.actionContext.planId;
              break;
            }
          }
        }
        if (mergedContext.planId) break;
      }
    }

    // Build params
    const params: Record<string, unknown> = {
      sessionId: mergedContext.sessionId,
      planId: mergedContext.planId,
      postId: mergedContext.postId,
      imageUrls: mergedContext.imageUrls,
    };

    // For approve_plan: send plan text + conversation context
    if (button.action === 'approve_plan') {
      // Find the assistant message with the plan
      for (let i = messages.length - 1; i >= 0; i--) {
        const text = getTextFromMessage(messages[i] as PioneerUIMessage);
        if (messages[i].role === 'assistant' && /posts/i.test(text)) {
          params.planText = text;
          break;
        }
      }
      // Conversation context for business_info extraction
      const contextMessages = messages
        .slice(0, 20)
        .map(m => {
          const text = getTextFromMessage(m as PioneerUIMessage);
          return `${m.role === 'user' ? 'Cliente' : 'Pioneer'}: ${text.substring(0, 500)}`;
        })
        .join('\n\n');
      params.conversationContext = contextMessages;
    }

    // For next_post: send conversation context
    if (button.action === 'next_post') {
      const contextMessages = messages
        .slice(0, 20)
        .map(m => {
          const text = getTextFromMessage(m as PioneerUIMessage);
          return `${m.role === 'user' ? 'Cliente' : 'Pioneer'}: ${text.substring(0, 500)}`;
        })
        .join('\n\n');
      params.conversationContext = contextMessages;
    }

    try {
      const response = await fetch('/api/chat/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: button.action,
          params,
        }),
      });

      const data = await response.json();

      // Store action result keyed by a unique ID
      const resultId = `action-${messageId}-${Date.now()}`;
      setActionResults(prev => new Map(prev).set(resultId, {
        content: data.message,
        buttons: data.buttons,
        actionContext: { ...mergedContext, ...data.actionContext },
      }));

    } catch (error) {
      console.error('Error ejecutando acción:', error);
      const resultId = `action-${messageId}-${Date.now()}`;
      setActionResults(prev => new Map(prev).set(resultId, {
        content: '❌ Error ejecutando la acción. Por favor intente de nuevo.',
      }));
    } finally {
      setActionLoading(null);
    }
  }, [sessionId, messages, getTextFromMessage]);

  // ════════════════════════════════════════
  // HANDLE BUTTON CLICK
  // ════════════════════════════════════════
  const handleButtonClick = useCallback((button: ButtonConfig, messageId: string, actionContext?: ActionContext) => {
    // Disable buttons on this message
    setDisabledMessages(prev => new Set(prev).add(messageId));

    if (button.type === 'option') {
      if (button.chatMessage === '') {
        // "Otro" / "Cambios" → focus input
        inputRef.current?.focus();
        return;
      }
      // Send as chat message through useChat
      sendMessage({ text: button.chatMessage! });
    } else if (button.type === 'action') {
      executeAction(button, messageId, actionContext);
    }
  }, [sendMessage, executeAction]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════
  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b px-6 py-4">
        <h1 className="text-xl font-semibold text-gray-800">Pioneer Agent</h1>
        <p className="text-sm text-gray-500">Su asistente de marketing digital</p>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto space-y-4">
          {/* Welcome message (before any useChat messages) */}
          {messages.length === 0 && !isLoading && (
            <div className="flex justify-start">
              <div className="max-w-[80%] rounded-2xl px-4 py-3 bg-white border border-gray-200 text-gray-800">
                <MessageContent content="¡Bienvenido! Soy Pioneer, su asistente de marketing. ¿En qué puedo ayudarle hoy con su negocio?" />
              </div>
            </div>
          )}

          {/* Chat messages from useChat */}
          {messages.map((message) => {
            const pioneerMsg = message as PioneerUIMessage;
            const text = getTextFromMessage(pioneerMsg);
            const buttonData = getButtonsFromMessage(pioneerMsg);
            const isDisabled = disabledMessages.has(message.id);

            return (
              <div key={message.id}>
                {/* Message bubble */}
                {text && (
                  <div className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                        message.role === 'user'
                          ? 'bg-blue-600 text-white'
                          : 'bg-white border border-gray-200 text-gray-800'
                      }`}
                    >
                      <MessageContent content={text} />
                    </div>
                  </div>
                )}

                {/* Buttons from data parts */}
                {message.role === 'assistant' && buttonData && buttonData.buttons.length > 0 && (
                  <div className="flex justify-start mt-1">
                    <div className="max-w-[80%]">
                      <ActionButtons
                        buttons={buttonData.buttons}
                        disabled={isDisabled || isLoading}
                        loading={actionLoading === message.id}
                        onButtonClick={(button) =>
                          handleButtonClick(button, message.id, buttonData.actionContext)
                        }
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Action results (from /api/chat/action) */}
          {Array.from(actionResults.entries()).map(([resultId, result]) => (
            <div key={resultId}>
              <div className="flex justify-start">
                <div className="max-w-[80%] rounded-2xl px-4 py-3 bg-white border border-gray-200 text-gray-800">
                  <MessageContent content={result.content} />
                </div>
              </div>
              {result.buttons && result.buttons.length > 0 && (
                <div className="flex justify-start mt-1">
                  <div className="max-w-[80%]">
                    <ActionButtons
                      buttons={result.buttons}
                      disabled={disabledMessages.has(resultId) || isLoading}
                      loading={actionLoading === resultId}
                      onButtonClick={(button) => {
                        setDisabledMessages(prev => new Set(prev).add(resultId));
                        if (button.type === 'option') {
                          if (button.chatMessage === '') {
                            inputRef.current?.focus();
                            return;
                          }
                          sendMessage({ text: button.chatMessage! });
                        } else if (button.type === 'action') {
                          executeAction(button, resultId, result.actionContext);
                        }
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Loading indicator */}
          {status === 'submitted' && (
            <div className="flex justify-start">
              <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3">
                <div className="flex space-x-2">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0.1s]" />
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0.2s]" />
                </div>
              </div>
            </div>
          )}

          {/* Error display */}
          {error && (
            <div className="flex justify-start">
              <div className="max-w-[80%] rounded-2xl px-4 py-3 bg-red-50 border border-red-200 text-red-700">
                Lo siento, hubo un error al procesar su mensaje. Por favor, intente de nuevo.
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t bg-white px-4 py-4">
        <div className="max-w-3xl mx-auto flex gap-3">
          <textarea
            ref={inputRef}
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder="Escriba su mensaje..."
            className="flex-1 resize-none rounded-xl border border-gray-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            rows={1}
            disabled={isLoading}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !chatInput.trim()}
            className="px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════

function getPlatformDisplayName(platform: string): string {
  const names: Record<string, string> = {
    facebook: 'Facebook',
    instagram: 'Instagram',
    twitter: 'Twitter/X',
    linkedin: 'LinkedIn',
    tiktok: 'TikTok',
    youtube: 'YouTube',
    threads: 'Threads',
    reddit: 'Reddit',
    pinterest: 'Pinterest',
    bluesky: 'Bluesky',
    googlebusiness: 'Google Business',
    telegram: 'Telegram',
    snapchat: 'Snapchat',
  };
  return names[platform] || platform;
}
