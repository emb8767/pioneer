'use client';

import { useState, useRef } from 'react';

// === TYPES ===
interface ActionContext {
  content?: string;
  imagePrompt?: string;
  imageModel?: string;
  imageAspectRatio?: string;
  imageCount?: number;
  imageUrls?: string[];
  platforms?: Array<{ platform: string; accountId: string }>;
}

interface ButtonConfig {
  id: string;
  label: string;
  type: 'option' | 'action';
  style: 'primary' | 'secondary' | 'ghost';
  action?: string;
  chatMessage?: string;
}

interface LogEntry {
  time: string;
  type: 'info' | 'success' | 'error' | 'action';
  message: string;
}

// === IMAGE WITH RETRY (same as main chat) ===
function ImageWithRetry({ url, alt }: { url: string; alt: string }) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'retrying' | 'error'>('loading');
  const [imgSrc, setImgSrc] = useState(url);
  const retryCount = useRef(0);

  return (
    <span className="block my-2">
      {status === 'error' ? (
        <p className="text-red-500 text-sm">⚠️ No se pudo cargar la imagen después de 2 reintentos.</p>
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imgSrc}
            alt={alt}
            className={`max-w-full rounded-lg shadow-md transition-opacity duration-300 ${status === 'loaded' ? 'opacity-100' : 'opacity-0'}`}
            style={{ maxHeight: '300px', objectFit: 'contain' }}
            onLoad={() => setStatus('loaded')}
            onError={() => {
              if (retryCount.current < 2) {
                retryCount.current += 1;
                setStatus('retrying');
                const delay = retryCount.current * 2000;
                setTimeout(() => {
                  const sep = url.includes('?') ? '&' : '?';
                  setImgSrc(`${url}${sep}_retry=${Date.now()}`);
                }, delay);
              } else {
                setStatus('error');
              }
            }}
          />
          {(status === 'loading' || status === 'retrying') && (
            <div className="flex items-center gap-2 text-gray-400 text-sm py-2">
              <div className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
              {status === 'retrying' ? `Reintentando (${retryCount.current}/2)...` : 'Cargando...'}
            </div>
          )}
        </>
      )}
    </span>
  );
}

// === MAIN TEST PAGE ===
export default function TestPage() {
  // State
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [actionContext, setActionContext] = useState<ActionContext>({});
  const [buttons, setButtons] = useState<ButtonConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [step, setStep] = useState<'idle' | 'text_generated' | 'text_approved' | 'image_generated' | 'published'>('idle');

  // Custom inputs
  const [customPrompt, setCustomPrompt] = useState('professional photograph, red sports car at a car dealership with a big red bow on top, sunny day, vibrant, no text overlay');
  const [customText, setCustomText] = useState('🚗 ¡TANQUE LLENO GRATIS con tu vehículo nuevo! Solo esta semana en Dealer El Bravo.\n\n📍 Rexville, Bayamón | 📱 787-717-7181\n\n#DealerElBravo #CarrosPR');

  const logsEndRef = useRef<HTMLDivElement>(null);

  // === HELPERS ===
  const log = (type: LogEntry['type'], message: string) => {
    const entry: LogEntry = {
      time: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      type,
      message,
    };
    setLogs(prev => [...prev, entry]);
    setTimeout(() => logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const callAction = async (action: string, params: Record<string, unknown>) => {
    setLoading(true);
    log('action', `→ ${action}`);
    const start = Date.now();

    try {
      const response = await fetch('/api/chat/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, params }),
      });

      const data = await response.json();
      const elapsed = Date.now() - start;

      if (data.success) {
        log('success', `✅ ${data.message} (${elapsed}ms)`);
      } else {
        log('error', `❌ ${data.message} (${elapsed}ms)`);
      }

      // Update context
      if (data.actionContext) {
        setActionContext(prev => ({ ...prev, ...data.actionContext }));
      }

      // Update buttons
      if (data.buttons) {
        setButtons(data.buttons);
      } else {
        setButtons([]);
      }

      return data;
    } catch (err) {
      const elapsed = Date.now() - start;
      log('error', `💥 Fetch error: ${err instanceof Error ? err.message : 'unknown'} (${elapsed}ms)`);
      return null;
    } finally {
      setLoading(false);
    }
  };

  // === STEP 1: Simulate generate_content (calls /api/chat to get text + imageSpec) ===
  const simulateGenerateContent = async () => {
    setLoading(true);
    log('action', '→ Simulando generate_content via /api/chat...');
    const start = Date.now();

    try {
      // Call the real chat API with a message that triggers generate_content
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'user', content: 'Soy Dealer El Bravo, dealer de carros usados en Rexville, Bayamón. Teléfono 787-717-7181. Genera un post promocional para Facebook sobre tanque lleno gratis con la compra de un vehículo, válido esta semana.' },
          ],
        }),
      });

      const data = await response.json();
      const elapsed = Date.now() - start;

      log('success', `Claude respondió (${elapsed}ms)`);

      if (data.actionContext) {
        setActionContext(data.actionContext);
        log('info', `ActionContext: content=${!!data.actionContext.content}, imagePrompt=${!!data.actionContext.imagePrompt}`);

        if (data.actionContext.content) {
          setCustomText(data.actionContext.content);
        }
        if (data.actionContext.imagePrompt) {
          setCustomPrompt(data.actionContext.imagePrompt);
        }
      }

      if (data.buttons) {
        setButtons(data.buttons);
        log('info', `Botones: ${data.buttons.map((b: ButtonConfig) => b.label).join(', ')}`);
      }

      setStep('text_generated');
    } catch (err) {
      log('error', `💥 ${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      setLoading(false);
    }
  };

  // === STEP 1b: Use custom text (skip Claude) ===
  const useCustomText = () => {
    const ctx: ActionContext = {
      content: customText,
      imagePrompt: customPrompt,
      imageModel: 'schnell',
      imageAspectRatio: '1:1',
      imageCount: 1,
    };
    setActionContext(ctx);
    setStep('text_generated');
    setButtons([
      { id: 'approve_text', label: '✅ Me gusta', type: 'action', style: 'primary', action: 'approve_text' },
      { id: 'change_text', label: '✏️ Pedir cambios', type: 'action', style: 'ghost' },
    ]);
    log('info', 'Texto y prompt custom cargados. Listo para aprobar.');
  };

  // === STEP 2: Approve text ===
  const approveText = async () => {
    const data = await callAction('approve_text', {
      content: actionContext.content || customText,
      imagePrompt: actionContext.imagePrompt || customPrompt,
      imageModel: actionContext.imageModel || 'schnell',
      imageAspectRatio: actionContext.imageAspectRatio || '1:1',
      imageCount: actionContext.imageCount || 1,
      platforms: actionContext.platforms,
    });
    if (data?.success) setStep('text_approved');
  };

  // === STEP 3: Generate image ===
  const generateImage = async () => {
    const data = await callAction('generate_image', {
      content: actionContext.content || customText,
      imagePrompt: actionContext.imagePrompt || customPrompt,
      imageModel: actionContext.imageModel || 'schnell',
      imageAspectRatio: actionContext.imageAspectRatio || '1:1',
      imageCount: actionContext.imageCount || 1,
      platforms: actionContext.platforms,
    });
    if (data?.success && data.actionContext?.imageUrls) {
      setImageUrls(data.actionContext.imageUrls as string[]);
      setActionContext(prev => ({ ...prev, imageUrls: data.actionContext.imageUrls as string[] }));
      setStep('image_generated');
    }
  };

  // === STEP 4: Publish ===
  const publishPost = async (withImage: boolean) => {
    const data = await callAction(withImage ? 'approve_and_publish' : 'publish_no_image', {
      content: actionContext.content || customText,
      imageUrls: withImage ? (actionContext.imageUrls || imageUrls) : [],
      platforms: actionContext.platforms,
    });
    if (data?.success) setStep('published');
  };

  // === STEP 3b: Regenerate image ===
  const regenerateImage = async () => {
    setImageUrls([]);
    const data = await callAction('regenerate_image', {
      content: actionContext.content || customText,
      imagePrompt: actionContext.imagePrompt || customPrompt,
      imageModel: actionContext.imageModel || 'schnell',
      imageAspectRatio: actionContext.imageAspectRatio || '1:1',
      imageCount: actionContext.imageCount || 1,
      platforms: actionContext.platforms,
    });
    if (data?.success && data.actionContext?.imageUrls) {
      setImageUrls(data.actionContext.imageUrls as string[]);
      setActionContext(prev => ({ ...prev, imageUrls: data.actionContext.imageUrls as string[] }));
      setStep('image_generated');
    }
  };

  // === RESET ===
  const reset = () => {
    setLogs([]);
    setActionContext({});
    setButtons([]);
    setImageUrls([]);
    setStep('idle');
    setLoading(false);
  };

  // === RENDER ===
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">🧪 Pioneer Test Lab</h1>
            <p className="text-gray-400 text-sm mt-1">Prueba el pipeline: Texto → Imagen → Publicar — sin entrevista</p>
          </div>
          <div className="flex gap-3">
            <a href="/chat" className="px-4 py-2 text-sm bg-gray-800 text-gray-300 rounded-lg hover:bg-gray-700">
              ← Chat real
            </a>
            <button onClick={reset} className="px-4 py-2 text-sm bg-red-900/50 text-red-300 rounded-lg hover:bg-red-900/70">
              🔄 Reset
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* LEFT COLUMN — Controls */}
          <div className="space-y-4">
            {/* Step indicator */}
            <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
              <div className="flex items-center gap-3 text-sm">
                {['idle', 'text_generated', 'text_approved', 'image_generated', 'published'].map((s, i) => {
                  const labels = ['🔵 Inicio', '📝 Texto', '✅ Aprobado', '🖼️ Imagen', '🚀 Publicado'];
                  const isActive = step === s;
                  const isPast = ['idle', 'text_generated', 'text_approved', 'image_generated', 'published'].indexOf(step) > i;
                  return (
                    <div key={s} className="flex items-center gap-2">
                      <span className={`px-2 py-1 rounded text-xs font-mono ${isActive ? 'bg-blue-600 text-white' : isPast ? 'bg-green-900/50 text-green-400' : 'bg-gray-800 text-gray-500'}`}>
                        {labels[i]}
                      </span>
                      {i < 4 && <span className="text-gray-600">→</span>}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Custom inputs */}
            <div className="bg-gray-900 rounded-xl p-4 border border-gray-800 space-y-3">
              <h3 className="text-sm font-semibold text-gray-300">Texto del post</h3>
              <textarea
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                rows={4}
                className="w-full bg-gray-800 text-gray-100 rounded-lg p-3 text-sm border border-gray-700 focus:border-blue-500 focus:outline-none resize-none"
              />

              <h3 className="text-sm font-semibold text-gray-300">Prompt de imagen (inglés)</h3>
              <textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                rows={2}
                className="w-full bg-gray-800 text-gray-100 rounded-lg p-3 text-sm border border-gray-700 focus:border-blue-500 focus:outline-none resize-none"
              />
            </div>

            {/* Action buttons */}
            <div className="bg-gray-900 rounded-xl p-4 border border-gray-800 space-y-3">
              <h3 className="text-sm font-semibold text-gray-300">Acciones</h3>

              {/* Row 1: Generate text */}
              <div className="flex gap-2">
                <button
                  onClick={simulateGenerateContent}
                  disabled={loading}
                  className="flex-1 px-4 py-2.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  🤖 Claude genera texto + prompt
                </button>
                <button
                  onClick={useCustomText}
                  disabled={loading}
                  className="flex-1 px-4 py-2.5 text-sm bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600 disabled:opacity-50"
                >
                  📝 Usar texto custom
                </button>
              </div>

              {/* Row 2: Approve text */}
              <button
                onClick={approveText}
                disabled={loading || step === 'idle'}
                className="w-full px-4 py-2.5 text-sm bg-green-700 text-white rounded-lg hover:bg-green-600 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                ✅ Aprobar texto (approve_text action)
              </button>

              {/* Row 3: Image actions */}
              <div className="flex gap-2">
                <button
                  onClick={generateImage}
                  disabled={loading || (step !== 'text_approved' && step !== 'image_generated')}
                  className="flex-1 px-4 py-2.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  🎨 Generar imagen
                </button>
                <button
                  onClick={regenerateImage}
                  disabled={loading || step !== 'image_generated'}
                  className="flex-1 px-4 py-2.5 text-sm bg-amber-700 text-white rounded-lg hover:bg-amber-600 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  🔄 Regenerar imagen
                </button>
              </div>

              {/* Row 4: Publish */}
              <div className="flex gap-2">
                <button
                  onClick={() => publishPost(true)}
                  disabled={loading || step !== 'image_generated'}
                  className="flex-1 px-4 py-2.5 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  👍 Publicar con imagen
                </button>
                <button
                  onClick={() => publishPost(false)}
                  disabled={loading || (step !== 'text_approved' && step !== 'text_generated' && step !== 'image_generated')}
                  className="flex-1 px-4 py-2.5 text-sm bg-gray-600 text-white rounded-lg hover:bg-gray-500 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  ⭕ Publicar sin imagen
                </button>
              </div>

              {/* Loading indicator */}
              {loading && (
                <div className="flex items-center gap-2 text-blue-400 text-sm">
                  <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                  Ejecutando...
                </div>
              )}
            </div>

            {/* Image preview */}
            {imageUrls.length > 0 && (
              <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
                <h3 className="text-sm font-semibold text-gray-300 mb-2">Imagen generada</h3>
                {imageUrls.map((url, i) => (
                  <div key={i}>
                    <ImageWithRetry url={url} alt={`Imagen ${i + 1}`} />
                    <p className="text-xs text-gray-500 break-all mt-1">{url}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Dynamic buttons from server */}
            {buttons.length > 0 && (
              <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
                <h3 className="text-sm font-semibold text-gray-300 mb-2">Botones del servidor</h3>
                <div className="flex flex-wrap gap-2">
                  {buttons.map(b => (
                    <span key={b.id} className="px-3 py-1 text-xs rounded-full bg-gray-800 text-gray-400 border border-gray-700">
                      {b.label} ({b.type}{b.action ? `: ${b.action}` : ''})
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* RIGHT COLUMN — Logs */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 flex flex-col" style={{ maxHeight: '85vh' }}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
              <h3 className="text-sm font-semibold text-gray-300">📋 Logs</h3>
              <button onClick={() => setLogs([])} className="text-xs text-gray-500 hover:text-gray-300">
                Limpiar
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1 font-mono text-xs">
              {logs.length === 0 ? (
                <p className="text-gray-600 text-center py-8">Los logs aparecen aquí...</p>
              ) : (
                logs.map((entry, i) => {
                  const colors = {
                    info: 'text-gray-400',
                    success: 'text-green-400',
                    error: 'text-red-400',
                    action: 'text-blue-400',
                  };
                  return (
                    <div key={i} className={`${colors[entry.type]} leading-relaxed`}>
                      <span className="text-gray-600">{entry.time}</span> {entry.message}
                    </div>
                  );
                })
              )}
              <div ref={logsEndRef} />
            </div>

            {/* ActionContext inspector */}
            <div className="border-t border-gray-800 px-4 py-3">
              <h4 className="text-xs font-semibold text-gray-500 mb-1">ActionContext</h4>
              <div className="text-xs font-mono text-gray-500 space-y-0.5">
                <div>content: {actionContext.content ? `"${actionContext.content.substring(0, 50)}..."` : 'null'}</div>
                <div>imagePrompt: {actionContext.imagePrompt ? `"${actionContext.imagePrompt.substring(0, 50)}..."` : 'null'}</div>
                <div>imageUrls: {actionContext.imageUrls ? `[${actionContext.imageUrls.length}]` : 'null'}</div>
                <div>platforms: {actionContext.platforms ? `[${actionContext.platforms.length}]` : 'null (auto-detect)'}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
