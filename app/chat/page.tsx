'use client';

// page.tsx — Pioneer Chat UI v2.0
// Visual redesign: Tuyo-inspired professional messaging UI
// All business logic (useChat, actions, sessions, buttons) unchanged

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { PioneerUIMessage, ButtonConfig, ActionContext } from '@/lib/ai-types';

// ════════════════════════════════════════
// PIONEER AVATAR
// ════════════════════════════════════════

function PioneerAvatar({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const dims = size === 'sm' ? 'h-7 w-7 text-xs' : 'h-8 w-8 text-sm';
  return (
    <div className={`${dims} flex items-center justify-center rounded-full bg-[var(--pioneer-teal)] text-white font-bold shrink-0 shadow-sm`}>
      P
    </div>
  );
}

// ════════════════════════════════════════
// RENDERIZAR CONTENIDO DEL MENSAJE
// ════════════════════════════════════════

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
        parts.push(
          <ImageWithRetry key={`img-${lineIdx}-${match.index}`} url={match[2]} alt={match[1] || 'Imagen generada'} />
        );
      } else if (match[3]) {
        parts.push(
          <ImageWithRetry key={`bareimg-${lineIdx}-${match.index}`} url={match[3]} alt="Imagen generada" />
        );
      } else if (match[4] && match[5]) {
        parts.push(
          <a key={`mdlink-${lineIdx}-${match.index}`} href={match[5]} target="_blank" rel="noopener noreferrer"
            className="text-[var(--pioneer-teal)] underline decoration-[var(--pioneer-teal)]/30 underline-offset-2 hover:decoration-[var(--pioneer-teal)] break-all transition-colors">
            {match[4]}
          </a>
        );
      } else if (match[6]) {
        parts.push(
          <a key={`link-${lineIdx}-${match.index}`} href={match[6]} target="_blank" rel="noopener noreferrer"
            className="text-[var(--pioneer-teal)] underline decoration-[var(--pioneer-teal)]/30 underline-offset-2 hover:decoration-[var(--pioneer-teal)] break-all transition-colors">
            {match[6]}
          </a>
        );
      } else if (match[7]) {
        parts.push(
          <strong key={`bold-${lineIdx}-${match.index}`} className="font-semibold">{match[7]}</strong>
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

  return <div className="whitespace-pre-wrap leading-relaxed">{parts}</div>;
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
            className={`max-w-full rounded-xl shadow-md transition-all duration-500 ${
              status === 'loaded' ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
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
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
              <div className="w-4 h-4 border-2 border-[var(--pioneer-teal)] border-t-transparent rounded-full animate-spin" />
              {status === 'retrying' ? `Cargando imagen (intento ${retryCount.current + 1})...` : 'Cargando imagen...'}
            </div>
          )}
        </>
      )}
    </span>
  );
}

// ════════════════════════════════════════
// BOTONES DE ACCIÓN — PILL STYLE
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
    <div className="flex flex-wrap gap-2 mt-2">
      {loading ? (
        <div className="flex items-center gap-2 px-4 py-2 text-sm text-[var(--pioneer-teal)]">
          <div className="w-4 h-4 border-2 border-[var(--pioneer-teal)] border-t-transparent rounded-full animate-spin" />
          Procesando...
        </div>
      ) : (
        buttons.map((button) => {
          const base = 'px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 border cursor-pointer';

          let style: string;
          if (disabled) {
            style = 'opacity-40 cursor-not-allowed border-border text-muted-foreground bg-muted';
          } else if (button.style === 'primary') {
            style = 'border-[var(--pioneer-teal)] text-[var(--pioneer-teal)] bg-[var(--pioneer-teal-bg)] hover:bg-[var(--pioneer-teal)]/10 shadow-sm';
          } else if (button.style === 'ghost') {
            style = 'border-dashed border-border text-muted-foreground bg-transparent hover:bg-accent';
          } else {
            style = 'border-border text-foreground bg-card hover:bg-accent shadow-sm';
          }

          return (
            <button
              key={button.id}
              onClick={() => !disabled && onButtonClick(button)}
              disabled={disabled}
              className={`${base} ${style}`}
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
// POST PREVIEW CARD
// ════════════════════════════════════════
// Detects post content pattern from action-handler:
//   **Post #N — Title:**\n\n---\n\ncontent\n\n---\n\n¿Le gusta...
// And image pattern:
//   🖼️ Imagen generada:\n\n![...](url)\n\n¿Le gusta?

interface ParsedPost {
  number: number;
  title: string;
  body: string;
  trailing: string;
}

function parsePostContent(text: string): ParsedPost | null {
  const match = text.match(/\*\*Post #(\d+)\s*[—–-]\s*([^*]+):\*\*\s*\n+---\n+([\s\S]+?)\n+---\s*\n*([\s\S]*)/);
  if (!match) return null;
  return {
    number: parseInt(match[1]),
    title: match[2].trim(),
    body: match[3].trim(),
    trailing: match[4].trim(),
  };
}

function PostPreviewCard({ post }: { post: ParsedPost }) {
  // Extract hashtags from body
  const lines = post.body.split('\n');
  const hashtagLine = lines.find(l => (l.match(/#\w/g) || []).length >= 2);
  const bodyWithoutHashtags = hashtagLine
    ? lines.filter(l => l !== hashtagLine).join('\n').trim()
    : post.body;
  const hashtags = hashtagLine
    ? hashtagLine.match(/#\w+/g) || []
    : [];

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg pioneer-gradient flex items-center justify-center">
            <span className="text-white text-[10px] font-bold">{post.number}</span>
          </div>
          <span className="text-sm font-semibold text-foreground">{post.title}</span>
        </div>
        <span className="text-[11px] text-muted-foreground">Post #{post.number}</span>
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        <div className="text-[0.9375rem] text-card-foreground leading-relaxed whitespace-pre-wrap">
          {bodyWithoutHashtags}
        </div>

        {/* Hashtags */}
        {hashtags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {hashtags.map((tag, i) => (
              <span key={i} className="text-xs text-[var(--pioneer-teal)] bg-[var(--pioneer-teal-bg)] px-2 py-0.5 rounded-full">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Trailing question */}
      {post.trailing && (
        <div className="px-4 py-2 border-t border-border">
          <p className="text-sm text-muted-foreground">{post.trailing}</p>
        </div>
      )}
    </div>
  );
}

// Detect image-only message: 🖼️ Imagen generada:\n\n![...](url)\n\n¿Le gusta?
interface ParsedImage {
  url: string;
  trailing: string;
}

function parseImageContent(text: string): ParsedImage | null {
  const match = text.match(/🖼️\s*Imagen generada:\s*\n+!\[[^\]]*\]\((https?:\/\/[^)]+)\)\s*\n*([\s\S]*)/);
  if (!match) return null;
  return { url: match[1], trailing: match[2].trim() };
}

function ImagePreviewCard({ image }: { image: ParsedImage }) {
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
      <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center gap-2">
        <span className="text-sm">🖼️</span>
        <span className="text-sm font-semibold text-foreground">Imagen generada</span>
      </div>
      <div className="p-2">
        <ImageWithRetry url={image.url} alt="Imagen generada para el post" />
      </div>
      {image.trailing && (
        <div className="px-4 py-2 border-t border-border">
          <p className="text-sm text-muted-foreground">{image.trailing}</p>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════
// SMART CONTENT — auto-detect post/image cards vs plain text
// ════════════════════════════════════════

function SmartContent({ content }: { content: string }) {
  // Try post card
  const parsedPost = parsePostContent(content);
  if (parsedPost) return <PostPreviewCard post={parsedPost} />;

  // Try image card
  const parsedImage = parseImageContent(content);
  if (parsedImage) return <ImagePreviewCard image={parsedImage} />;

  // Fallback: regular message
  return <MessageContent content={content} />;
}

// ════════════════════════════════════════
// SEND ICON
// ════════════════════════════════════════

function SendIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

// ════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ════════════════════════════════════════

export default function ChatPage() {
  // --- Pioneer state (not managed by useChat) ---
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [disabledMessages, setDisabledMessages] = useState<Set<string>>(new Set());
  const [pendingConnectionHandled, setPendingConnectionHandled] = useState(false);
  const [actionResults, setActionResults] = useState<Map<string, {
    content: string;
    buttons?: ButtonConfig[];
    actionContext?: ActionContext;
  }>>(new Map());
  const [welcomeData, setWelcomeData] = useState<{
    businessName: string | null;
    plan: { name: string; postCount: number; postsPublished: number } | null;
  } | null>(null);
  const [suggestions, setSuggestions] = useState<Array<{
    id: string;
    type: string;
    title: string;
    description: string;
    priority: number;
  }>>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [chatInput, setChatInput] = useState('');
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // --- Custom fetch that reads X-Pioneer-Session-Id header ---
  const pioneerFetch = useCallback(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await fetch(input, init);
    const headerSessionId = response.headers.get('X-Pioneer-Session-Id');
    if (headerSessionId && !sessionIdRef.current) {
      sessionIdRef.current = headerSessionId;
      setSessionId(headerSessionId);
      localStorage.setItem('pioneer_session_id', headerSessionId);
    }
    return response;
  }, []);

  const transport = useMemo(
    () => new DefaultChatTransport({
      api: '/api/chat',
      body: () => ({ sessionId: sessionIdRef.current }),
      fetch: pioneerFetch,
    }),
    [pioneerFetch]
  );

  const { messages, status, sendMessage, error } = useChat<PioneerUIMessage>({
    transport,
    onError: (err) => console.error('[Pioneer] Chat error:', err),
  });

  const isLoading = status === 'submitted' || status === 'streaming';

  // --- Auto-scroll ---
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, actionResults]);

  // --- Check session on mount ---
  useEffect(() => {
    if (sessionChecked) return;
    setSessionChecked(true);

    fetch('/api/chat/session')
      .then(res => res.json())
      .then(data => {
        if (data.needsOnboarding) {
          window.location.href = '/onboarding';
          return;
        }
        if (data.exists && data.sessionId) {
          setSessionId(data.sessionId);
          sessionIdRef.current = data.sessionId;
          localStorage.setItem('pioneer_session_id', data.sessionId);
          setWelcomeData({
            businessName: data.businessName,
            plan: data.plan || null,
          });
          fetch(`/api/suggestions?sessionId=${data.sessionId}`)
            .then(res => res.json())
            .then(sugData => {
              if (sugData.suggestions?.length > 0) {
                setSuggestions(sugData.suggestions);
              }
            })
            .catch(() => {});
        } else {
          window.location.href = '/onboarding';
        }
      })
      .catch(() => {
        const savedSessionId = localStorage.getItem('pioneer_session_id');
        if (savedSessionId) {
          setSessionId(savedSessionId);
          sessionIdRef.current = savedSessionId;
        }
      });
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
      setTimeout(() => { sendMessage({ text: autoMessage }); }, 500);
    }
  }, [pendingConnectionHandled, sendMessage]);

  // ════════════════════════════════════════
  // EXTRACT BUTTONS & TEXT FROM PARTS
  // ════════════════════════════════════════

  const getButtonsFromMessage = useCallback((message: PioneerUIMessage): {
    buttons: ButtonConfig[];
    actionContext?: ActionContext;
  } | null => {
    if (message.role !== 'assistant') return null;
    for (const part of message.parts) {
      if (part.type === 'data-pioneer-buttons') {
        const data = part.data as { buttons: ButtonConfig[]; actionContext?: ActionContext };
        if (data.buttons && data.buttons.length > 0) return data;
      }
    }
    return null;
  }, []);

  const getTextFromMessage = useCallback((message: PioneerUIMessage): string => {
    return message.parts
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map(part => part.text)
      .join('\n\n');
  }, []);

  // ════════════════════════════════════════
  // HANDLE SEND
  // ════════════════════════════════════════

  const handleSend = useCallback(() => {
    if (!chatInput.trim() || isLoading) return;
    const text = chatInput.trim();
    setChatInput('');
    sendMessage({ text });
  }, [chatInput, isLoading, setChatInput, sendMessage]);

  // ════════════════════════════════════════
  // EXECUTE ACTION
  // ════════════════════════════════════════

  const executeAction = useCallback(async (
    button: ButtonConfig,
    messageId: string,
    actionContext?: ActionContext
  ) => {
    setActionLoading(messageId);

    const mergedContext: ActionContext = { ...actionContext };
    if (!mergedContext.sessionId && sessionId) {
      mergedContext.sessionId = sessionId;
    }

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

    const params: Record<string, unknown> = {
      sessionId: mergedContext.sessionId,
      planId: mergedContext.planId,
      postId: mergedContext.postId,
      imageUrls: mergedContext.imageUrls,
    };

    if (button.action === 'approve_plan') {
      for (let i = messages.length - 1; i >= 0; i--) {
        const text = getTextFromMessage(messages[i] as PioneerUIMessage);
        if (messages[i].role === 'assistant' && /posts/i.test(text)) {
          params.planText = text;
          break;
        }
      }
      const contextMessages = messages
        .slice(0, 20)
        .map(m => {
          const text = getTextFromMessage(m as PioneerUIMessage);
          return `${m.role === 'user' ? 'Cliente' : 'Pioneer'}: ${text.substring(0, 500)}`;
        })
        .join('\n\n');
      params.conversationContext = contextMessages;
    }

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
        body: JSON.stringify({ action: button.action, params }),
      });

      const data = await response.json();
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
    setDisabledMessages(prev => new Set(prev).add(messageId));

    if (button.type === 'option') {
      if (button.chatMessage === '') {
        inputRef.current?.focus();
        return;
      }
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

  const handleSuggestionClick = useCallback((text: string) => {
    sendMessage({ text });
  }, [sendMessage]);

  const showWelcomeScreen = messages.length === 0 && !isLoading;

  // ════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════
  return (
    <div className="flex flex-col h-full bg-background">

      {/* ══════ MESSAGES AREA ══════ */}
      <div className="flex-1 overflow-y-auto pioneer-scrollbar">
        <div className="max-w-2xl mx-auto px-4 py-6 space-y-1">

          {/* ══════ WELCOME SCREEN ══════ */}
          {showWelcomeScreen && (
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-center pioneer-message-enter">

              {/* Logo */}
              <div className="w-14 h-14 rounded-2xl pioneer-gradient flex items-center justify-center mb-6 shadow-lg">
                <span className="text-white text-2xl font-bold">P</span>
              </div>

              {welcomeData?.businessName ? (
                <>
                  <h2 className="text-2xl font-bold text-foreground mb-1">
                    ¡Hola de nuevo!
                  </h2>
                  <p className="text-muted-foreground mb-8 text-base">
                    {welcomeData.businessName} — ¿en qué le ayudo hoy?
                  </p>

                  {/* Plan status card */}
                  {welcomeData.plan && (
                    <div className="w-full max-w-md mb-6 p-4 rounded-2xl border border-border bg-card shadow-sm">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Plan activo</span>
                        <span className="text-xs text-[var(--pioneer-teal)] font-semibold">
                          {welcomeData.plan.postsPublished}/{welcomeData.plan.postCount} posts
                        </span>
                      </div>
                      <p className="text-sm font-medium text-foreground mb-2">{welcomeData.plan.name}</p>
                      <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full pioneer-gradient rounded-full transition-all duration-500"
                          style={{ width: `${(welcomeData.plan.postsPublished / welcomeData.plan.postCount) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Suggestion cards from engine */}
                  {suggestions.length > 0 && (
                    <div className="w-full max-w-md mb-6">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3 text-left">
                        Sugerencias para su negocio
                      </p>
                      <div className="space-y-2">
                        {suggestions.map((sug) => (
                          <button
                            key={sug.id}
                            onClick={() => {
                              fetch('/api/suggestions', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ suggestionId: sug.id, action: 'accepted' }),
                              }).catch(() => {});
                              setSuggestions(prev => prev.filter(s => s.id !== sug.id));
                              handleSuggestionClick(sug.title);
                            }}
                            className="w-full px-4 py-3 rounded-xl border border-[var(--pioneer-teal)]/20 bg-[var(--pioneer-teal-bg)] text-left hover:border-[var(--pioneer-teal)]/40 hover:shadow-sm transition-all duration-200 cursor-pointer group"
                          >
                            <span className="text-sm font-medium text-foreground group-hover:text-[var(--pioneer-teal)] transition-colors">
                              {sug.title}
                            </span>
                            <span className="block text-xs text-muted-foreground mt-0.5">{sug.description}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Quick actions */}
                  <div className="grid grid-cols-2 gap-2 w-full max-w-md">
                    <QuickAction text="Crear un nuevo plan de marketing" onClick={handleSuggestionClick} />
                    <QuickAction text="Conectar más redes sociales" onClick={handleSuggestionClick} />
                    <QuickAction text="Revisar mis estrategias anteriores" onClick={handleSuggestionClick} />
                    <QuickAction text="Tengo una pregunta sobre marketing" onClick={handleSuggestionClick} />
                  </div>
                </>
              ) : (
                <>
                  <h2 className="text-2xl font-bold text-foreground mb-1">
                    ¡Bienvenido a Pioneer!
                  </h2>
                  <p className="text-muted-foreground mb-8 text-base">
                    Marketing digital inteligente para su negocio en Puerto Rico.
                  </p>
                  <div className="grid grid-cols-2 gap-2 w-full max-w-md">
                    <QuickAction text="Quiero crear mi primera campaña" onClick={handleSuggestionClick} />
                    <QuickAction text="Conectar mis redes sociales" onClick={handleSuggestionClick} />
                    <QuickAction text="¿Qué puede hacer Pioneer?" onClick={handleSuggestionClick} />
                    <QuickAction text="Quiero saber más antes de empezar" onClick={handleSuggestionClick} />
                  </div>
                </>
              )}
            </div>
          )}

          {/* ══════ CHAT MESSAGES ══════ */}
          {messages.map((message) => {
            const pioneerMsg = message as PioneerUIMessage;
            const text = getTextFromMessage(pioneerMsg);
            const buttonData = getButtonsFromMessage(pioneerMsg);
            const isDisabled = disabledMessages.has(message.id);
            const isUser = message.role === 'user';

            return (
              <div key={message.id} className="pioneer-message-enter">
                {text && (
                  <div className={`flex gap-2.5 py-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
                    {/* Bot avatar */}
                    {!isUser && <PioneerAvatar />}

                    {/* Bubble */}
                    <div
                      className={`max-w-[78%] rounded-2xl px-4 py-3 text-[0.9375rem] ${
                        isUser
                          ? 'bg-[var(--pioneer-user-bubble)] text-[var(--pioneer-user-text)] rounded-br-md'
                          : 'bg-[var(--pioneer-bot-bubble)] border border-[var(--pioneer-bot-border)] text-card-foreground rounded-bl-md shadow-sm'
                      }`}
                    >
                      <MessageContent content={text} />
                    </div>
                  </div>
                )}

                {/* Buttons */}
                {!isUser && buttonData && buttonData.buttons.length > 0 && (
                  <div className="flex justify-start pl-10 pb-1">
                    <div className="max-w-[78%]">
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

          {/* Action results */}
          {Array.from(actionResults.entries()).map(([resultId, result]) => (
            <div key={resultId} className="pioneer-message-enter">
              <div className="flex gap-2.5 py-2 justify-start">
                <PioneerAvatar />
                <div className="max-w-[78%]">
                  <SmartContent content={result.content} />
                </div>
              </div>
              {result.buttons && result.buttons.length > 0 && (
                <div className="flex justify-start pl-10 pb-1">
                  <div className="max-w-[78%]">
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

          {/* Typing indicator */}
          {status === 'submitted' && (
            <div className="flex gap-2.5 py-2 justify-start pioneer-message-enter">
              <PioneerAvatar />
              <div className="bg-[var(--pioneer-bot-bubble)] border border-[var(--pioneer-bot-border)] rounded-2xl rounded-bl-md px-4 py-3 shadow-sm">
                <div className="flex gap-1.5">
                  <div className="w-2 h-2 bg-muted-foreground/50 rounded-full pioneer-typing-dot" />
                  <div className="w-2 h-2 bg-muted-foreground/50 rounded-full pioneer-typing-dot" />
                  <div className="w-2 h-2 bg-muted-foreground/50 rounded-full pioneer-typing-dot" />
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex gap-2.5 py-2 justify-start pioneer-message-enter">
              <PioneerAvatar />
              <div className="max-w-[78%] rounded-2xl rounded-bl-md px-4 py-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/30 text-red-700 dark:text-red-400 text-sm">
                Lo siento, hubo un error al procesar su mensaje. Por favor, intente de nuevo.
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* ══════ INPUT BAR ══════ */}
      <div className="border-t border-border bg-background/80 pioneer-glass px-4 py-3">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-end gap-2 bg-card border border-border rounded-2xl px-4 py-2 shadow-sm focus-within:ring-2 focus-within:ring-[var(--pioneer-teal)]/30 focus-within:border-[var(--pioneer-teal)]/50 transition-all">
            <textarea
              ref={inputRef}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="Escriba su mensaje..."
              className="flex-1 resize-none bg-transparent text-foreground text-[0.9375rem] placeholder:text-muted-foreground focus:outline-none pioneer-input"
              rows={1}
              disabled={isLoading}
            />
            <button
              onClick={handleSend}
              disabled={isLoading || !chatInput.trim()}
              className="shrink-0 p-2 rounded-xl bg-[var(--pioneer-teal)] text-white hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200"
            >
              <SendIcon />
            </button>
          </div>
          <p className="text-center text-xs text-muted-foreground/50 mt-2">
            Pioneer Agent — Marketing inteligente para su negocio
          </p>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════
// QUICK ACTION BUTTON (welcome screen)
// ════════════════════════════════════════

function QuickAction({ text, onClick }: { text: string; onClick: (text: string) => void }) {
  return (
    <button
      onClick={() => onClick(text)}
      className="px-4 py-3 rounded-xl border border-border bg-card text-card-foreground text-sm text-left hover:border-[var(--pioneer-teal)]/30 hover:shadow-sm transition-all duration-200 cursor-pointer"
    >
      {text}
    </button>
  );
}

// ════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════

function getPlatformDisplayName(platform: string): string {
  const names: Record<string, string> = {
    facebook: 'Facebook', instagram: 'Instagram', twitter: 'Twitter/X',
    linkedin: 'LinkedIn', tiktok: 'TikTok', youtube: 'YouTube',
    threads: 'Threads', reddit: 'Reddit', pinterest: 'Pinterest',
    bluesky: 'Bluesky', googlebusiness: 'Google Business',
    telegram: 'Telegram', snapchat: 'Snapchat',
  };
  return names[platform] || platform;
}
