'use client';

import { useState, useRef, useEffect } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
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
    // Group 1,2: Markdown image ![alt](url)
    // Group 3: Bare image URL (replicate.delivery, media.getlate.dev, or common image extensions)
    // Group 4,5: Markdown link [text](url)
    // Group 6: Bare URL (any https://...)
    // Group 7: Bold **text**
    const combinedRegex = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)|(https:\/\/replicate\.delivery\/[^\s)]+|https:\/\/media\.getlate\.dev\/[^\s)]+|https?:\/\/[^\s)]+\.(?:webp|png|jpg|jpeg|gif))|\[([^\]]+)\]\((https?:\/\/[^)]+)\)|(https?:\/\/[^\s)]+)|\*\*([^*]+)\*\*/g;

    let lastIndex = 0;
    let match;

    while ((match = combinedRegex.exec(line)) !== null) {
      // Add text before the match
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
          <span key={`img-${lineIdx}-${match.index}`} className="block my-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={alt}
              className="max-w-full rounded-lg shadow-md"
              style={{ maxHeight: '400px', objectFit: 'contain' }}
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.style.display = 'none';
                const fallback = document.createElement('p');
                fallback.textContent = '⚠️ No se pudo cargar la imagen. La URL puede haber expirado.';
                fallback.className = 'text-amber-600 text-sm mt-1';
                target.parentElement?.appendChild(fallback);
              }}
            />
          </span>
        );
      } else if (match[3]) {
        // Bare image URL (replicate.delivery, media.getlate.dev, or image extension)
        const url = match[3];
        parts.push(
          <span key={`bareimg-${lineIdx}-${match.index}`} className="block my-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt="Imagen generada"
              className="max-w-full rounded-lg shadow-md"
              style={{ maxHeight: '400px', objectFit: 'contain' }}
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.style.display = 'none';
                const fallback = document.createElement('p');
                fallback.textContent = '⚠️ No se pudo cargar la imagen. La URL puede haber expirado.';
                fallback.className = 'text-amber-600 text-sm mt-1';
                target.parentElement?.appendChild(fallback);
              }}
            />
          </span>
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
        // Bare URL — make clickable
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

    // Add remaining text after last match
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

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [pendingConnectionHandled, setPendingConnectionHandled] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll al último mensaje
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Mensaje de bienvenida
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        {
          role: 'assistant',
          content:
            '¡Bienvenido! Soy Pioneer, su asistente de marketing. ¿En qué puedo ayudarle hoy con su negocio?',
        },
      ]);
    }
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
      const autoMessage = `Acabo de autorizar ${platformName}.
Necesito completar la conexión.`;

      setTimeout(() => {
        sendAutoMessage(autoMessage);
      }, 500);
    }
  }, [pendingConnectionHandled]);

  const sendAutoMessage = async (messageText: string) => {
    if (isLoading) return;

    const userMessage: Message = { role: 'user', content: messageText };
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const messagesToSend = [{ role: 'user', content: messageText }];

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: messagesToSend }),
      });

      if (!response.ok) {
        throw new Error('Error en la respuesta del servidor');
      }

      const data = await response.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.message }]);
    } catch (error) {
      console.error('Error:', error);
      setMessages(prev => [
        ...prev,
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

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = { role: 'user', content: input.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    try {
      const messagesToSend = newMessages.slice(1);
      
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: messagesToSend }),
      });

      if (!response.ok) {
        throw new Error('Error en la respuesta del servidor');
      }

      const data = await response.json();
      setMessages([...newMessages, { role: 'assistant', content: data.message }]);
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
            <div
              key={index}
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
