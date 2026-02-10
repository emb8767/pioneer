'use client';

import { useState, useRef, useEffect } from 'react';

// === TIPOS ===

interface ButtonConfig {
  id: string;
  label: string;
  type: 'option' | 'action';
  style: 'primary' | 'secondary' | 'ghost';
  chatMessage?: string;
  action?: string;
  params?: Record<string, unknown>;
}

interface ActionContext {
  content?: string;
  imageUrls?: string[];
  imagePrompt?: string;
  imageModel?: string;
  imageAspectRatio?: string;
  imageCount?: number;
  platforms?: Array<{ platform: string; accountId: string }>;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  buttons?: ButtonConfig[];
  buttonsDisabled?: boolean;
  actionContext?: ActionContext;
}

// === RENDERIZAR CONTENIDO DEL MENSAJE ===
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

    // Combined regex — ORDER MATTERS (most specific first)
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
        // Markdown image: ![alt](url)
        const url = match[2];
        const alt = match[1] || 'Imagen generada';
        parts.push(
          <ImageWithRetry key={`img-${lineIdx}-${match.index}`} url={url} alt={alt} />
        );
      } else if (match[3]) {
        // Bare image URL
        const url = match[3];
        parts.push(
          <ImageWithRetry key={`bareimg-${lineIdx}-${match.index}`} url={url} alt="Imagen generada" />
        );
      } else if (match[4] && match[5]) {
        // Markdown link: [text](url)
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
        // Bare URL
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
        // Bold text: **text**
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

// === FIX #1: IMAGEN CON RETRY AUTOMÁTICO ===
// Si la imagen no carga (CDN delay, URL temporal), reintenta hasta 2 veces.
// Solo después del último retry muestra el mensaje de error.

function ImageWithRetry({ url, alt }: { url: string; alt: string }) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'retrying' | 'error'>('loading');
  const [imgSrc, setImgSrc] = useState(url);
  const retryCount = useRef(0);
  const maxRetries = 2;

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
                // Delay escalado: 2s, 4s
                const delay = retryCount.current * 2000;
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
              {status === 'retrying' ? 'Reintentando cargar imagen...' : 'Cargando imagen...'}
            </div>
          )}
        </>
      )}
    </span>
  );
}

// === COMPONENTE DE BOTONES ===

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
          Programando publicación...
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

// === COMPONENTE PRINCIPAL ===

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<number | null>(null); // index del msg con acción en curso
  const [pendingConnectionHandled, setPendingConnectionHandled] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll al último mensaje
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Mensaje de bienvenida
  useEffect(() => {
    setMessages((prev) => {
      if (prev.length === 0) {
        return [
          {
            role: 'assistant',
            content:
              '¡Bienvenido! Soy Pioneer, su asistente de marketing. ¿En qué puedo ayudarle hoy con su negocio?',
          },
        ];
      }
      return prev;
    });
  }, []);

  // === DETECTAR ?pending_connection EN LA URL ===
  useEffect(() => {
    if (pendingConnectionHandled) return;

    const urlParams = new URLSearchParams(window.location.search);
    const pendingPlatform = urlParams.get('pending_connection');

    if (pendingPlatform) {
      setPendingConnectionHandled(true);

      const newUrl = window.location.pathname;
      window.history.replaceState({}, '', newUrl);

      const platformName = getPlatformDisplayName(pendingPlatform);
      const autoMessage = `Acabo de autorizar ${platformName}.\nNecesito completar la conexión.`;

      setTimeout(() => {
        sendAutoMessage(autoMessage);
      }, 500);
    }
  }, [pendingConnectionHandled]);

  // === ENVIAR MENSAJE (compartido por sendMessage, sendAutoMessage, y botones) ===
  const sendChatMessage = async (messageText: string, currentMessages: Message[]) => {
    const userMessage: Message = { role: 'user', content: messageText };
    const newMessages = [...currentMessages, userMessage];
    setMessages(newMessages);
    setIsLoading(true);

    try {
      // Excluir welcome message del historial enviado al API
      const messagesToSend = newMessages.slice(1).map(m => ({
        role: m.role,
        content: m.content,
      }));

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: messagesToSend }),
      });

      if (!response.ok) {
        throw new Error('Error en la respuesta del servidor');
      }

      const data = await response.json();

      const assistantMessage: Message = {
        role: 'assistant',
        content: data.message,
        ...(data.buttons && { buttons: data.buttons }),
        ...(data.actionContext && { actionContext: data.actionContext }),
      };

      setMessages([...newMessages, assistantMessage]);
    } catch (error) {
      console.error('Error:', error);
      setMessages([
        ...newMessages,
        {
          role: 'assistant',
          content:
            'Lo siento, hubo un error al procesar su mensaje. Por favor, intente de nuevo.',
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const sendAutoMessage = async (messageText: string) => {
    if (isLoading) return;
    await sendChatMessage(messageText, messages);
  };

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;
    const text = input.trim();
    setInput('');
    await sendChatMessage(text, messages);
  };

  // === EJECUTAR ACCIÓN (Fase 1B — llama /api/chat/action directo) ===
  const executeAction = async (
    button: ButtonConfig,
    messageIndex: number,
    actionContext?: ActionContext
  ) => {
    setActionLoading(messageIndex);

    // Merge actionContext: el mensaje actual puede tener solo imageSpec,
    // pero un mensaje anterior puede tener content y platforms.
    // Recorrer hacia atrás y acumular datos faltantes.
    const mergedContext: ActionContext = { ...actionContext };

    for (let i = messageIndex - 1; i >= 0; i--) {
      const prevCtx = messages[i]?.actionContext;
      if (!prevCtx) continue;

      // Solo llenar campos que NO existen en el context actual
      if (!mergedContext.content && prevCtx.content) {
        mergedContext.content = prevCtx.content;
      }
      if (!mergedContext.platforms && prevCtx.platforms) {
        mergedContext.platforms = prevCtx.platforms;
      }
      if (!mergedContext.imagePrompt && prevCtx.imagePrompt) {
        mergedContext.imagePrompt = prevCtx.imagePrompt;
      }
      if (!mergedContext.imageModel && prevCtx.imageModel) {
        mergedContext.imageModel = prevCtx.imageModel;
      }
      if (!mergedContext.imageAspectRatio && prevCtx.imageAspectRatio) {
        mergedContext.imageAspectRatio = prevCtx.imageAspectRatio;
      }
      if (!mergedContext.imageCount && prevCtx.imageCount) {
        mergedContext.imageCount = prevCtx.imageCount;
      }

      // Si ya tenemos todo, parar
      if (mergedContext.content && mergedContext.platforms) break;
    }

    // Construir params desde mergedContext
    const params: Record<string, unknown> = { ...mergedContext };

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

      // Agregar mensaje de resultado como assistant message
      const resultMessage: Message = {
        role: 'assistant',
        content: data.message,
        ...(data.buttons && { buttons: data.buttons }),
        // Merge: action-handler puede devolver actionContext parcial (ej: solo imageUrls).
        // Combinarlo con mergedContext para que el próximo botón tenga todo.
        ...(data.buttons?.some((b: ButtonConfig) => b.type === 'action') && {
          actionContext: { ...mergedContext, ...(data.actionContext || {}) },
        }),
        // Si no hay action buttons pero sí hay actionContext del server, guardarlo igual
        ...(!data.buttons?.some((b: ButtonConfig) => b.type === 'action') && data.actionContext && {
          actionContext: { ...mergedContext, ...data.actionContext },
        }),
      };

      setMessages(prev => [...prev, resultMessage]);
    } catch (error) {
      console.error('Error ejecutando acción:', error);
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: '❌ Error ejecutando la acción. Por favor intente de nuevo.',
        },
      ]);
    } finally {
      setActionLoading(null);
    }
  };

  // === MANEJAR CLICK EN BOTÓN ===
  const handleButtonClick = (button: ButtonConfig, messageIndex: number) => {
    // 1. Deshabilitar TODOS los botones de este mensaje
    setMessages(prev => prev.map((msg, idx) =>
      idx === messageIndex ? { ...msg, buttonsDisabled: true } : msg
    ));

    if (button.type === 'option') {
      if (button.chatMessage === '') {
        // Botón "Otro" / "Cambios" → focus en el input de texto
        inputRef.current?.focus();
        return;
      }
      // Enviar como mensaje de chat normal
      setMessages(prev => {
        const updatedMessages = prev.map((msg, idx) =>
          idx === messageIndex ? { ...msg, buttonsDisabled: true } : msg
        );
        sendChatMessage(button.chatMessage!, updatedMessages);
        return updatedMessages;
      });
    } else if (button.type === 'action') {
      // Buscar el actionContext del mensaje que tiene los botones
      const msg = messages[messageIndex];
      executeAction(button, messageIndex, msg?.actionContext);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

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
          {messages.map((message, index) => (
            <div key={index}>
              <div
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                    message.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white border border-gray-200 text-gray-800'
                  }`}
                >
                  <MessageContent content={message.content} />
                </div>
              </div>
              {/* Botones debajo del mensaje del assistant */}
              {message.role === 'assistant' && message.buttons && message.buttons.length > 0 && (
                <div className="flex justify-start mt-1">
                  <div className="max-w-[80%]">
                    <ActionButtons
                      buttons={message.buttons}
                      disabled={!!message.buttonsDisabled || isLoading}
                      loading={actionLoading === index}
                      onButtonClick={(button) => handleButtonClick(button, index)}
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
          {isLoading && (
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
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t bg-white px-4 py-4">
        <div className="max-w-3xl mx-auto flex gap-3">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder="Escriba su mensaje..."
            className="flex-1 resize-none rounded-xl border border-gray-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            rows={1}
            disabled={isLoading}
          />
          <button
            onClick={sendMessage}
            disabled={isLoading || !input.trim()}
            className="px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}

// === HELPERS ===

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
