import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';

// === IMPORTS DIRECTOS (fix para Vercel serverless) ===
// En vez de hacer fetch HTTP a /api/social y /api/content,
// importamos las funciones directamente para evitar que una
// función serverless se llame a sí misma via HTTP.
import {
  listAccounts,
  getConnectUrl,
  createPost,
  getNextOptimalTime,
  PR_TIMEZONE,
  LateApiError,
  // Headless OAuth functions
  isHeadlessPlatform,
  getFacebookPages,
  getLinkedInPendingData,
  saveLinkedInOrganization,
  saveFacebookPage,
  getPinterestBoards,
  savePinterestBoard,
  getGoogleBusinessLocations,
  saveGoogleBusinessLocation,
  saveSnapchatProfile,
} from '@/lib/late-client';
import { generateContent, PLATFORM_CHAR_LIMITS } from '@/lib/content-generator';
import { generateImage, suggestAspectRatio, buildImagePrompt } from '@/lib/replicate-client';
import { getOAuthCookie, COOKIE_NAME } from '@/lib/oauth-cookie';
import type { OAuthPendingData } from '@/lib/oauth-cookie';
import type { Platform, LatePlatformTarget } from '@/lib/types';

// Inicializar cliente de Anthropic
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// === FECHA ACTUAL PARA SYSTEM PROMPT ===
function getCurrentDateForPrompt(): string {
  return new Date().toLocaleString('es-PR', {
    timeZone: 'America/Puerto_Rico',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// === DETECCIÓN DE ALUCINACIÓN DE PUBLICACIÓN ===
// Detecta si Claude dice que publicó pero no llamó publish_post
const PUBLISH_HALLUCINATION_PATTERNS = [
  /publicado exitosamente/i,
  /publicado con éxito/i,
  /publicación exitosa/i,
  /✅.*publicado/i,
  /post publicado/i,
  /se ha publicado/i,
  /fue publicado/i,
  /publicamos exitosamente/i,
  /published successfully/i,
];

function detectPublishHallucination(text: string, publishPostCount: number): boolean {
  if (publishPostCount > 0) return false; // publish_post was actually called
  return PUBLISH_HALLUCINATION_PATTERNS.some((pattern) => pattern.test(text));
}

// === SYSTEM PROMPT v5 — CON OAUTH HEADLESS ===
function buildSystemPrompt(): string {
  const fechaActual = getCurrentDateForPrompt();

  return `Eres Pioneer, un asistente de marketing digital para pequeños negocios en Puerto Rico.

Fecha y hora actual: ${fechaActual}

=== IDENTIDAD ===
- Nombre: Pioneer
- Rol: Estratega de marketing que reemplaza a un especialista humano
- Idioma: Español formal (siempre "usted")
- Tono: Amigable, profesional, directo
- Si preguntan, admitir que es un asistente de IA
- No dar consejos legales, médicos o financieros
- No prometer resultados específicos

=== REGLA DE ACCIÓN ===
Si el cliente da suficiente información para actuar (qué negocio tiene + qué quiere + para qué plataforma), PROCEDE a crear el plan o ejecutar. No hagas preguntas innecesarias.

Solo pregunta cuando FALTA información esencial que no puedes asumir razonablemente. Máximo 2-3 preguntas, nunca 6.

=== CONTENIDO PROHIBIDO ===
Rechazar solicitudes de: pornografía, drogas, armas, apuestas, alcohol (como producto), tabaco/vape, criptomonedas/trading, campañas políticas, actividades ilegales.

Respuesta: "Lo siento, no puedo ayudarle con ese tipo de contenido ya que está fuera de las políticas de Pioneer. Contacte info@pioneeragt.com si tiene preguntas."

=== MOTOR ESTRATÉGICO ===

Cuando el cliente exprese un objetivo:
1. Clasificar: ventas, clientes nuevos, crecimiento redes, promoción específica, visitas al local, branding
2. Si falta info esencial, preguntar (máximo 2-3 preguntas)
3. Generar plan con: nombre, duración, canales, acciones numeradas, costo desglosado (orgánico y con ads)
4. Pedir aprobación

Formato de plan:
📋 **Plan: [Nombre]**
⏱ Duración: [X] días
📱 Canales: [plataformas]
**Acciones:**
1. [Acción] (Día X)
**Costo estimado:**
- [Servicio]: $X.XX
- **Total (orgánico): $X.XX**
- **Total (con ads): $X.XX** *(opcional)*
¿Desea aprobar este plan?

Costos de referencia (markup 500%):
- Texto: $0.01 | Imagen schnell: $0.015 | Imagen pro: $0.275
- Email: $0.005 | Publicación: incluido | Ads: según presupuesto

Horarios óptimos PR (America/Puerto_Rico, UTC-4):
- Lun-Vie: 12:00 PM o 7:00 PM
- Sáb-Dom: 10:00 AM o 1:00 PM

=== REGLA CRÍTICA DE PUBLICACIÓN ===

⚠️ PROHIBICIÓN ABSOLUTA: NUNCA digas "publicado exitosamente" o confirmes una publicación sin haber llamado la tool publish_post.

Para publicar un post, DEBES seguir estos pasos EN ORDEN:
1. Llamar la tool publish_post con el contenido y plataformas
2. Esperar el resultado de la tool
3. SOLO si el resultado dice success:true, confirmar al cliente

Si el cliente dice "sí" o "publícalo", tu ÚNICA respuesta válida es LLAMAR la tool publish_post. NO generes texto de confirmación sin llamar la tool primero.

Esto aplica igual para "programado". No confirmes programación sin llamar publish_post.

=== EJECUCIÓN — UN POST A LA VEZ ===

Cuando un plan es aprobado, ejecuta UN POST a la vez siguiendo este flujo exacto:

PASO 1: Verificar cuentas conectadas (list_connected_accounts)
PASO 2: Generar texto del post (generate_content)
PASO 3: Mostrar texto al cliente y preguntar: "¿Desea acompañar este post con una imagen AI ($0.015) o publicar solo con texto?"
PASO 4: Si quiere imagen → llamar generate_image → mostrar URL de la imagen al cliente
PASO 5: Pedir aprobación explícita del post completo (texto + imagen si la hay)
PASO 6: Solo con aprobación explícita → LLAMAR publish_post (NO generar confirmación sin llamar la tool)
PASO 7: Confirmar publicación basándote en el resultado REAL de publish_post → preguntar: "¿Continuamos con el siguiente post del plan?"

REGLA IMPORTANTE SOBRE IMÁGENES: Cuando el cliente aprueba un post con imagen y dice "publícalo", usa la MISMA URL de imagen que ya generaste y mostraste. NO llames generate_image de nuevo. La URL de replicate.delivery que ya obtuviste sigue siendo válida por 1 hora.

Cada post requiere su propia aprobación. El cliente responde entre cada post.
Si el plan tiene posts para días futuros, usar scheduled_for con la fecha del plan.
Solo puedes publicar 1 post por mensaje. Para el siguiente post, espera un nuevo mensaje del cliente.

Frases que cuentan como aprobación: "Sí, publícalo", "Aprobado", "Dale, publica", "Perfecto, adelante", "si"
Frases ambiguas ("Se ve bien", "Ok", "Interesante") → preguntar: "¿Desea que publique este contenido?"

Cuando el cliente aprueba, tu respuesta DEBE incluir un tool_use block para publish_post. NO respondas solo con texto.

=== CONEXIÓN DE REDES SOCIALES (OAuth) ===

Tienes 2 tools para manejar la conexión de cuentas de redes sociales:

**Flujo para plataformas SIMPLES** (Twitter, TikTok, YouTube, Threads, Reddit):
1. Usa generate_connect_url → devuelve un authUrl
2. Muestra el enlace al cliente: "Abra este enlace para conectar su cuenta: [authUrl]"
3. El cliente autoriza → regresa al chat → la cuenta queda conectada automáticamente
4. Verificar con list_connected_accounts

**Flujo para plataformas HEADLESS** (Facebook, Instagram, LinkedIn, Pinterest, Google Business, Snapchat):
Estas plataformas requieren un paso adicional de selección (página, organización, board, ubicación).

1. Usa generate_connect_url → devuelve authUrl (el modo headless se activa automáticamente)
2. Muestra el enlace al cliente
3. El cliente autoriza → regresa al chat → verás un mensaje automático: "Acabo de autorizar [plataforma]..."
4. Cuando veas ese mensaje, INMEDIATAMENTE llama get_pending_connection
5. get_pending_connection devuelve las opciones disponibles (páginas, organizaciones, etc.)
6. Muestra las opciones al cliente en una lista numerada
7. El cliente selecciona una opción (ej: "la número 1", "Mi Panadería")
8. Llama complete_connection con el selection_id de la opción elegida
9. Confirma la conexión al cliente

**LinkedIn tiene un caso especial:**
- get_pending_connection puede devolver _linkedin_data en la respuesta
- Cuando llames complete_connection para LinkedIn, DEBES incluir ese _linkedin_data tal cual
- Esto es porque el token de LinkedIn es de un solo uso y ya fue consumido al obtener opciones

**Bluesky** (sin OAuth): Pedir handle + App Password, usar generate_connect_url con esos datos.
**Telegram** (sin OAuth): Pedir bot token al cliente.

**Reglas de conexión:**
- Si el mensaje del cliente contiene "Acabo de autorizar" o "pending_connection", llama get_pending_connection INMEDIATAMENTE
- Los tokens de autorización expiran en 10 minutos — actúa rápido
- Si get_pending_connection dice "expired" o no hay conexión pendiente, pedir al cliente que intente conectar de nuevo
- NUNCA asumas que una cuenta está conectada — siempre verifica con list_connected_accounts

=== TOOLS ===

Tienes 7 herramientas:

1. **list_connected_accounts** — Verificar redes conectadas. Usar ANTES de proponer plan o publicar.
2. **generate_connect_url** — Generar enlace OAuth para conectar red social. Para plataformas headless (Facebook, Instagram, LinkedIn, Pinterest, Google Business, Snapchat), el modo headless se activa automáticamente.
3. **generate_content** — Generar texto de post por plataforma. Usar después de aprobación del plan.
4. **generate_image** — Generar imagen AI (FLUX). Prompt en INGLÉS. Devuelve URL real (https://replicate.delivery/...). Incluir "no text overlay" en prompt.
5. **publish_post** — Publicar o programar post. DEBES llamar esta tool para publicar. NUNCA confirmes publicación sin haberla llamado.
6. **get_pending_connection** — Obtener opciones de selección para conexión headless (páginas de Facebook, organizaciones de LinkedIn, boards de Pinterest, ubicaciones de Google Business, perfiles de Snapchat). Llamar INMEDIATAMENTE cuando el cliente regresa de autorizar una plataforma headless.
7. **complete_connection** — Guardar la selección del cliente para completar una conexión headless. Llamar después de que el cliente elige una opción de get_pending_connection.

Sobre imágenes:
- Para incluir imagen en un post, PRIMERO llamar generate_image para obtener URL real
- Usar esa URL real en media_urls de publish_post
- Schnell es default ($0.015). Pro solo si el cliente pide mejor calidad ($0.275)
- Aspect ratio: Instagram 4:5, Facebook 1:1, Twitter 16:9, TikTok 9:16. Multi-plataforma: 1:1
- Las URLs expiran en 1 hora — publicar pronto después de generar
- Si el cliente quiere su propia foto: "La función de subir fotos estará disponible próximamente. Puedo generar una imagen AI o publicar solo con texto."
- Si el resultado de generate_image incluye _note_for_pioneer con "regenerated", informa al cliente que la primera imagen no fue accesible y se regeneró, con el costo total actualizado.
- NUNCA llames generate_image dos veces para el mismo post. Si ya generaste una imagen y el cliente la aprobó, usa esa misma URL en publish_post.

=== TIPOS DE CONTENIDO ===

8 tipos: oferta, educativo, testimonio, detrás de escenas, urgencia, CTA, branding, interactivo.

Reglas: español estilo PR, emojis moderados (1-3), adaptar al límite de cada plataforma, hashtags locales + industria, CTA claro en cada post.

=== CONFIRMACIÓN DE PUBLICACIÓN ===

SOLO después de recibir resultado exitoso de publish_post, confirmar:
✅ Publicado exitosamente
- Plataforma: [nombre]
- Estado: Publicado / Programado para [fecha]
- Imagen: Incluida / Sin imagen

=== ONBOARDING ===

Si es cliente nuevo, recoger en conversación: nombre del negocio, tipo, redes sociales actuales, objetivo principal. No hacer formularios largos — recoger naturalmente.

=== ESCALAMIENTO ===

Si no puedes hacer algo, dirigir a info@pioneeragt.com.`;
}

// === DEFINICIÓN DE TOOLS PARA CLAUDE API ===

const PIONEER_TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_connected_accounts',
    description:
      'Lista las cuentas de redes sociales conectadas del cliente. Úsala para verificar qué plataformas tiene disponibles antes de proponer un plan o publicar contenido.',
    input_schema: {
      type: 'object' as const,
      properties: {
        profile_id: {
          type: 'string',
          description:
            'ID del perfil del cliente en Late.dev. Si no se proporciona, usa el perfil por defecto.',
        },
      },
      required: [],
    },
  },
  {
    name: 'generate_connect_url',
    description:
      'Genera un enlace OAuth para conectar una red social del cliente. El cliente debe abrir este enlace en su navegador para autorizar la conexión. Para plataformas headless (Facebook, Instagram, LinkedIn, Pinterest, Google Business, Snapchat), el modo headless se activa automáticamente y el cliente será redirigido al chat para completar la selección.',
    input_schema: {
      type: 'object' as const,
      properties: {
        platform: {
          type: 'string',
          enum: [
            'facebook',
            'instagram',
            'linkedin',
            'twitter',
            'tiktok',
            'youtube',
            'threads',
            'reddit',
            'pinterest',
            'bluesky',
            'googlebusiness',
            'telegram',
            'snapchat',
          ],
          description: 'La plataforma de red social a conectar',
        },
        profile_id: {
          type: 'string',
          description: 'ID del perfil del cliente en Late.dev',
        },
      },
      required: ['platform', 'profile_id'],
    },
  },
  {
    name: 'generate_content',
    description:
      'Genera el texto de un post de redes sociales adaptado a las plataformas del cliente. Úsala después de que el cliente aprueba un plan de marketing, para crear el contenido antes de publicar.',
    input_schema: {
      type: 'object' as const,
      properties: {
        business_name: {
          type: 'string',
          description: 'Nombre del negocio del cliente',
        },
        business_type: {
          type: 'string',
          description: 'Tipo de negocio (restaurante, tienda, salón, etc.)',
        },
        post_type: {
          type: 'string',
          enum: [
            'offer',
            'educational',
            'testimonial',
            'behind-scenes',
            'urgency',
            'cta',
            'branding',
            'interactive',
          ],
          description: 'Tipo de post a generar',
        },
        details: {
          type: 'string',
          description:
            'Detalles específicos del post (qué promocionar, qué tema, etc.)',
        },
        platforms: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'facebook',
              'instagram',
              'linkedin',
              'twitter',
              'tiktok',
              'youtube',
              'threads',
              'reddit',
              'pinterest',
              'bluesky',
              'googlebusiness',
              'telegram',
              'snapchat',
            ],
          },
          description: 'Plataformas para las que generar contenido',
        },
        tone: {
          type: 'string',
          enum: ['professional', 'casual', 'excited', 'informative', 'urgent'],
          description: 'Tono del contenido',
        },
        include_hashtags: {
          type: 'boolean',
          description: 'Si incluir hashtags relevantes para PR',
        },
      },
      required: [
        'business_name',
        'business_type',
        'post_type',
        'details',
        'platforms',
      ],
    },
  },
  {
    name: 'generate_image',
    description:
      'Genera una imagen con inteligencia artificial (FLUX) para acompañar un post de redes sociales. Úsala cuando el cliente acepta tener una imagen AI, o cuando pide una imagen directamente. El prompt DEBE ser en inglés. Devuelve una URL real (https://replicate.delivery/...) que se puede usar en media_urls de publish_post. Las URLs expiran en 1 hora — publicar pronto después de generar. NO llames esta tool si ya generaste una imagen para este post — reutiliza la URL existente.',
    input_schema: {
      type: 'object' as const,
      properties: {
        prompt: {
          type: 'string',
          description:
            'Descripción de la imagen a generar. DEBE ser en inglés. Ejemplo: "professional photograph, fresh artisan bread on rustic wooden table, warm lighting, bakery, appetizing, no text overlay"',
        },
        model: {
          type: 'string',
          enum: ['schnell', 'pro'],
          description:
            'Modelo a usar. schnell ($0.015) = rápido y económico (default). pro ($0.275) = mejor calidad.',
        },
        aspect_ratio: {
          type: 'string',
          enum: ['1:1', '16:9', '21:9', '2:3', '3:2', '4:5', '5:4', '9:16', '9:21'],
          description:
            'Proporción de la imagen. Usar 4:5 para Instagram, 1:1 para Facebook, 16:9 para Twitter, 9:16 para TikTok. Si es para múltiples plataformas, usar 1:1.',
        },
        num_outputs: {
          type: 'number',
          description: 'Número de imágenes a generar (1-4). Default: 1.',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'publish_post',
    description:
      'Publica o programa un post en las redes sociales del cliente. OBLIGATORIO llamar esta tool para publicar — NUNCA confirmes una publicación sin haberla llamado. Puede publicar inmediatamente o programar para una fecha futura. Si incluyes media_urls, usa URLs reales de replicate.delivery obtenidas de generate_image (pueden ser del mensaje actual o de un mensaje anterior en la conversación).',
    input_schema: {
      type: 'object' as const,
      properties: {
        content: {
          type: 'string',
          description: 'El texto del post a publicar',
        },
        platforms: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              platform: {
                type: 'string',
                enum: [
                  'facebook',
                  'instagram',
                  'linkedin',
                  'twitter',
                  'tiktok',
                  'youtube',
                  'threads',
                  'reddit',
                  'pinterest',
                  'bluesky',
                  'googlebusiness',
                  'telegram',
                  'snapchat',
                ],
              },
              account_id: {
                type: 'string',
                description: 'ID de la cuenta conectada en Late.dev',
              },
            },
            required: ['platform', 'account_id'],
          },
          description:
            'Lista de plataformas y sus account IDs donde publicar',
        },
        publish_now: {
          type: 'boolean',
          description:
            'Si es true, publica inmediatamente. Si es false, debe proporcionar scheduled_for.',
        },
        scheduled_for: {
          type: 'string',
          description:
            'Fecha y hora para programar la publicación en formato ISO 8601 (ej: 2026-02-10T12:00:00)',
        },
        timezone: {
          type: 'string',
          description: 'Zona horaria para la programación',
        },
        media_urls: {
          type: 'array',
          items: { type: 'string' },
          description:
            'URLs de imágenes o videos a incluir en el post. Usar URLs reales de replicate.delivery obtenidas de generate_image.',
        },
      },
      required: ['content', 'platforms'],
    },
  },
  // === NUEVAS TOOLS: OAuth Headless ===
  {
    name: 'get_pending_connection',
    description:
      'Obtiene las opciones de selección para completar una conexión de red social headless (Facebook, Instagram, LinkedIn, Pinterest, Google Business, Snapchat). Llámala INMEDIATAMENTE cuando el cliente regresa de autorizar una plataforma headless (verás un mensaje como "Acabo de autorizar [plataforma]. Necesito completar la conexión."). Devuelve las páginas, organizaciones, boards, ubicaciones o perfiles disponibles para que el cliente elija.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'complete_connection',
    description:
      'Completa una conexión headless guardando la selección del cliente (la página, organización, board, ubicación o perfil que eligió). Llámala después de que el cliente selecciona una opción de las devueltas por get_pending_connection. Para LinkedIn, DEBES incluir _linkedin_data si fue devuelto por get_pending_connection.',
    input_schema: {
      type: 'object' as const,
      properties: {
        platform: {
          type: 'string',
          enum: ['facebook', 'instagram', 'linkedin', 'pinterest', 'googlebusiness', 'snapchat'],
          description: 'La plataforma para la que se completa la conexión',
        },
        selection_id: {
          type: 'string',
          description: 'El ID de la opción seleccionada por el cliente (page ID, organization ID, board ID, location ID, o profile ID)',
        },
        selection_name: {
          type: 'string',
          description: 'El nombre de la opción seleccionada (para confirmación al cliente)',
        },
        _linkedin_data: {
          type: 'object',
          description: 'Datos de LinkedIn devueltos por get_pending_connection. OBLIGATORIO para LinkedIn porque el token es de un solo uso.',
          properties: {
            tempToken: { type: 'string' },
            userProfile: { type: 'object' },
            organizations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  urn: { type: 'string' },
                  name: { type: 'string' },
                },
              },
            },
          },
        },
      },
      required: ['platform', 'selection_id'],
    },
  },
];

// === LIMPIAR MARKDOWN PARA REDES SOCIALES ===
// Facebook, Instagram, etc. no renderizan markdown — los ** se muestran como asteriscos
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*\*(.*?)\*\*\*/g, '$1')   // ***bold italic*** → text
    .replace(/\*\*(.*?)\*\*/g, '$1')        // **bold** → text
    .replace(/\*(.*?)\*/g, '$1')            // *italic* → text
    .replace(/~~(.*?)~~/g, '$1')            // ~~strikethrough~~ → text
    .replace(/`(.*?)`/g, '$1')              // `code` → text
    .replace(/^#{1,6}\s+/gm, '')            // ### headers → text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // [link](url) → link text
}

// === VALIDACIÓN PREVENTIVA PARA PUBLISH_POST ===

interface ValidatedPublishData {
  content: string;
  platforms: LatePlatformTarget[];
  publishNow?: boolean;
  scheduledFor?: string;
  timezone?: string;
  mediaItems?: Array<{ type: 'image' | 'video'; url: string }>;
}

interface ValidationResult {
  success: boolean;
  data?: ValidatedPublishData;
  error?: string;
  corrections?: string[];
}

async function validateAndPreparePublish(
  input: {
    content: string;
    platforms: Array<{ platform: string; account_id: string }>;
    publish_now?: boolean;
    scheduled_for?: string;
    timezone?: string;
    media_urls?: string[];
  },
  generateImageWasCalled: boolean
): Promise<ValidationResult> {
  const corrections: string[] = [];

  // --- 0. Validar media_urls vs generate_image tracking ---
  if (input.media_urls?.length && !generateImageWasCalled) {
    const allFromReplicate = input.media_urls.every(url =>
      url.startsWith('https://replicate.delivery/')
    );
    if (!allFromReplicate) {
      return {
        success: false,
        error: 'ERROR: Se incluyeron media_urls con URLs no válidas. Las URLs de imágenes deben ser de replicate.delivery (obtenidas via generate_image). Llama la tool generate_image PRIMERO para obtener una URL real.',
        corrections: ['media_urls rechazadas: URLs no son de replicate.delivery y generate_image no fue llamada en esta sesión'],
      };
    }
    corrections.push('media_urls de replicate.delivery aceptadas de request anterior (generate_image no fue llamada en este request)');
  }

  // --- 1. Limpiar markdown del contenido ---
  const cleanContent = stripMarkdown(input.content);

  // --- 2. Obtener cuentas reales de Late.dev ---
  let realAccounts: Array<{ _id: string; platform: string; username?: string }>;
  try {
    const accountsResult = await listAccounts();
    realAccounts = accountsResult.accounts;
  } catch (error) {
    return {
      success: false,
      error: `No se pudieron verificar las cuentas conectadas: ${error instanceof Error ? error.message : 'Error desconocido'}`,
    };
  }

  if (realAccounts.length === 0) {
    return {
      success: false,
      error: 'No hay cuentas de redes sociales conectadas. El cliente debe conectar al menos una cuenta antes de publicar.',
    };
  }

  // --- 3. Validar y auto-corregir cada account_id ---
  const validatedPlatforms: LatePlatformTarget[] = [];

  for (const requested of input.platforms) {
    const platform = requested.platform as Platform;

    const exactMatch = realAccounts.find(
      (acc) => acc._id === requested.account_id && acc.platform === platform
    );

    if (exactMatch) {
      validatedPlatforms.push({
        platform,
        accountId: exactMatch._id,
      });
      continue;
    }

    const platformMatch = realAccounts.find(
      (acc) => acc.platform === platform
    );

    if (platformMatch) {
      corrections.push(
        `account_id para ${platform} corregido: ${requested.account_id} → ${platformMatch._id} (${platformMatch.username || 'sin username'})`
      );
      validatedPlatforms.push({
        platform,
        accountId: platformMatch._id,
      });
      continue;
    }

    corrections.push(
      `No hay cuenta conectada para ${platform} — omitida de la publicación`
    );
  }

  if (validatedPlatforms.length === 0) {
    return {
      success: false,
      error: 'Ninguna de las plataformas solicitadas tiene una cuenta conectada. El cliente debe conectar sus redes sociales primero.',
      corrections,
    };
  }

  // --- 4. Validar límite de caracteres por plataforma ---
  for (const vp of validatedPlatforms) {
    const charLimit = PLATFORM_CHAR_LIMITS[vp.platform];
    if (charLimit && cleanContent.length > charLimit) {
      corrections.push(
        `Contenido excede límite de ${vp.platform} (${cleanContent.length}/${charLimit} chars) — truncado`
      );
    }
  }

  let finalContent = cleanContent;
  const minCharLimit = Math.min(
    ...validatedPlatforms.map((vp) => PLATFORM_CHAR_LIMITS[vp.platform] || Infinity)
  );
  if (finalContent.length > minCharLimit) {
    finalContent = finalContent.substring(0, minCharLimit - 3) + '...';
  }

  // --- 5. Validar media_urls — SOLO permitir http:// y https:// ---
  const validMediaUrls: string[] = [];
  if (input.media_urls?.length) {
    for (const url of input.media_urls) {
      if (url.startsWith('http://') || url.startsWith('https://')) {
        validMediaUrls.push(url);
      } else {
        corrections.push(
          `URL de media inválida descartada (protocolo no soportado): ${url.substring(0, 80)}...`
        );
      }
    }
  }

  // --- 6. Construir datos de publicación ---
  const publishData: ValidatedPublishData = {
    content: finalContent,
    platforms: validatedPlatforms,
  };

  if (input.publish_now) {
    publishData.publishNow = true;
  } else if (input.scheduled_for) {
    publishData.scheduledFor = input.scheduled_for;
    publishData.timezone = input.timezone || PR_TIMEZONE;
  } else {
    publishData.scheduledFor = getNextOptimalTime();
    publishData.timezone = PR_TIMEZONE;
  }

  if (validMediaUrls.length > 0) {
    publishData.mediaItems = validMediaUrls.map((url) => ({
      type: (url.match(/\.(mp4|mov|avi|webm)$/i) ? 'video' : 'image') as 'image' | 'video',
      url,
    }));
  }

  return {
    success: true,
    data: publishData,
    corrections,
  };
}

// === RETRY INTELIGENTE ===

function isTransientError(error: unknown): boolean {
  if (error instanceof LateApiError) {
    if (error.status >= 500) {
      const clearErrors = ['invalid', 'not found', 'unauthorized', 'forbidden'];
      const bodyLower = error.body.toLowerCase();
      return !clearErrors.some((msg) => bodyLower.includes(msg));
    }
    if (error.status === 429) return true;
    return false;
  }
  if (error instanceof TypeError && error.message.includes('fetch')) return true;
  return false;
}

async function publishWithRetry(
  data: ValidatedPublishData
): Promise<{ message: string; post: unknown }> {
  try {
    return await createPost(data);
  } catch (firstError) {
    console.error('[Pioneer] Primer intento de publicación falló:', firstError);

    if (!isTransientError(firstError)) {
      throw firstError;
    }

    console.log('[Pioneer] Error transitorio detectado. Reintentando (1/1)...');
    await new Promise((resolve) => setTimeout(resolve, 2000));

    try {
      return await createPost(data);
    } catch (retryError) {
      console.error('[Pioneer] Retry falló:', retryError);
      throw retryError;
    }
  }
}

// === EJECUTAR TOOLS — LLAMADAS DIRECTAS (sin fetch HTTP) ===

async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  generateImageWasCalled: boolean,
  publishPostCount: number,
  hallucinationRetryUsed: boolean,
  lastGeneratedImageUrl: string | null,
  // OAuth headless context
  pendingOAuthData: OAuthPendingData | null,
  linkedInCachedData: Record<string, unknown> | null,
  cachedConnectionOptions: Array<{ id: string; name: string }> | null
): Promise<{
  result: string;
  publishPostCalled: boolean;
  shouldClearOAuthCookie: boolean;
  linkedInDataToCache: Record<string, unknown> | null;
  connectionOptionsToCache: Array<{ id: string; name: string }> | null;
}> {
  try {
    switch (toolName) {
      case 'list_connected_accounts': {
        const result = await listAccounts();
        return {
          result: JSON.stringify({
            success: true,
            accounts: result.accounts,
            count: result.accounts.length,
          }),
          publishPostCalled: false,
          shouldClearOAuthCookie: false,
          linkedInDataToCache: null,
          connectionOptionsToCache: null,
        };
      }

      case 'generate_connect_url': {
        const input = toolInput as {
          platform: string;
          profile_id: string;
        };
        const result = await getConnectUrl(
          input.platform as Platform,
          input.profile_id
        );

        // Informar a Pioneer si es headless para que sepa esperar
        const headless = isHeadlessPlatform(input.platform);

        return {
          result: JSON.stringify({
            success: true,
            authUrl: result.authUrl,
            platform: input.platform,
            headless,
            ...(headless && {
              _note_for_pioneer: `Esta plataforma (${input.platform}) usa modo headless. Después de que el cliente autorice, regresará al chat con un mensaje automático. En ese momento debes llamar get_pending_connection para obtener las opciones de selección.`,
            }),
          }),
          publishPostCalled: false,
          shouldClearOAuthCookie: false,
          linkedInDataToCache: null,
          connectionOptionsToCache: null,
        };
      }

      case 'generate_content': {
        const input = toolInput as {
          business_name: string;
          business_type: string;
          post_type: string;
          details: string;
          platforms: string[];
          tone?: string;
          include_hashtags?: boolean;
        };
        const result = await generateContent({
          business_name: input.business_name,
          business_type: input.business_type,
          post_type: input.post_type,
          details: input.details,
          platforms: input.platforms,
          tone: input.tone || 'professional',
          include_hashtags: input.include_hashtags !== false,
        });
        return {
          result: JSON.stringify(result),
          publishPostCalled: false,
          shouldClearOAuthCookie: false,
          linkedInDataToCache: null,
          connectionOptionsToCache: null,
        };
      }

      case 'generate_image': {
        // === FIX BUG 8.1: Bloquear regeneración en retry de alucinación ===
        if (hallucinationRetryUsed && lastGeneratedImageUrl) {
          console.log(`[Pioneer] Reutilizando imagen existente en retry de alucinación: ${lastGeneratedImageUrl.substring(0, 80)}...`);
          return {
            result: JSON.stringify({
              success: true,
              images: [lastGeneratedImageUrl],
              model: 'cached',
              cost_real: 0,
              cost_client: 0,
              expires_in: '1 hora',
              regenerated: false,
              attempts: 0,
              _note: 'Imagen reutilizada del intento anterior (no se generó una nueva)',
            }),
            publishPostCalled: false,
            shouldClearOAuthCookie: false,
            linkedInDataToCache: null,
            connectionOptionsToCache: null,
          };
        }

        const input = toolInput as {
          prompt: string;
          model?: string;
          aspect_ratio?: string;
          num_outputs?: number;
        };
        const result = await generateImage({
          prompt: input.prompt,
          model: (input.model as 'schnell' | 'pro') || 'schnell',
          aspect_ratio: (input.aspect_ratio as '1:1' | '16:9' | '21:9' | '2:3' | '3:2' | '4:5' | '5:4' | '9:16' | '9:21') || '1:1',
          num_outputs: input.num_outputs || 1,
        });

        // === NOTA PARA PIONEER: informar al cliente si hubo regeneración ===
        const resultObj: Record<string, unknown> = { ...result };
        if (result.regenerated && result.success) {
          resultObj._note_for_pioneer = `IMPORTANTE: La primera imagen generada no fue accesible y se regeneró automáticamente. El costo total de imagen fue $${result.cost_client.toFixed(3)} (${result.attempts} intentos). Informa al cliente de este costo actualizado.`;
        }

        return {
          result: JSON.stringify(resultObj),
          publishPostCalled: false,
          shouldClearOAuthCookie: false,
          linkedInDataToCache: null,
          connectionOptionsToCache: null,
        };
      }

      case 'publish_post': {
        // === LÍMITE: MÁXIMO 1 publish_post POR REQUEST ===
        if (publishPostCount >= 1) {
          return {
            result: JSON.stringify({
              success: false,
              error: 'Solo puedes publicar 1 post por mensaje. Para publicar el siguiente post, espera a que el cliente envíe un nuevo mensaje confirmando que desea continuar.',
            }),
            publishPostCalled: false,
            shouldClearOAuthCookie: false,
            linkedInDataToCache: null,
            connectionOptionsToCache: null,
          };
        }

        const input = toolInput as {
          content: string;
          platforms: Array<{ platform: string; account_id: string }>;
          publish_now?: boolean;
          scheduled_for?: string;
          timezone?: string;
          media_urls?: string[];
        };

        // === FIX BUG 8.1b: Inyectar imagen automáticamente en retry de alucinación ===
        if (hallucinationRetryUsed && lastGeneratedImageUrl && (!input.media_urls || input.media_urls.length === 0)) {
          console.log(`[Pioneer] Inyectando imagen guardada en publish_post durante retry: ${lastGeneratedImageUrl.substring(0, 80)}...`);
          input.media_urls = [lastGeneratedImageUrl];
        }

        // === NIVEL 1: VALIDACIÓN PREVENTIVA ===
        const validation = await validateAndPreparePublish(input, generateImageWasCalled);

        if (!validation.success || !validation.data) {
          return {
            result: JSON.stringify({
              success: false,
              error: validation.error,
              corrections: validation.corrections,
            }),
            publishPostCalled: false,
            shouldClearOAuthCookie: false,
            linkedInDataToCache: null,
            connectionOptionsToCache: null,
          };
        }

        if (validation.corrections && validation.corrections.length > 0) {
          console.log('[Pioneer] Correcciones preventivas:', validation.corrections);
        }

        // === NIVEL 2: PUBLICAR CON RETRY INTELIGENTE ===
        try {
          const result = await publishWithRetry(validation.data);

          const imageIncluded = !!(validation.data.mediaItems && validation.data.mediaItems.length > 0);

          return {
            result: JSON.stringify({
              success: true,
              message: validation.data.publishNow
                ? 'Post publicado exitosamente'
                : `Post programado para ${validation.data.scheduledFor}`,
              post: result.post,
              image_included: imageIncluded,
              ...(validation.data.scheduledFor && {
                scheduledFor: validation.data.scheduledFor,
                timezone: validation.data.timezone,
              }),
              ...(validation.corrections &&
                validation.corrections.length > 0 && {
                  _corrections: validation.corrections,
                }),
            }),
            publishPostCalled: true,
            shouldClearOAuthCookie: false,
            linkedInDataToCache: null,
            connectionOptionsToCache: null,
          };
        } catch (publishError) {
          console.error('[Pioneer] Publicación falló después de validación y retry:', publishError);

          const errorMessage =
            publishError instanceof LateApiError
              ? `Error de Late.dev (HTTP ${publishError.status}): ${publishError.body}`
              : publishError instanceof Error
                ? publishError.message
                : 'Error desconocido al publicar';

          return {
            result: JSON.stringify({
              success: false,
              error: errorMessage,
              corrections: validation.corrections,
            }),
            publishPostCalled: false,
            shouldClearOAuthCookie: false,
            linkedInDataToCache: null,
            connectionOptionsToCache: null,
          };
        }
      }

      // ============================================================
      // === NUEVAS TOOLS: OAuth Headless ===
      // ============================================================

      case 'get_pending_connection': {
        // Leer cookie OAuth pendiente
        const pending = pendingOAuthData;

        if (!pending) {
          return {
            result: JSON.stringify({
              success: false,
              error: 'No hay conexión pendiente. La sesión de autorización pudo haber expirado (10 minutos). El cliente debe intentar conectar la plataforma de nuevo usando generate_connect_url.',
            }),
            publishPostCalled: false,
            shouldClearOAuthCookie: false,
            linkedInDataToCache: null,
            connectionOptionsToCache: null,
          };
        }

        const { platform, step, profileId, tempToken, connectToken, pendingDataToken } = pending;

        console.log(`[Pioneer] get_pending_connection: ${platform} (step: ${step})`);

        try {
          switch (platform) {
            case 'facebook':
            case 'instagram': {
              if (!tempToken || !connectToken) {
                return {
                  result: JSON.stringify({
                    success: false,
                    error: 'Faltan tokens para obtener páginas de Facebook. El cliente debe intentar conectar de nuevo.',
                  }),
                  publishPostCalled: false,
                  shouldClearOAuthCookie: false,
                  linkedInDataToCache: null,
                  connectionOptionsToCache: null,
                };
              }
              const fbResult = await getFacebookPages(profileId, tempToken, connectToken);
              const fbOptions = fbResult.pages.map(p => ({
                id: p.id,
                name: p.name,
                username: p.username || '',
                category: p.category || '',
              }));
              return {
                result: JSON.stringify({
                  success: true,
                  platform,
                  step,
                  options_type: 'pages',
                  options: fbOptions,
                  message: `Se encontraron ${fbResult.pages.length} página(s) de Facebook. Muestre las opciones al cliente para que elija una. IMPORTANTE: Cuando llame complete_connection, use EXACTAMENTE el "id" de la opción seleccionada.`,
                }),
                publishPostCalled: false,
                shouldClearOAuthCookie: false,
                linkedInDataToCache: null,
                connectionOptionsToCache: fbOptions.map(o => ({ id: o.id, name: o.name })),
              };
            }

            case 'linkedin': {
              if (!pendingDataToken) {
                // Sin pendingDataToken = se conectó directamente como personal
                return {
                  result: JSON.stringify({
                    success: true,
                    platform,
                    step: 'direct_connect',
                    options_type: 'none',
                    options: [],
                    message: 'La cuenta de LinkedIn se conectó directamente como cuenta personal (sin organizaciones disponibles).',
                    connected: true,
                  }),
                  publishPostCalled: false,
                  shouldClearOAuthCookie: true,
                  linkedInDataToCache: null,
                  connectionOptionsToCache: null,
                };
              }

              // ⚠️ IMPORTANTE: Este endpoint es de UN SOLO USO
              const linkedInData = await getLinkedInPendingData(pendingDataToken);

              if (!linkedInData.organizations || linkedInData.organizations.length === 0) {
                // Sin organizaciones → conectar como personal automáticamente
                if (connectToken) {
                  await saveLinkedInOrganization(
                    profileId,
                    linkedInData.tempToken,
                    linkedInData.userProfile as Record<string, unknown>,
                    'personal',
                    connectToken
                  );
                }
                return {
                  result: JSON.stringify({
                    success: true,
                    platform,
                    step: 'auto_connected',
                    options_type: 'none',
                    options: [],
                    message: `LinkedIn conectado como cuenta personal de ${linkedInData.userProfile.displayName}. No se encontraron organizaciones.`,
                    connected: true,
                  }),
                  publishPostCalled: false,
                  shouldClearOAuthCookie: true,
                  linkedInDataToCache: null,
                  connectionOptionsToCache: null,
                };
              }

              // Tiene organizaciones → mostrar opciones
              // Cachear _linkedin_data porque pendingDataToken ya fue consumido
              const linkedInCacheForTool = {
                tempToken: linkedInData.tempToken,
                userProfile: linkedInData.userProfile,
                organizations: linkedInData.organizations,
              };

              return {
                result: JSON.stringify({
                  success: true,
                  platform,
                  step,
                  options_type: 'organizations',
                  options: [
                    { id: 'personal', name: `Cuenta personal (${linkedInData.userProfile.displayName})`, type: 'personal' },
                    ...linkedInData.organizations.map(org => ({
                      id: org.id,
                      name: org.name,
                      urn: org.urn,
                      type: 'organization',
                    })),
                  ],
                  _linkedin_data: linkedInCacheForTool,
                  message: `Se encontraron ${linkedInData.organizations.length} organización(es) de LinkedIn. El cliente puede elegir su cuenta personal o una organización. IMPORTANTE: Cuando llames complete_connection, incluye _linkedin_data tal como está aquí.`,
                }),
                publishPostCalled: false,
                shouldClearOAuthCookie: false,
                linkedInDataToCache: linkedInCacheForTool,
                connectionOptionsToCache: null,
              };
            }

            case 'pinterest': {
              if (!tempToken || !connectToken) {
                return {
                  result: JSON.stringify({
                    success: false,
                    error: 'Faltan tokens para obtener boards de Pinterest. El cliente debe intentar conectar de nuevo.',
                  }),
                  publishPostCalled: false,
                  shouldClearOAuthCookie: false,
                  linkedInDataToCache: null,
                  connectionOptionsToCache: null,
                };
              }
              const pinResult = await getPinterestBoards(profileId, tempToken, connectToken);
              return {
                result: JSON.stringify({
                  success: true,
                  platform,
                  step,
                  options_type: 'boards',
                  options: pinResult.boards.map(b => ({
                    id: b.id,
                    name: b.name,
                    description: b.description || '',
                  })),
                  message: `Se encontraron ${pinResult.boards.length} board(s) de Pinterest. Muestre las opciones al cliente.`,
                }),
                publishPostCalled: false,
                shouldClearOAuthCookie: false,
                linkedInDataToCache: null,
                connectionOptionsToCache: null,
              };
            }

            case 'googlebusiness': {
              if (!tempToken || !connectToken) {
                return {
                  result: JSON.stringify({
                    success: false,
                    error: 'Faltan tokens para obtener ubicaciones de Google Business. El cliente debe intentar conectar de nuevo.',
                  }),
                  publishPostCalled: false,
                  shouldClearOAuthCookie: false,
                  linkedInDataToCache: null,
                  connectionOptionsToCache: null,
                };
              }
              const gmbResult = await getGoogleBusinessLocations(profileId, tempToken, connectToken);
              return {
                result: JSON.stringify({
                  success: true,
                  platform,
                  step,
                  options_type: 'locations',
                  options: gmbResult.locations.map(l => ({
                    id: l.id,
                    name: l.name,
                    address: l.address || '',
                  })),
                  message: `Se encontraron ${gmbResult.locations.length} ubicación(es) de Google Business. Muestre las opciones al cliente.`,
                }),
                publishPostCalled: false,
                shouldClearOAuthCookie: false,
                linkedInDataToCache: null,
                connectionOptionsToCache: null,
              };
            }

            case 'snapchat': {
              const publicProfiles = pending.publicProfiles || [];
              return {
                result: JSON.stringify({
                  success: true,
                  platform,
                  step,
                  options_type: 'public_profiles',
                  options: Array.isArray(publicProfiles) ? publicProfiles : [],
                  message: `Se encontraron ${Array.isArray(publicProfiles) ? publicProfiles.length : 0} perfil(es) público(s) de Snapchat. Muestre las opciones al cliente.`,
                }),
                publishPostCalled: false,
                shouldClearOAuthCookie: false,
                linkedInDataToCache: null,
                connectionOptionsToCache: null,
              };
            }

            default:
              return {
                result: JSON.stringify({
                  success: false,
                  error: `Plataforma headless no soportada: ${platform}`,
                }),
                publishPostCalled: false,
                shouldClearOAuthCookie: false,
                linkedInDataToCache: null,
                connectionOptionsToCache: null,
              };
          }
        } catch (error) {
          console.error(`[Pioneer] Error en get_pending_connection para ${platform}:`, error);

          if (error instanceof LateApiError && (error.status === 401 || error.status === 403)) {
            return {
              result: JSON.stringify({
                success: false,
                error: 'Los tokens de autorización expiraron. El cliente debe intentar conectar la plataforma de nuevo.',
                expired: true,
              }),
              publishPostCalled: false,
              shouldClearOAuthCookie: true, // Limpiar cookie expirada
              linkedInDataToCache: null,
              connectionOptionsToCache: null,
            };
          }

          return {
            result: JSON.stringify({
              success: false,
              error: `Error al obtener opciones: ${error instanceof Error ? error.message : 'Error desconocido'}`,
            }),
            publishPostCalled: false,
            shouldClearOAuthCookie: false,
            linkedInDataToCache: null,
            connectionOptionsToCache: null,
          };
        }
      }

      case 'complete_connection': {
        const input = toolInput as {
          platform: string;
          selection_id: string;
          selection_name?: string;
          _linkedin_data?: {
            tempToken: string;
            userProfile: Record<string, unknown>;
            organizations: Array<{ id: string; urn: string; name: string }>;
          };
        };

        const pending = pendingOAuthData;

        if (!pending) {
          return {
            result: JSON.stringify({
              success: false,
              error: 'No hay conexión pendiente. La sesión pudo haber expirado. El cliente debe intentar conectar de nuevo.',
            }),
            publishPostCalled: false,
            shouldClearOAuthCookie: false,
            linkedInDataToCache: null,
            connectionOptionsToCache: null,
          };
        }

        const { profileId, tempToken, connectToken, userProfile } = pending;
        let { selection_id } = input;
        const { selection_name } = input;
        const platform = input.platform || pending.platform;

        console.log(`[Pioneer] complete_connection: ${platform} → ${selection_id} (${selection_name})`);
        console.log(`[Pioneer] Cookie data — profileId: ${profileId}, tempToken: ${tempToken ? tempToken.substring(0, 20) + '...' : 'NULL'}, connectToken: ${connectToken ? connectToken.substring(0, 20) + '...' : 'NULL'}, userProfile: ${userProfile ? JSON.stringify(userProfile).substring(0, 100) : 'NULL'}`);

        // === AUTO-CORRECCIÓN: Si Claude alucinó un selection_id, usar el correcto del cache ===
        if (cachedConnectionOptions && cachedConnectionOptions.length > 0) {
          const exactMatch = cachedConnectionOptions.find(o => o.id === selection_id);
          if (!exactMatch) {
            // Claude usó un ID que no existe en las opciones reales
            // Intentar match por nombre
            const nameMatch = selection_name
              ? cachedConnectionOptions.find(o => o.name.toLowerCase() === selection_name.toLowerCase())
              : null;

            if (nameMatch) {
              console.warn(`[Pioneer] ⚠️ AUTO-CORRECCIÓN: selection_id "${selection_id}" no encontrado. Corregido a "${nameMatch.id}" por match de nombre "${nameMatch.name}"`);
              selection_id = nameMatch.id;
            } else if (cachedConnectionOptions.length === 1) {
              // Solo hay una opción — usar esa
              console.warn(`[Pioneer] ⚠️ AUTO-CORRECCIÓN: selection_id "${selection_id}" no encontrado. Solo hay 1 opción disponible, usando "${cachedConnectionOptions[0].id}" (${cachedConnectionOptions[0].name})`);
              selection_id = cachedConnectionOptions[0].id;
            } else {
              console.warn(`[Pioneer] ⚠️ selection_id "${selection_id}" no coincide con ninguna opción conocida. Opciones: ${JSON.stringify(cachedConnectionOptions)}`);
              // Continuar con el ID que Claude proporcionó — Late.dev dará el error real
            }
          }
        }
        try {
          switch (platform) {
            case 'facebook':
            case 'instagram': {
              if (!tempToken || !connectToken || !userProfile) {
                return {
                  result: JSON.stringify({
                    success: false,
                    error: 'Faltan datos para guardar la selección de Facebook. El cliente debe intentar conectar de nuevo.',
                  }),
                  publishPostCalled: false,
                  shouldClearOAuthCookie: false,
                  linkedInDataToCache: null,
                  connectionOptionsToCache: null,
                };
              }

              // === VALIDACIÓN: Re-fetch pages para verificar/corregir el selection_id ===
              // Claude frecuentemente alucina page IDs — verificamos contra Late.dev
              try {
                const pagesCheck = await getFacebookPages(profileId, tempToken, connectToken);
                const realPages = pagesCheck.pages;
                const exactMatch = realPages.find(p => p.id === selection_id);

                if (!exactMatch && realPages.length > 0) {
                  const nameMatch = selection_name
                    ? realPages.find(p => p.name.toLowerCase() === (selection_name || '').toLowerCase())
                    : null;

                  if (nameMatch) {
                    console.warn(`[Pioneer] ⚠️ CORRECCIÓN FB: ID "${selection_id}" → "${nameMatch.id}" (match por nombre "${nameMatch.name}")`);
                    selection_id = nameMatch.id;
                  } else if (realPages.length === 1) {
                    console.warn(`[Pioneer] ⚠️ CORRECCIÓN FB: ID "${selection_id}" → "${realPages[0].id}" (única página: "${realPages[0].name}")`);
                    selection_id = realPages[0].id;
                  } else {
                    console.warn(`[Pioneer] ⚠️ Page ID "${selection_id}" no encontrado. Pages: ${JSON.stringify(realPages.map(p => ({ id: p.id, name: p.name })))}`);
                  }
                }
              } catch (fetchErr) {
                console.warn('[Pioneer] No se pudieron re-fetch pages para validación:', fetchErr);
              }

              await saveFacebookPage(profileId, selection_id, tempToken, userProfile, connectToken);
              return {
                result: JSON.stringify({
                  success: true,
                  platform,
                  message: `Página de Facebook "${selection_name || selection_id}" conectada exitosamente.`,
                  connected: true,
                }),
                publishPostCalled: false,
                shouldClearOAuthCookie: true,
                linkedInDataToCache: null,
                connectionOptionsToCache: null,
              };
            }

            case 'linkedin': {
              // LinkedIn: usar _linkedin_data del input O del cache
              const liData = input._linkedin_data || (linkedInCachedData as {
                tempToken: string;
                userProfile: Record<string, unknown>;
                organizations: Array<{ id: string; urn: string; name: string }>;
              } | null);

              if (!liData || !connectToken) {
                return {
                  result: JSON.stringify({
                    success: false,
                    error: 'Faltan datos de LinkedIn para guardar la selección. Asegúrate de incluir _linkedin_data que devolvió get_pending_connection. El cliente puede necesitar intentar conectar de nuevo.',
                  }),
                  publishPostCalled: false,
                  shouldClearOAuthCookie: false,
                  linkedInDataToCache: null,
                  connectionOptionsToCache: null,
                };
              }

              const isPersonal = selection_id === 'personal';
              const selectedOrg = isPersonal
                ? undefined
                : liData.organizations.find(o => o.id === selection_id);

              await saveLinkedInOrganization(
                profileId,
                liData.tempToken,
                liData.userProfile,
                isPersonal ? 'personal' : 'organization',
                connectToken,
                selectedOrg
              );

              return {
                result: JSON.stringify({
                  success: true,
                  platform,
                  message: isPersonal
                    ? `LinkedIn conectado como cuenta personal.`
                    : `LinkedIn conectado como organización "${selectedOrg?.name || selection_id}".`,
                  connected: true,
                }),
                publishPostCalled: false,
                shouldClearOAuthCookie: true,
                linkedInDataToCache: null,
                connectionOptionsToCache: null,
              };
            }

            case 'pinterest': {
              if (!tempToken || !connectToken || !userProfile) {
                return {
                  result: JSON.stringify({
                    success: false,
                    error: 'Faltan datos para guardar la selección de Pinterest. El cliente debe intentar conectar de nuevo.',
                  }),
                  publishPostCalled: false,
                  shouldClearOAuthCookie: false,
                  linkedInDataToCache: null,
                  connectionOptionsToCache: null,
                };
              }
              await savePinterestBoard(
                profileId,
                selection_id,
                selection_name || selection_id,
                tempToken,
                userProfile,
                connectToken
              );
              return {
                result: JSON.stringify({
                  success: true,
                  platform,
                  message: `Board de Pinterest "${selection_name || selection_id}" conectado exitosamente.`,
                  connected: true,
                }),
                publishPostCalled: false,
                shouldClearOAuthCookie: true,
                linkedInDataToCache: null,
                connectionOptionsToCache: null,
              };
            }

            case 'googlebusiness': {
              if (!tempToken || !connectToken || !userProfile) {
                return {
                  result: JSON.stringify({
                    success: false,
                    error: 'Faltan datos para guardar la ubicación de Google Business. El cliente debe intentar conectar de nuevo.',
                  }),
                  publishPostCalled: false,
                  shouldClearOAuthCookie: false,
                  linkedInDataToCache: null,
                  connectionOptionsToCache: null,
                };
              }
              await saveGoogleBusinessLocation(
                profileId,
                selection_id,
                tempToken,
                userProfile,
                connectToken
              );
              return {
                result: JSON.stringify({
                  success: true,
                  platform,
                  message: `Ubicación de Google Business "${selection_name || selection_id}" conectada exitosamente.`,
                  connected: true,
                }),
                publishPostCalled: false,
                shouldClearOAuthCookie: true,
                linkedInDataToCache: null,
                connectionOptionsToCache: null,
              };
            }

            case 'snapchat': {
              if (!tempToken || !connectToken || !userProfile) {
                return {
                  result: JSON.stringify({
                    success: false,
                    error: 'Faltan datos para guardar el perfil de Snapchat. El cliente debe intentar conectar de nuevo.',
                  }),
                  publishPostCalled: false,
                  shouldClearOAuthCookie: false,
                  linkedInDataToCache: null,
                  connectionOptionsToCache: null,
                };
              }
              await saveSnapchatProfile(
                profileId,
                selection_id,
                tempToken,
                userProfile,
                connectToken
              );
              return {
                result: JSON.stringify({
                  success: true,
                  platform,
                  message: `Perfil público de Snapchat conectado exitosamente.`,
                  connected: true,
                }),
                publishPostCalled: false,
                shouldClearOAuthCookie: true,
                linkedInDataToCache: null,
                connectionOptionsToCache: null,
              };
            }

            default:
              return {
                result: JSON.stringify({
                  success: false,
                  error: `Plataforma no soportada para completar conexión: ${platform}`,
                }),
                publishPostCalled: false,
                shouldClearOAuthCookie: false,
                linkedInDataToCache: null,
                connectionOptionsToCache: null,
              };
          }
        } catch (error) {
          console.error(`[Pioneer] Error en complete_connection para ${platform}:`, error);

          if (error instanceof LateApiError && (error.status === 401 || error.status === 403)) {
            return {
              result: JSON.stringify({
                success: false,
                error: 'Los tokens de autorización expiraron. El cliente debe intentar conectar la plataforma de nuevo.',
                expired: true,
              }),
              publishPostCalled: false,
              shouldClearOAuthCookie: true,
              linkedInDataToCache: null,
              connectionOptionsToCache: null,
            };
          }

          return {
            result: JSON.stringify({
              success: false,
              error: `Error al completar conexión: ${error instanceof Error ? error.message : 'Error desconocido'}`,
            }),
            publishPostCalled: false,
            shouldClearOAuthCookie: false,
            linkedInDataToCache: null,
            connectionOptionsToCache: null,
          };
        }
      }

      default:
        return {
          result: JSON.stringify({ error: `Tool desconocida: ${toolName}` }),
          publishPostCalled: false,
          shouldClearOAuthCookie: false,
          linkedInDataToCache: null,
          connectionOptionsToCache: null,
        };
    }
  } catch (error) {
    console.error(`Error ejecutando tool ${toolName}:`, error);
    return {
      result: JSON.stringify({
        error: `Error al ejecutar ${toolName}: ${error instanceof Error ? error.message : 'Error desconocido'}`,
      }),
      publishPostCalled: false,
      shouldClearOAuthCookie: false,
      linkedInDataToCache: null,
      connectionOptionsToCache: null,
    };
  }
}

// === MÁXIMO DE ITERACIONES DEL LOOP DE TOOL_USE ===
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

    // Formatear mensajes para Claude API
    const formattedMessages: Anthropic.MessageParam[] = messages.map(
      (msg: { role: string; content: string }) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })
    );

    // === LEER COOKIE OAUTH AL INICIO DEL REQUEST ===
    // Usamos getOAuthCookie(request) que lee directamente de NextRequest.cookies
    // Más confiable que cookies() de next/headers en Route Handlers
    let pendingOAuthData: OAuthPendingData | null = null;
    try {
      // Log all cookies for debugging
      const allCookies = request.cookies.getAll();
      console.log(`[Pioneer] Cookies en request (${allCookies.length}):`, allCookies.map(c => c.name));
      
      pendingOAuthData = getOAuthCookie(request);
      console.log(`[Pioneer] OAuth cookie leída:`, pendingOAuthData ? `platform=${pendingOAuthData.platform}, step=${pendingOAuthData.step}` : 'null');
    } catch (error) {
      console.warn('[Pioneer] No se pudo leer OAuth cookie:', error);
    }

    // === LOOP DE TOOL_USE ===
    let currentMessages = [...formattedMessages];
    let finalTextParts: string[] = [];

    // === TRACKING ===
    let generateImageWasCalled = false;
    let lastGeneratedImageUrl: string | null = null;
    let publishPostCount = 0;
    let hallucinationRetryUsed = false;
    let shouldClearOAuthCookie = false;
    let linkedInCachedData: Record<string, unknown> | null = null;
    let cachedConnectionOptions: Array<{ id: string; name: string }> | null = null;

    // Generar system prompt con fecha actual
    const systemPrompt = buildSystemPrompt();

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

      // Si Claude terminó, verificar antes de devolver
      if (response.stop_reason === 'end_turn') {
        const fullText = finalTextParts.join('\n\n');

        // === DETECCIÓN DE ALUCINACIÓN DE PUBLICACIÓN ===
        if (detectPublishHallucination(fullText, publishPostCount) && !hallucinationRetryUsed) {
          console.warn('[Pioneer] ⚠️ ALUCINACIÓN DETECTADA: Claude dijo "publicado" sin llamar publish_post. Forzando retry.');
          hallucinationRetryUsed = true;

          let correctiveMessage = 'ERROR DEL SISTEMA: No se ejecutó la publicación. Debes llamar la tool publish_post para publicar el post. El cliente ya aprobó. Llama publish_post ahora con el contenido que generaste anteriormente. NO respondas con texto — usa la tool publish_post.';

          if (lastGeneratedImageUrl) {
            correctiveMessage += ` IMPORTANTE: NO generes una nueva imagen. Usa esta URL que ya generaste: ${lastGeneratedImageUrl}`;
          }

          currentMessages = [
            ...currentMessages,
            { role: 'assistant' as const, content: response.content },
            {
              role: 'user' as const,
              content: correctiveMessage,
            },
          ];

          finalTextParts = [];
          continue;
        }

        // === Construir respuesta con cookie clearing si necesario ===
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

      // Si Claude quiere usar tools, procesarlas
      if (response.stop_reason === 'tool_use') {
        const toolUseBlocks = response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
        );

        if (toolUseBlocks.length === 0) {
          return NextResponse.json({
            message:
              finalTextParts.join('\n\n') ||
              'Error interno: tool_use sin herramientas.',
            usage: response.usage,
          });
        }

        // Ejecutar cada tool y recoger resultados
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const toolBlock of toolUseBlocks) {
          console.log(
            `[Pioneer] Ejecutando tool: ${toolBlock.name}`,
            toolBlock.input
          );

          // Tracking: marcar si generate_image fue llamada
          if (toolBlock.name === 'generate_image') {
            generateImageWasCalled = true;
          }

          const toolResult = await executeTool(
            toolBlock.name,
            toolBlock.input as Record<string, unknown>,
            generateImageWasCalled,
            publishPostCount,
            hallucinationRetryUsed,
            lastGeneratedImageUrl,
            pendingOAuthData,
            linkedInCachedData,
            cachedConnectionOptions
          );

          // Tracking: capturar URL de imagen para reutilizar en retry de alucinación
          if (toolBlock.name === 'generate_image') {
            try {
              const parsed = JSON.parse(toolResult.result);
              if (parsed.success && parsed.images?.length > 0) {
                lastGeneratedImageUrl = parsed.images[0];
              }
            } catch { /* ignore parse errors */ }
          }

          // Tracking: contar publish_post EXITOSOS
          if (toolResult.publishPostCalled) {
            publishPostCount++;
          }

          // Tracking: OAuth cookie clearing
          if (toolResult.shouldClearOAuthCookie) {
            shouldClearOAuthCookie = true;
          }

          // Tracking: LinkedIn cached data
          if (toolResult.linkedInDataToCache) {
            linkedInCachedData = toolResult.linkedInDataToCache;
          }

          // Tracking: Connection options cache (for auto-correction in complete_connection)
          if (toolResult.connectionOptionsToCache) {
            cachedConnectionOptions = toolResult.connectionOptionsToCache;
          }

          console.log(
            `[Pioneer] Resultado de ${toolBlock.name}:`,
            toolResult.result.substring(0, 200)
          );

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: toolResult.result,
          });
        }

        // Agregar respuesta de Claude y resultados al historial
        currentMessages = [
          ...currentMessages,
          { role: 'assistant' as const, content: response.content },
          { role: 'user' as const, content: toolResults },
        ];

        continue;
      }

      // Cualquier otro stop_reason (max_tokens, etc.)
      return NextResponse.json({
        message:
          finalTextParts.join('\n\n') ||
          'La respuesta fue cortada. Intente de nuevo con una pregunta más específica.',
        usage: response.usage,
      });
    }

    // Excedimos el máximo de iteraciones
    const jsonResponse = NextResponse.json({
      message:
        finalTextParts.join('\n\n') +
        '\n\n⚠️ Se alcanzó el límite de acciones por mensaje. Si necesita más, envíe otro mensaje.',
      usage: { input_tokens: 0, output_tokens: 0 },
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
  } catch (error) {
    console.error('Error en API de chat:', error);

    if (error instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: `Error de API: ${error.message}` },
        { status: error.status || 500 }
      );
    }

    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}
