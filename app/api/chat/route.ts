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
} from '@/lib/late-client';
import { generateContent, PLATFORM_CHAR_LIMITS } from '@/lib/content-generator';
import { generateImage, suggestAspectRatio, buildImagePrompt } from '@/lib/replicate-client';
import type { Platform, LatePlatformTarget } from '@/lib/types';

// Inicializar cliente de Anthropic
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// System prompt de Pioneer - combina TODOS los skills
const PIONEER_SYSTEM_PROMPT = `Eres Pioneer, un asistente de marketing digital para pequeños negocios en Puerto Rico.

=== IDENTIDAD (pioneer-core) ===

- Nombre: Pioneer
- Rol: Estratega de marketing digital que reemplaza la necesidad de contratar un especialista humano
- Presentación: "Soy Pioneer, su asistente de marketing"

=== PERSONALIDAD ===

- Tono: Amigable pero profesional
- Tratamiento: Siempre "usted" (nunca tutear)
- Idioma: Español formal
- Estilo: Claro, directo, sin jerga técnica innecesaria
- No pretender ser humano - si preguntan, admitir que es un asistente de IA
- No dar consejos legales, médicos o financieros
- No hacer promesas de resultados específicos

=== REGLAS CRÍTICAS ===

- NUNCA ejecutar sin aprobación del cliente
- Verificar balance antes de proponer campañas
- Si no puedes hacer algo, dirigir a info@pioneeragt.com
- Siempre presentar opciones con costos antes de actuar

=== CONTENIDO PROHIBIDO ===

Rechazar COMPLETAMENTE cualquier solicitud relacionada con:
- Pornografía / contenido sexual
- Drogas ilegales
- Armas
- Apuestas / casinos
- Alcohol (promocionar alcohol, no restaurantes que lo sirven)
- Tabaco / vape
- Criptomonedas / trading
- Campañas políticas / electorales
- Cualquier actividad ilegal

Mensaje de rechazo: "Lo siento, no puedo ayudarle con ese tipo de contenido ya que está fuera de las políticas de Pioneer. Si tiene preguntas, puede comunicarse con nuestro equipo en info@pioneeragt.com."

=== MOTOR ESTRATÉGICO (strategy-engine) ===

Cuando un cliente exprese un objetivo, sigue este proceso:

1. CLASIFICAR el objetivo:
   - Aumentar ventas / Liquidar inventario
   - Conseguir más clientes
   - Crecimiento en redes sociales
   - Promocionar producto/servicio específico
   - Aumentar visitas al local
   - Branding / Dar a conocer el negocio

2. RECOPILAR información que falta:
   - Tipo de negocio
   - Redes sociales que usa
   - Qué quiere lograr específicamente
   - Si tiene fotos/contenido disponible

3. GENERAR un plan estructurado con:
   - Nombre del plan
   - Duración (en días)
   - Canales a usar
   - Acciones numeradas y específicas
   - Costo estimado desglosado
   - Siempre mostrar opción orgánica (sin ads) Y opción con ads

4. PEDIR aprobación antes de ejecutar

=== COSTOS DE REFERENCIA (con markup 500%) ===

- Texto para post (Claude): $0.01 por generación
- Imagen AI básica (FLUX schnell): $0.015 por imagen
- Imagen AI premium (FLUX pro): $0.275 por imagen
- Email campaign (Brevo): $0.005 por email enviado
- Publicación en redes sociales: Incluido en suscripción
- Meta Ads: Según presupuesto del cliente ($5-20/día típico)
- Google Ads: Según presupuesto del cliente ($5-15/día típico)

=== HORARIOS ÓPTIMOS PARA PUERTO RICO ===

- Lunes a Viernes: 12:00 PM o 7:00 PM
- Sábado y Domingo: 10:00 AM o 1:00 PM
- Timezone: America/Puerto_Rico (AST, UTC-4)

=== FORMATO DE PLAN ===

Cuando generes un plan, usa este formato:

📋 **Plan: [Nombre del Plan]**

⏱ Duración: [X] días
📱 Canales: [plataformas]

**Acciones:**
1. [Acción específica] (Día X)
2. [Acción específica] (Día X)
3. ...

**Costo estimado:**
- [Servicio]: $X.XX
- [Servicio]: $X.XX
- **Total (orgánico): $X.XX**
- **Total (con ads): $X.XX** *(opcional)*

¿Desea aprobar este plan?

=== CONTENT WRITER (Fase B) ===

Cuando un plan es aprobado, Pioneer puede generar el contenido real de los posts. Los tipos de contenido que puede crear son:

1. **Oferta/Promoción** - Ventas, descuentos, liquidaciones
2. **Educativo/Tips** - Posicionar como experto
3. **Testimonio** - Generar confianza con social proof
4. **Detrás de escenas** - Humanizar la marca
5. **Urgencia/Escasez** - Impulsar acción inmediata
6. **CTA** - Llamada a acción directa
7. **Branding** - Presentar o reforzar la marca
8. **Interactivo** - Preguntas y engagement

Reglas de contenido:
- Todo en español, estilo Puerto Rico
- Emojis con moderación (1-3 por post)
- Adaptar largo al límite de cada plataforma
- Incluir hashtags relevantes (mezclar locales + industria)
- Cada post debe tener un CTA claro
- Respetar las restricciones de contenido prohibido

=== IMAGE GENERATOR (Fase C) — TOOL generate_image ===

Pioneer puede generar imágenes con IA para acompañar posts de redes sociales.

⚠️ REGLA CRÍTICA SOBRE IMÁGENES Y URLs:
- Para incluir una imagen en un post, PRIMERO debes llamar la tool generate_image.
- generate_image devuelve una URL real que empieza con https://replicate.delivery/...
- SOLO esas URLs reales pueden usarse en media_urls de publish_post.
- NUNCA inventes, construyas o fabriques URLs de imágenes. No existen protocolos como "ai://", "image://", "generate://", etc.
- Si el cliente quiere imagen y NO has llamado generate_image en esta conversación, DEBES llamarla ANTES de publish_post.
- Si publish_post no tiene una URL real obtenida de generate_image, NO incluyas media_urls.

FLUJO CORRECTO PARA IMÁGENES:
1. Después de generar texto con generate_content, SIEMPRE preguntar al cliente:
   "¿Desea acompañar este post con una imagen?
   - Puedo generar una imagen con inteligencia artificial ($0.015)
   - Puede enviarme una foto de su producto (próximamente)
   - O puede publicar solo con texto"

2. Si el cliente quiere imagen AI → LLAMAR la tool generate_image (NO inventar URLs)
3. generate_image devuelve una URL real → Mostrar esa URL al cliente y pedir aprobación
4. Si aprueba → publicar con publish_post incluyendo la URL REAL en media_urls

EJEMPLO CORRECTO:
- Paso 1: Llamar generate_image con prompt "fresh bread on table..."
- Paso 2: Recibir resultado con URL "https://replicate.delivery/czjl/abc123.webp"
- Paso 3: Mostrar URL al cliente, pedir aprobación
- Paso 4: Llamar publish_post con media_urls: ["https://replicate.delivery/czjl/abc123.webp"]

EJEMPLO INCORRECTO (NUNCA HACER):
- Llamar publish_post con media_urls: ["ai://generate-image?prompt=..."] ← ESTO FALLA

REGLAS DE IMÁGENES:
- NUNCA generar imagen sin que el cliente lo solicite o acepte
- Schnell ($0.015) es el modelo por defecto. Solo usar Pro ($0.275) si el cliente pide mejor calidad
- El prompt de imagen debe ser en INGLÉS (FLUX funciona mejor en inglés)
- El prompt debe describir visualmente lo que se necesita, sin texto en la imagen
- Siempre incluir "no text overlay" en el prompt
- Informar al cliente que la imagen está disponible por tiempo limitado
- Si el cliente pide imagen directamente (sin plan), generarla y preguntar si quiere publicarla

CUANDO EL CLIENTE DICE QUE TIENE FOTO PROPIA:
- Responder: "¡Excelente idea! La función de subir fotos estará disponible próximamente. Por ahora, puedo generar una imagen AI o publicar solo con texto. ¿Qué prefiere?"

ASPECT RATIOS POR PLATAFORMA:
- Instagram: 4:5 (más pantalla en feed)
- Facebook: 1:1
- Twitter: 16:9
- LinkedIn: 1:1
- TikTok: 9:16
- Pinterest: 2:3
- Si es para múltiples plataformas: usar 1:1 (universal)

=== SOCIAL PUBLISHER (Fase B.5) — TOOLS DISPONIBLES ===

Tienes acceso a las siguientes herramientas (tools) para ejecutar acciones reales:

1. **list_connected_accounts** — Verifica qué redes sociales tiene conectadas el cliente.
   - Úsala ANTES de proponer un plan de publicación
   - Úsala ANTES de intentar publicar

2. **generate_connect_url** — Genera un enlace OAuth para conectar una red social.
   - Úsala cuando el cliente quiere conectar una plataforma nueva
   - El cliente debe abrir el enlace en su navegador
   - Excepciones: Bluesky usa App Password, Telegram usa Bot Token

3. **generate_content** — Genera el texto de un post adaptado por plataforma.
   - Úsala DESPUÉS de que el cliente apruebe un plan
   - Muestra el contenido generado al cliente para su aprobación

4. **generate_image** — Genera una imagen con IA para acompañar un post.
   - Úsala DESPUÉS de que el cliente acepte tener imagen AI
   - O cuando el cliente pide una imagen directamente
   - El prompt DEBE ser en inglés
   - Devuelve una URL real (https://replicate.delivery/...) que se puede usar en publish_post
   - Muestra la URL de la imagen al cliente para su aprobación

5. **publish_post** — Publica o programa un post en las redes conectadas.
   - SOLO úsala DESPUÉS de que el cliente apruebe EXPLÍCITAMENTE el contenido
   - NUNCA publicar sin aprobación
   - Puede publicar ahora o programar para fecha futura
   - Para incluir imagen, pasar la URL REAL (de generate_image) en media_urls
   - NUNCA inventar URLs en media_urls — solo usar URLs reales devueltas por generate_image

FLUJO CORRECTO COMPLETO:
1. Cliente da objetivo → Pioneer genera plan → Cliente aprueba plan
2. Pioneer usa generate_content → Muestra texto → Cliente lo ve
3. Pioneer pregunta si quiere imagen → Cliente decide
4. Si quiere imagen AI → Pioneer usa generate_image → Recibe URL real → Muestra imagen
5. Cliente aprueba texto (+ imagen si la hay)
6. Pioneer usa list_connected_accounts → Verifica redes conectadas
7. Pioneer usa publish_post (con media_urls de generate_image si hay imagen) → Confirma publicación

REGLAS DE TOOLS:
- NUNCA llamar publish_post sin aprobación explícita del cliente
- SIEMPRE verificar cuentas conectadas antes de publicar
- Si no hay cuentas conectadas, ofrecer generate_connect_url
- Si un tool falla, explicar el error al cliente y ofrecer alternativas
- SIEMPRE preguntar sobre imagen después de generar texto
- NUNCA pasar URLs inventadas a publish_post — solo URLs reales de generate_image

=== REDES SOCIALES - LATE.DEV ===

Pioneer puede publicar en 13 plataformas a través de Late.dev:
Twitter/X, Instagram, Facebook, LinkedIn, TikTok, YouTube, Threads, Reddit, Pinterest, Bluesky, Telegram, Snapchat, Google Business.

Opciones de publicación:
- **Publicar ahora** — Se publica inmediatamente
- **Programar** — Se programa para el próximo horario óptimo PR
- **Programar para fecha específica** — El cliente elige fecha y hora

Cuando publique exitosamente, confirmar así:
✅ **¡Publicado exitosamente!**
- Plataformas: [lista]
- Estado: Publicado / Programado para [fecha]
- ID: [post_id]
- Imagen: Incluida / Sin imagen

=== ONBOARDING ===

Si es un cliente nuevo (no tiene perfil de negocio), recoger mediante conversación:
1. Nombre del negocio
2. Tipo de negocio (restaurante, tienda, servicios, salud/belleza, automotriz, otro)
3. Redes sociales actuales (con URLs si las tiene)
4. Objetivo principal`;

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
      'Genera un enlace OAuth para conectar una red social del cliente. El cliente debe abrir este enlace en su navegador para autorizar la conexión. Úsala cuando el cliente quiere conectar una nueva plataforma.',
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
      'Genera una imagen con inteligencia artificial (FLUX) para acompañar un post de redes sociales. Úsala cuando el cliente acepta tener una imagen AI, o cuando pide una imagen directamente. El prompt DEBE ser en inglés. Devuelve una URL real (https://replicate.delivery/...) que se puede usar en media_urls de publish_post. Las URLs expiran en 1 hora — publicar pronto después de generar.',
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
      'Publica o programa un post en las redes sociales del cliente. SOLO úsala después de que el cliente apruebe explícitamente el contenido. Puede publicar inmediatamente o programar para una fecha futura. IMPORTANTE: Si incluyes media_urls, SOLO usa URLs reales obtenidas previamente de generate_image (https://replicate.delivery/...). NUNCA inventes URLs.',
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
            'Fecha y hora para programar la publicación en formato ISO 8601 (ej: 2026-02-06T12:00:00)',
        },
        timezone: {
          type: 'string',
          description: 'Zona horaria para la programación',
        },
        media_urls: {
          type: 'array',
          items: { type: 'string' },
          description:
            'URLs de imágenes o videos a incluir en el post. SOLO usar URLs reales obtenidas de generate_image (https://replicate.delivery/...). NUNCA inventar URLs.',
        },
      },
      required: ['content', 'platforms'],
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
// Sección 13, Nivel 1 del Knowledge Doc
// Verifica account_ids, auto-corrige si es necesario, valida contenido

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
  corrections?: string[]; // Log de correcciones silenciosas
}

async function validateAndPreparePublish(
  input: {
    content: string;
    platforms: Array<{ platform: string; account_id: string }>;
    publish_now?: boolean;
    scheduled_for?: string;
    timezone?: string;
    media_urls?: string[];
  }
): Promise<ValidationResult> {
  const corrections: string[] = [];

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

    // Buscar si el account_id enviado por Claude existe
    const exactMatch = realAccounts.find(
      (acc) => acc._id === requested.account_id && acc.platform === platform
    );

    if (exactMatch) {
      // account_id correcto — usar tal cual
      validatedPlatforms.push({
        platform,
        accountId: exactMatch._id,
      });
      continue;
    }

    // account_id incorrecto — buscar el correcto por plataforma
    const platformMatch = realAccounts.find(
      (acc) => acc.platform === platform
    );

    if (platformMatch) {
      // Encontró una cuenta para esa plataforma — auto-corregir
      corrections.push(
        `account_id para ${platform} corregido: ${requested.account_id} → ${platformMatch._id} (${platformMatch.username || 'sin username'})`
      );
      validatedPlatforms.push({
        platform,
        accountId: platformMatch._id,
      });
      continue;
    }

    // No hay cuenta para esa plataforma — no se puede publicar ahí
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

  // Truncar contenido si excede el límite más restrictivo de las plataformas seleccionadas
  let finalContent = cleanContent;
  const minCharLimit = Math.min(
    ...validatedPlatforms.map((vp) => PLATFORM_CHAR_LIMITS[vp.platform] || Infinity)
  );
  if (finalContent.length > minCharLimit) {
    finalContent = finalContent.substring(0, minCharLimit - 3) + '...';
  }

  // --- 5. Validar media_urls — SOLO permitir http:// y https:// ---
  // Fix: Claude a veces inventa URLs con protocolos falsos como "ai://", "image://", etc.
  // Solo URLs reales de Replicate (https://replicate.delivery/...) son válidas.
  let validMediaUrls: string[] = [];
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
    // Si no especifica, programar para el próximo horario óptimo
    publishData.scheduledFor = getNextOptimalTime();
    publishData.timezone = PR_TIMEZONE;
  }

  // Solo incluir mediaItems si hay URLs válidas
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
// Sección 13, Nivel 2 del Knowledge Doc
// 1 retry automático solo para errores transitorios
// Cada retry cuenta como 1 post en Late.dev (plan Free = 20/mes)

function isTransientError(error: unknown): boolean {
  if (error instanceof LateApiError) {
    // HTTP 500+ sin mensaje claro = transitorio
    if (error.status >= 500) {
      // Si el body tiene un mensaje claro de error, NO es transitorio
      const clearErrors = ['invalid', 'not found', 'unauthorized', 'forbidden'];
      const bodyLower = error.body.toLowerCase();
      return !clearErrors.some((msg) => bodyLower.includes(msg));
    }
    // HTTP 429 (rate limit) = transitorio, vale la pena reintentar
    if (error.status === 429) return true;
    // Cualquier otro código HTTP (400, 401, 403, 404) = NO transitorio
    return false;
  }
  // Errores de red (fetch failed, timeout, etc.) = transitorio
  if (error instanceof TypeError && error.message.includes('fetch')) return true;
  // Error genérico sin información = transitorio (dar una oportunidad)
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
      // Error con causa clara — no reintentar, devolver el error
      throw firstError;
    }

    // Error transitorio — reintentar 1 vez
    console.log('[Pioneer] Error transitorio detectado. Reintentando (1/1)...');

    // Esperar 2 segundos antes del retry (especialmente útil para rate limits)
    await new Promise((resolve) => setTimeout(resolve, 2000));

    try {
      return await createPost(data);
    } catch (retryError) {
      console.error('[Pioneer] Retry falló:', retryError);
      // Si el retry también falla, devolver el error del retry
      throw retryError;
    }
  }
}

// === EJECUTAR TOOLS — LLAMADAS DIRECTAS (sin fetch HTTP) ===
// FIX: En Vercel serverless, una función no puede llamarse a sí misma via HTTP.
// Ahora importamos y llamamos las funciones directamente.

async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<string> {
  try {
    switch (toolName) {
      case 'list_connected_accounts': {
        // Llamada directa a late-client.ts
        const result = await listAccounts();
        return JSON.stringify({
          success: true,
          accounts: result.accounts,
          count: result.accounts.length,
        });
      }

      case 'generate_connect_url': {
        const input = toolInput as {
          platform: string;
          profile_id: string;
        };
        // Llamada directa a late-client.ts
        const result = await getConnectUrl(
          input.platform as Platform,
          input.profile_id
        );
        return JSON.stringify({
          success: true,
          authUrl: result.authUrl,
          platform: input.platform,
        });
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
        // Llamada directa a content-generator.ts
        const result = await generateContent({
          business_name: input.business_name,
          business_type: input.business_type,
          post_type: input.post_type,
          details: input.details,
          platforms: input.platforms,
          tone: input.tone || 'professional',
          include_hashtags: input.include_hashtags !== false,
        });
        return JSON.stringify(result);
      }

      case 'generate_image': {
        const input = toolInput as {
          prompt: string;
          model?: string;
          aspect_ratio?: string;
          num_outputs?: number;
        };
        // Llamada directa a replicate-client.ts
        const result = await generateImage({
          prompt: input.prompt,
          model: (input.model as 'schnell' | 'pro') || 'schnell',
          aspect_ratio: (input.aspect_ratio as '1:1' | '16:9' | '21:9' | '2:3' | '3:2' | '4:5' | '5:4' | '9:16' | '9:21') || '1:1',
          num_outputs: input.num_outputs || 1,
        });
        return JSON.stringify(result);
      }

      case 'publish_post': {
        const input = toolInput as {
          content: string;
          platforms: Array<{ platform: string; account_id: string }>;
          publish_now?: boolean;
          scheduled_for?: string;
          timezone?: string;
          media_urls?: string[];
        };

        // === NIVEL 1: VALIDACIÓN PREVENTIVA ===
        // Verifica account_ids, auto-corrige, valida contenido, filtra URLs inválidas
        const validation = await validateAndPreparePublish(input);

        if (!validation.success || !validation.data) {
          return JSON.stringify({
            success: false,
            error: validation.error,
            corrections: validation.corrections,
          });
        }

        // Log correcciones silenciosas (el cliente no las ve)
        if (validation.corrections && validation.corrections.length > 0) {
          console.log('[Pioneer] Correcciones preventivas:', validation.corrections);
        }

        // === NIVEL 2: PUBLICAR CON RETRY INTELIGENTE ===
        // 1 retry automático solo para errores transitorios
        try {
          const result = await publishWithRetry(validation.data);

          return JSON.stringify({
            success: true,
            message: validation.data.publishNow
              ? 'Post publicado exitosamente'
              : `Post programado para ${validation.data.scheduledFor}`,
            post: result.post,
            ...(validation.data.scheduledFor && {
              scheduledFor: validation.data.scheduledFor,
              timezone: validation.data.timezone,
            }),
            // Incluir info sobre correcciones en el log (no visible al cliente)
            ...(validation.corrections &&
              validation.corrections.length > 0 && {
                _corrections: validation.corrections,
              }),
          });
        } catch (publishError) {
          // Publicación falló incluso después del retry
          console.error('[Pioneer] Publicación falló después de validación y retry:', publishError);

          const errorMessage =
            publishError instanceof LateApiError
              ? `Error de Late.dev (HTTP ${publishError.status}): ${publishError.body}`
              : publishError instanceof Error
                ? publishError.message
                : 'Error desconocido al publicar';

          return JSON.stringify({
            success: false,
            error: errorMessage,
            corrections: validation.corrections,
          });
        }
      }

      default:
        return JSON.stringify({ error: `Tool desconocida: ${toolName}` });
    }
  } catch (error) {
    console.error(`Error ejecutando tool ${toolName}:`, error);
    return JSON.stringify({
      error: `Error al ejecutar ${toolName}: ${error instanceof Error ? error.message : 'Error desconocido'}`,
    });
  }
}

// === MÁXIMO DE ITERACIONES DEL LOOP DE TOOL_USE ===
const MAX_TOOL_USE_ITERATIONS = 5;

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

    // === LOOP DE TOOL_USE ===
    // Claude puede responder con tool_use, en cuyo caso ejecutamos la tool
    // y le devolvemos el resultado para que continúe.

    let currentMessages = [...formattedMessages];
    let finalTextParts: string[] = [];

    for (let iteration = 0; iteration < MAX_TOOL_USE_ITERATIONS; iteration++) {
      // Llamar a Claude API con tools
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 2048,
        system: PIONEER_SYSTEM_PROMPT,
        tools: PIONEER_TOOLS,
        messages: currentMessages,
      });

      // Recoger todo el texto que Claude haya generado en esta iteración
      const textBlocks = response.content.filter(
        (block): block is Anthropic.TextBlock => block.type === 'text'
      );
      if (textBlocks.length > 0) {
        finalTextParts.push(...textBlocks.map((b) => b.text));
      }

      // Si Claude terminó (no quiere usar más tools), devolver respuesta
      if (response.stop_reason === 'end_turn') {
        return NextResponse.json({
          message: finalTextParts.join('\n\n'),
          usage: response.usage,
        });
      }

      // Si Claude quiere usar tools, procesarlas
      if (response.stop_reason === 'tool_use') {
        const toolUseBlocks = response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
        );

        if (toolUseBlocks.length === 0) {
          // No debería pasar, pero por seguridad
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

          const result = await executeTool(
            toolBlock.name,
            toolBlock.input as Record<string, unknown>
          );

          console.log(
            `[Pioneer] Resultado de ${toolBlock.name}:`,
            result.substring(0, 200)
          );

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: result,
          });
        }

        // Agregar la respuesta de Claude (con tool_use) y los resultados al historial
        currentMessages = [
          ...currentMessages,
          { role: 'assistant' as const, content: response.content },
          { role: 'user' as const, content: toolResults },
        ];

        // Continuar el loop — Claude procesará los resultados
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

    // Si llegamos aquí, excedimos el máximo de iteraciones
    return NextResponse.json({
      message:
        finalTextParts.join('\n\n') +
        '\n\n⚠️ Se alcanzó el límite de acciones por mensaje. Si necesita más, envíe otro mensaje.',
      usage: { input_tokens: 0, output_tokens: 0 },
    });
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
